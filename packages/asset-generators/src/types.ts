import type { z } from 'zod';

/**
 * Provider-agnostic LLM client interface consumed by every asset
 * generator in this package.
 *
 * The package deliberately does NOT depend on `@anthropic-ai/sdk`.
 * Instead, each consumer app constructs its own `LLMClient`
 * implementation — typically by wrapping the two module-level functions
 * exported by `apps/worker/src/lib/anthropic-claude-client.ts` — and
 * passes it into `createAssetGenerators({ llm, ... })`.
 *
 * Keeping the package provider-agnostic means:
 *
 *   1. **No scope creep on the worker side.** The worker's non-asset-gen
 *      agents (`launch-strategy-agent`, `outreach-draft-agent`,
 *      `commit-marketability-agent`, `launch-kit-review-agent`) keep
 *      using the worker-local `anthropic-claude-client.ts` unchanged.
 *      Moving that client into this package would force every one of
 *      those four consumers to take a dependency on
 *      `@launchkit/asset-generators`, which is semantically wrong — a
 *      launch strategy is not an "asset generator" the way a blog post
 *      or a product video is.
 *
 *   2. **The future workflows service can inject its own client.**
 *      When PR 2 adds `apps/workflows/`, its tasks can wrap their own
 *      Anthropic (or Bedrock, or Vertex) client and pass it in. The
 *      agents don't know or care which provider is underneath.
 *
 *   3. **Tests can inject a fake.** A test can pass a stub
 *      `{ generateContent: async () => 'hello', generateJSON: ... }`
 *      and exercise every agent end-to-end without touching the
 *      network.
 *
 * The two method signatures match the existing worker functions
 * verbatim so the adapter on the worker side is just a one-line
 * `{ generateContent, generateJSON }` object literal.
 */
export interface LLMClient {
  /**
   * Single-shot prompted call. Returns raw text.
   */
  generateContent(
    systemPrompt: string,
    userPrompt: string,
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<string>;

  /**
   * JSON-mode call with Zod schema validation at the boundary. Returns
   * the parsed value typed via `z.infer<S>`.
   */
  generateJSON<S extends z.ZodType>(
    schema: S,
    systemPrompt: string,
    userPrompt: string,
    options?: { maxTokens?: number }
  ): Promise<z.infer<S>>;
}
