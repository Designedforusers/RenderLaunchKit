import { createAssetGenerators, type AssetGenerators } from '@launchkit/asset-generators';
import { generateContent, generateJSON } from './anthropic-claude-client.js';
import { env } from '../env.js';

/**
 * Worker-side binding of the `@launchkit/asset-generators` package.
 *
 * The package is deliberately provider-agnostic: it takes an
 * `LLMClient` interface, not a concrete Anthropic client. Here we
 * construct that interface from the worker's existing
 * `anthropic-claude-client.ts` module exports so the worker's
 * non-asset-gen agents (`launch-strategy-agent`, `outreach-draft-agent`,
 * `commit-marketability-agent`, `launch-kit-review-agent`) can keep
 * importing `generateContent` / `generateJSON` directly from the
 * worker's lib without taking a dependency on
 * `@launchkit/asset-generators`.
 *
 * Each generator is accessed as a method on the exported
 * `assetGenerators` object — the function identity is stable for the
 * life of the worker process because the factory is called exactly
 * once at module load.
 */

const llmClient = { generateContent, generateJSON };

// Guard against empty strings, not just `undefined`. The worker's env
// schema declares these fields as `z.string().optional()`, which does
// NOT strip an empty-string value set via `.env` — so `env.FOO === ''`
// is a legitimate runtime state. Matching the pre-extraction behavior
// of `getWorkerElevenLabsConfig()` in the old `apps/worker/src/lib/
// elevenlabs.ts` (which used `if (!apiKey || !primaryVoiceId)`) keeps
// the client constructed only when both credentials are non-empty.
// The fal path already handles this correctly via the `?? null`
// fall-through into `createFalMediaClient`'s `isConfigured` check.
const elevenLabsApiKey = env.ELEVENLABS_API_KEY ?? '';
const elevenLabsPrimaryVoiceId = env.ELEVENLABS_VOICE_ID ?? '';
const worldLabsApiKey = env.WORLD_LABS_API_KEY ?? '';

export const assetGenerators: AssetGenerators = createAssetGenerators({
  llm: llmClient,
  fal: { apiKey: env.FAL_API_KEY ?? null },
  elevenLabs:
    elevenLabsApiKey !== '' && elevenLabsPrimaryVoiceId !== ''
      ? {
          apiKey: elevenLabsApiKey,
          primaryVoiceId: elevenLabsPrimaryVoiceId,
          altVoiceId: env.ELEVENLABS_VOICE_ID_ALT ?? elevenLabsPrimaryVoiceId,
          modelId: env.ELEVENLABS_MODEL_ID ?? null,
        }
      : null,
  worldLabs:
    worldLabsApiKey !== ''
      ? {
          apiKey: worldLabsApiKey,
          pollTimeoutSeconds: env.WORLD_LABS_POLL_TIMEOUT_SECONDS,
          pollIntervalSeconds: env.WORLD_LABS_POLL_INTERVAL_SECONDS,
        }
      : null,
});
