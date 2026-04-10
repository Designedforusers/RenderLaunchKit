import Anthropic from '@anthropic-ai/sdk';
import { type z, toJSONSchema } from 'zod';
import { computeAnthropicCostCents } from '@launchkit/shared';
import { recordCost } from '../cost-tracker.js';
import type { LLMClient } from '../types.js';

/**
 * Factory that creates an `LLMClient` backed by the Anthropic Messages
 * API.
 *
 * Each backend service (worker, workflows) calls this once at startup
 * with its own API key and model from its own typed env module:
 *
 * ```ts
 * import { createAnthropicLLMClient } from '@launchkit/asset-generators';
 * const llm = createAnthropicLLMClient({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
 * ```
 *
 * `generateJSON` uses Anthropic's strict tool use — Claude is
 * grammar-constrained to emit valid JSON matching the Zod schema.
 * The schema is converted via Zod v4's native `toJSONSchema()` and
 * passed as the tool's `input_schema` with `strict: true`. See
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use
 */

/**
 * Recursively strip JSON Schema constraints that the Anthropic
 * strict-tool-use API does not support. Zod's `toJSONSchema` emits
 * these from `.int()`, `.min()`, `.max()`, `.positive()`, etc., and
 * the API rejects them with 400s like:
 *
 *   "For 'integer' type, properties maximum, minimum are not supported"
 *   "For 'string' type, properties minLength, maxLength are not supported"
 *   "For 'array' type, properties minItems, maxItems are not supported"
 *
 * Stripping at the schema-conversion boundary is safe because
 * `safeParse` on the response still enforces every Zod constraint —
 * the tool schema tells Claude the *shape*, and the Zod parse after
 * the response validates the *values*. This means strict types stay
 * enforced internally while the LLM boundary never rejects a schema.
 *
 * Mutates in place — the schema object is freshly created by
 * `toJSONSchema` so mutation is safe.
 */
const UNSUPPORTED_CONSTRAINTS = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength',
  'minItems', 'maxItems',
  'pattern',
  'multipleOf',
] as const;

function stripUnsupportedConstraints(node: Record<string, unknown>): void {
  for (const key of UNSUPPORTED_CONSTRAINTS) {
    if (key in node) {
      delete node[key];
    }
  }
  // Recurse into object properties
  const props = node['properties'];
  if (props !== null && typeof props === 'object') {
    for (const val of Object.values(props as Record<string, unknown>)) {
      if (val !== null && typeof val === 'object') {
        stripUnsupportedConstraints(val as Record<string, unknown>);
      }
    }
  }
  // Recurse into array items
  const items = node['items'];
  if (items !== null && typeof items === 'object' && !Array.isArray(items)) {
    stripUnsupportedConstraints(items as Record<string, unknown>);
  }
  // Recurse into anyOf / oneOf / allOf
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const variants = node[key];
    if (Array.isArray(variants)) {
      for (const v of variants) {
        if (v !== null && typeof v === 'object') {
          stripUnsupportedConstraints(v as Record<string, unknown>);
        }
      }
    }
  }
}

export interface AnthropicLLMClientConfig {
  apiKey: string;
  model: string;
}

export function createAnthropicLLMClient(config: AnthropicLLMClientConfig): {
  generateContent: LLMClient['generateContent'];
  generateJSON: LLMClient['generateJSON'];
} {
  const client = new Anthropic({ apiKey: config.apiKey });
  const model = config.model;

  const generateContent: LLMClient['generateContent'] = async (
    systemPrompt,
    userPrompt,
    options
  ) => {
    const response = await client.messages.create({
      model,
      max_tokens: options?.maxTokens ?? 16000,
      ...(options?.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    try {
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      recordCost({
        provider: 'anthropic',
        operation: 'messages.create',
        inputUnits: inputTokens,
        outputUnits: outputTokens,
        costCents: computeAnthropicCostCents(model, inputTokens, outputTokens),
        metadata: { model, caller: 'generateContent' },
      });
    } catch (err) {
      console.warn(
        '[anthropic-llm-client] recordCost failed in generateContent:',
        err instanceof Error ? err.message : String(err)
      );
    }

    const textBlock = response.content.find((c) => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }
    return textBlock.text;
  };

  async function generateJSON<S extends z.ZodType>(
    schema: S,
    systemPrompt: string,
    userPrompt: string,
    options?: { maxTokens?: number }
  ): Promise<z.infer<S>> {
    // Zod v4 → JSON Schema. Strip $schema (Anthropic rejects it)
    // and remove `minimum`/`maximum` from integer properties (the
    // API rejects them with "For 'integer' type, properties maximum,
    // minimum are not supported" in strict mode).
    const rawSchema = toJSONSchema(schema) as Record<string, unknown>;
    const { $schema: _, ...jsonSchema } = rawSchema;
    stripUnsupportedConstraints(jsonSchema);

    const toolName = 'structured_output';

    const response = await client.messages.create({
      model,
      max_tokens: options?.maxTokens ?? 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [
        {
          name: toolName,
          description:
            'Return the generated content as a structured JSON object matching the required schema.',
          strict: true,
          input_schema: jsonSchema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: toolName },
    });

    try {
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      recordCost({
        provider: 'anthropic',
        operation: 'messages.create',
        inputUnits: inputTokens,
        outputUnits: outputTokens,
        costCents: computeAnthropicCostCents(model, inputTokens, outputTokens),
        metadata: { model, caller: 'generateJSON' },
      });
    } catch (err) {
      console.warn(
        '[anthropic-llm-client] recordCost failed in generateJSON:',
        err instanceof Error ? err.message : String(err)
      );
    }

    const toolBlock = response.content.find((c) => c.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('No tool_use block in Claude response');
    }

    const result = schema.safeParse(toolBlock.input);
    if (!result.success) {
      const formatted = result.error.issues
        .map((issue) => {
          const path =
            issue.path.length > 0
              ? issue.path.map(String).join('.')
              : '<root>';
          return `${path}: ${issue.message}`;
        })
        .join('; ');
      throw new Error(
        `Claude structured output failed schema validation: ${formatted}`
      );
    }
    return result.data as z.infer<S>;
  }

  return { generateContent, generateJSON };
}
