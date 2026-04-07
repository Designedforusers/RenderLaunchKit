import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { env } from '../env.js';

/**
 * Default model used for non-agentic Claude calls (single-shot
 * `generateContent` and `generateJSON`). Agentic loops go through the
 * Claude Agent SDK in `agent-sdk-runner.ts`, which has its own model
 * selection.
 *
 * Default is `claude-opus-4-6` — Anthropic's most capable model. Can be
 * overridden via the `ANTHROPIC_MODEL` env var if a deployment wants to
 * use Sonnet for cost reasons.
 */
const DEFAULT_MODEL = env.ANTHROPIC_MODEL;

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export { anthropic };

/**
 * Single-shot prompted call. Used by the content generation agents
 * (writer, etc.) that need free-form text output rather than structured
 * JSON.
 */
export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: options?.maxTokens ?? 16000,
    ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((c) => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }
  return textBlock.text;
}

/**
 * JSON-mode call with runtime schema validation.
 *
 * The signature changed in PR #5 (validate every runtime boundary):
 * the schema is now the first argument and the return type is
 * narrowed via `z.infer<typeof Schema>`. The function:
 *
 *   1. Tells the model in the system prompt to return only valid JSON
 *      (no markdown fences, no explanation).
 *   2. Calls `generateContent` to get the raw text.
 *   3. Strips any markdown fences the model emitted anyway.
 *   4. Parses the cleaned text as JSON.
 *   5. Validates the parsed value against the caller's Zod schema and
 *      returns the typed result.
 *
 * Step 5 is the whole point: prior to this PR the function returned
 * `JSON.parse(cleaned) as T`, which trusted the model's output blindly.
 * A model that omitted a required field, returned the wrong type for
 * one, or hallucinated a new shape would silently produce a value that
 * looked like `T` to TypeScript but crashed downstream when consumed.
 * Now any of those cases throws a structured Zod error at the source,
 * with the failing field path in the message — much easier to debug
 * than `undefined is not an object` 50 lines later.
 *
 * Note: this is still prompt-and-parse, not Anthropic's native
 * structured outputs (`output_config.format`). The native version is
 * stricter (the model is constrained to emit valid JSON matching the
 * schema, not just asked to) but requires translating each Zod schema
 * to JSON Schema. A follow-up PR can migrate the call sites to
 * `client.messages.parse()` once we want the extra guarantee.
 */
export async function generateJSON<S extends z.ZodType>(
  schema: S,
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number }
): Promise<z.infer<S>> {
  const response = await generateContent(
    systemPrompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, just the JSON object.',
    userPrompt,
    options
  );

  // Strip markdown code fences if present.
  const cleaned = response
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Claude returned invalid JSON: ${message} — first 200 chars: ${cleaned.slice(0, 200)}`
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(`Claude JSON output failed schema validation: ${formatted}`);
  }
  return result.data;
}
