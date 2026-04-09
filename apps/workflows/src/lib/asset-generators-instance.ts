import {
  createAssetGenerators,
  type AssetGenerators,
} from '@launchkit/asset-generators';
import { generateContent, generateJSON } from './anthropic-claude-client.js';
import { env } from '../env.js';

/**
 * Workflows-side binding of the `@launchkit/asset-generators` package.
 *
 * Parallel to `apps/worker/src/lib/asset-generators-instance.ts`.
 * Constructs the same `AssetGenerators` bundle but with the workflows
 * service's own env-backed config. Each task run on its own instance
 * calls through this single const — the factory runs once per process
 * at module load, not per-task.
 *
 * ElevenLabs guard matches the worker instance: empty-string values
 * from `.env` files count as absent (`z.string().optional()` does NOT
 * strip empty strings, so a blank credential in local dev would
 * otherwise slip through the `!== undefined` check).
 */

const llmClient = { generateContent, generateJSON };

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
