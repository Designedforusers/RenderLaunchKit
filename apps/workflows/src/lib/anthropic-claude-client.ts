import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { env } from '../env.js';

/**
 * Anthropic Claude client for the workflows process.
 *
 * Parallel to `apps/worker/src/lib/anthropic-claude-client.ts` — the
 * two files are intentionally independent copies because each backend
 * service constructs its own Anthropic client from its own typed env
 * module (the worker reads `env.ANTHROPIC_API_KEY`, the workflows
 * service reads its own). Moving this to `packages/asset-generators/`
 * was considered and rejected in PR 1: the package is provider-agnostic
 * by design (`LLMClient` interface) so the worker's four non-asset-gen
 * agents (launch-strategy, outreach-draft, commit-marketability,
 * launch-kit-review) don't take a dependency on the package they
 * semantically have nothing to do with.
 *
 * The duplication is 120 lines of wrapper code, not business logic —
 * a tolerable cost for the cleaner package boundary.
 */

const DEFAULT_MODEL = env.ANTHROPIC_MODEL;

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export { anthropic };

/**
 * Single-shot prompted call. Used by every asset-generation agent
 * that needs free-form text output.
 */
export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: options?.maxTokens ?? 16000,
    ...(options?.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
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
 * Uses the same prompt-and-parse pattern as the worker:
 *
 *   1. Tells the model in the system prompt to return only valid JSON
 *      (no markdown fences, no explanation).
 *   2. Calls `generateContent` to get the raw text.
 *   3. Strips any markdown fences the model emitted anyway.
 *   4. Parses the cleaned text as JSON.
 *   5. Validates the parsed value against the caller's Zod schema and
 *      returns the typed result.
 *
 * Every failure mode (invalid JSON, schema mismatch) throws a
 * structured error at the source with the failing field path — much
 * easier to debug than a downstream crash.
 */
export async function generateJSON<S extends z.ZodType>(
  schema: S,
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number }
): Promise<z.infer<S>> {
  const response = await generateContent(
    systemPrompt +
      '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, just the JSON object.',
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
    throw new Error(
      `Claude JSON output failed schema validation: ${formatted}`
    );
  }
  return result.data;
}
