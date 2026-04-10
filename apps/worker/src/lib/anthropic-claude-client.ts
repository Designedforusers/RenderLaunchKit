import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicLLMClient } from '@launchkit/asset-generators';
import { env } from '../env.js';

/**
 * Worker-side Anthropic LLM client.
 *
 * Uses the shared `createAnthropicLLMClient` factory from
 * `@launchkit/asset-generators` — one implementation of
 * `generateContent` and `generateJSON` for the entire monorepo.
 * Each service still injects its own API key and model from its
 * own typed env module.
 *
 * The raw `Anthropic` client instance is also exported for the
 * few worker-side consumers that need the SDK directly (e.g. the
 * chat endpoint's streaming calls).
 */
const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export { anthropic };

export const { generateContent, generateJSON } = createAnthropicLLMClient({
  apiKey: env.ANTHROPIC_API_KEY ?? '',
  model: env.ANTHROPIC_MODEL,
});
