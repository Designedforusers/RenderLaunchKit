import Anthropic from '@anthropic-ai/sdk';

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
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export { anthropic };

/**
 * Single-shot prompted call. Used by the content generation agents
 * (writer, strategist, art-director, video-director, creative-director,
 * webhook-relevance-agent, product-video-agent) that do not need an
 * agentic loop — they take rich context, produce one response, done.
 *
 * Adaptive thinking is enabled by default so the model picks its own
 * reasoning depth per request. Effort defaults to `'high'`.
 */
export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: options?.maxTokens ?? 16000,
    temperature: options?.temperature,
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
 * JSON-mode call. Same as `generateContent` but the model is instructed
 * to return valid JSON, the response is stripped of markdown fences,
 * and the result is `JSON.parse`d into the caller-supplied generic.
 *
 * Note: this still uses prompt-and-parse rather than the Claude API's
 * native structured outputs (`output_config.format`). Migrating these
 * call sites to structured outputs is tracked as part of the upcoming
 * "validate every runtime boundary" PR — that PR introduces shared Zod
 * schemas which are the natural input to `messages.parse()`.
 */
export async function generateJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number }
): Promise<T> {
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

  return JSON.parse(cleaned) as T;
}
