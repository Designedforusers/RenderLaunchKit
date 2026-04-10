import {
  createFalMediaClient,
  createElevenLabsClient,
  createWorldLabsClient,
  type FalMediaClient,
  type ElevenLabsClient,
  type WorldLabsClient,
} from '@launchkit/asset-generators';
import { env } from '../env.js';

/**
 * Lazy-constructed provider clients for the direct generation
 * endpoints. Each getter constructs the client on first call and
 * caches it. If the required env vars are missing, the getter
 * throws a structured error the route handler maps to a 503.
 */

let falClient: FalMediaClient | null = null;
let elevenLabsClient: ElevenLabsClient | null = null;
let worldLabsClient: WorldLabsClient | null = null;

export function getFalClient(): FalMediaClient {
  if (falClient) return falClient;
  const apiKey = env.FAL_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    throw new Error('FAL_API_KEY is required for image/video generation');
  }
  falClient = createFalMediaClient({ apiKey });
  return falClient;
}

export function getElevenLabsClient(): ElevenLabsClient {
  if (elevenLabsClient) return elevenLabsClient;
  const apiKey = env.ELEVENLABS_API_KEY;
  const voiceId = env.ELEVENLABS_VOICE_ID;
  if (apiKey === undefined || apiKey === '' || voiceId === undefined || voiceId === '') {
    throw new Error(
      'ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required for audio generation'
    );
  }
  elevenLabsClient = createElevenLabsClient({
    apiKey,
    primaryVoiceId: voiceId,
    altVoiceId: env.ELEVENLABS_VOICE_ID_ALT ?? voiceId,
    modelId: env.ELEVENLABS_MODEL_ID ?? null,
  });
  return elevenLabsClient;
}

export function getWorldLabsClient(): WorldLabsClient {
  if (worldLabsClient) return worldLabsClient;
  const apiKey = env.WORLD_LABS_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    throw new Error('WORLD_LABS_API_KEY is required for 3D world generation');
  }
  worldLabsClient = createWorldLabsClient({
    apiKey,
    pollTimeoutSeconds: env.WORLD_LABS_POLL_TIMEOUT_SECONDS,
    pollIntervalSeconds: env.WORLD_LABS_POLL_INTERVAL_SECONDS,
  });
  return worldLabsClient;
}
