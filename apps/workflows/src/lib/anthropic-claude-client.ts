import { createAnthropicLLMClient } from '@launchkit/asset-generators';
import { env } from '../env.js';

/**
 * Workflows-side Anthropic LLM client.
 *
 * Uses the shared `createAnthropicLLMClient` factory from
 * `@launchkit/asset-generators` — one implementation of
 * `generateContent` and `generateJSON` for the entire monorepo.
 * Each service still injects its own API key and model from its
 * own typed env module.
 */
export const { generateContent, generateJSON } = createAnthropicLLMClient({
  apiKey: env.ANTHROPIC_API_KEY ?? '',
  model: env.ANTHROPIC_MODEL,
});
