import {
  createFalMediaClient,
  type FalMediaClient,
  type FalMediaClientConfig,
} from './clients/fal.js';
import {
  createElevenLabsClient,
  type ElevenLabsClient,
  type ElevenLabsClientConfig,
} from './clients/elevenlabs.js';
import {
  createWorldLabsClient,
  type WorldLabsClient,
  type WorldLabsClientConfig,
} from './clients/world-labs.js';
import {
  makeGenerateWrittenAsset,
  type GenerateWrittenAsset,
} from './agents/written.js';
import {
  makeGenerateMarketingImageAsset,
  type GenerateMarketingImageAsset,
} from './agents/marketing-visual.js';
import {
  makeGenerateVideoStoryboardAsset,
  makeGenerateProductVideoAsset,
  type GenerateVideoStoryboardAsset,
  type GenerateProductVideoAsset,
} from './agents/product-video.js';
import {
  makeGenerateVoiceCommercialAsset,
  type GenerateVoiceCommercialAsset,
} from './agents/voice-commercial.js';
import {
  makeGeneratePodcastScriptAsset,
  type GeneratePodcastScriptAsset,
} from './agents/podcast-script.js';
import {
  makeGenerateWorldSceneAsset,
  type GenerateWorldSceneAsset,
} from './agents/world-scene.js';
import type { LLMClient } from './types.js';

/**
 * Top-level factory that wires the asset generation agents to a
 * concrete set of clients.
 *
 * Usage (worker):
 *
 * ```ts
 * import { createAssetGenerators } from '@launchkit/asset-generators';
 * import { generateContent, generateJSON } from './anthropic-claude-client.js';
 * import { env } from '../env.js';
 *
 * export const assetGenerators = createAssetGenerators({
 *   llm: { generateContent, generateJSON },
 *   fal: { apiKey: env.FAL_API_KEY ?? null },
 *   elevenLabs: env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID
 *     ? {
 *         apiKey: env.ELEVENLABS_API_KEY,
 *         primaryVoiceId: env.ELEVENLABS_VOICE_ID,
 *         altVoiceId: env.ELEVENLABS_VOICE_ID_ALT ?? env.ELEVENLABS_VOICE_ID,
 *         modelId: env.ELEVENLABS_MODEL_ID ?? null,
 *       }
 *     : null,
 *   worldLabs: env.WORLD_LABS_API_KEY
 *     ? {
 *         apiKey: env.WORLD_LABS_API_KEY,
 *         pollTimeoutSeconds: env.WORLD_LABS_POLL_TIMEOUT_SECONDS,
 *         pollIntervalSeconds: env.WORLD_LABS_POLL_INTERVAL_SECONDS,
 *       }
 *     : null,
 * });
 * ```
 *
 * The returned object carries every asset-gen agent bound to the
 * provided clients. Agents whose required clients are `null` in the
 * config (e.g. `generateWorldSceneAsset` with no World Labs config)
 * throw a clear error when invoked so a missing-key misconfiguration
 * produces a structured failure at call time instead of a crash at
 * module load.
 */

export interface AssetGeneratorsConfig {
  llm: LLMClient;
  fal: FalMediaClientConfig;
  elevenLabs: ElevenLabsClientConfig | null;
  worldLabs: WorldLabsClientConfig | null;
}

export interface AssetGenerators {
  generateWrittenAsset: GenerateWrittenAsset;
  generateMarketingImageAsset: GenerateMarketingImageAsset;
  generateVideoStoryboardAsset: GenerateVideoStoryboardAsset;
  generateProductVideoAsset: GenerateProductVideoAsset;
  generateVoiceCommercialAsset: GenerateVoiceCommercialAsset;
  generatePodcastScriptAsset: GeneratePodcastScriptAsset;
  generateWorldSceneAsset: GenerateWorldSceneAsset;
}

export function createAssetGenerators(
  config: AssetGeneratorsConfig
): AssetGenerators {
  const fal: FalMediaClient = createFalMediaClient(config.fal);
  const elevenLabs: ElevenLabsClient | null =
    config.elevenLabs !== null
      ? createElevenLabsClient(config.elevenLabs)
      : null;
  const worldLabs: WorldLabsClient | null =
    config.worldLabs !== null
      ? createWorldLabsClient(config.worldLabs)
      : null;

  const generateWrittenAsset = makeGenerateWrittenAsset({ llm: config.llm });

  const generateMarketingImageAsset = makeGenerateMarketingImageAsset({
    llm: config.llm,
    fal,
  });

  const generateVideoStoryboardAsset = makeGenerateVideoStoryboardAsset({
    llm: config.llm,
    fal,
  });

  const generateProductVideoAsset = makeGenerateProductVideoAsset({
    llm: config.llm,
    fal,
  });

  // The voice-commercial and podcast-script agents require
  // ElevenLabs. When the consumer app does not provide an ElevenLabs
  // config we return placeholder functions that reject with a
  // structured error at call time — same failure mode as the previous
  // `requireConfig()` helper in the worker-hosted client. The
  // placeholders are non-async so `require-await` stays happy; the
  // zero-arg arrow is assignable to the one-arg generator signature
  // via TypeScript's function-parameter bivariance.
  const generateVoiceCommercialAsset: GenerateVoiceCommercialAsset =
    elevenLabs !== null
      ? makeGenerateVoiceCommercialAsset({
          fal,
          elevenLabs,
          writer: generateWrittenAsset,
        })
      : () =>
          Promise.reject(
            new Error(
              'generateVoiceCommercialAsset requires ElevenLabs config (ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID)'
            )
          );

  const generatePodcastScriptAsset: GeneratePodcastScriptAsset =
    elevenLabs !== null
      ? makeGeneratePodcastScriptAsset({
          elevenLabs,
          writer: generateWrittenAsset,
        })
      : () =>
          Promise.reject(
            new Error(
              'generatePodcastScriptAsset requires ElevenLabs config (ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID)'
            )
          );

  const generateWorldSceneAsset: GenerateWorldSceneAsset =
    worldLabs !== null
      ? makeGenerateWorldSceneAsset({ llm: config.llm, worldLabs })
      : () =>
          Promise.reject(
            new Error(
              'generateWorldSceneAsset requires World Labs config (WORLD_LABS_API_KEY)'
            )
          );

  return {
    generateWrittenAsset,
    generateMarketingImageAsset,
    generateVideoStoryboardAsset,
    generateProductVideoAsset,
    generateVoiceCommercialAsset,
    generatePodcastScriptAsset,
    generateWorldSceneAsset,
  };
}

// ── Re-exports for consumers that want to build their own wiring ─────

export type { LLMClient } from './types.js';

export {
  createFalMediaClient,
  type FalMediaClient,
  type FalMediaClientConfig,
  type FalImageResult,
  type FalVideoResult,
  type FalImageOptions,
  type FalVideoOptions,
  type FalImageModel,
  type FalVideoModel,
} from './clients/fal.js';

export {
  createElevenLabsClient,
  type ElevenLabsClient,
  type ElevenLabsClientConfig,
  type ElevenLabsRenderResult,
  type PodcastDialogueLine,
} from './clients/elevenlabs.js';

export {
  createWorldLabsClient,
  type WorldLabsClient,
  type WorldLabsClientConfig,
  type WorldLabsGenerateInput,
  type WorldLabsGenerateResult,
} from './clients/world-labs.js';

export {
  createObjectStorageClient,
  type ObjectStorageClient,
  type ObjectStorageConfig,
  type UploadVideoResult,
} from './clients/object-storage.js';

export {
  FluxImageSchema,
  FluxImageResponseSchema,
  NanoBananaImageSchema,
  NanoBananaResponseSchema,
  KlingVideoFileSchema,
  KlingVideoResponseSchema,
  SeedanceVideoResponseSchema,
  type FluxImageResponse,
  type NanoBananaResponse,
  type KlingVideoResponse,
  type SeedanceVideoResponse,
} from './clients/schemas/fal.js';

export {
  WorldAssetsSchema,
  WorldSchema,
  OperationMetadataSchema,
  OperationSchema,
  type WorldAssets,
  type World,
  type Operation,
} from './clients/schemas/world-labs.js';

export { accentColorForTone } from './helpers/strategy-style.js';

export {
  createAnthropicLLMClient,
  type AnthropicLLMClientConfig,
} from './lib/create-anthropic-llm-client.js';

export {
  enhanceImagePrompt,
  enhanceVideoPrompt,
  enhanceForFlux,
  enhanceForNanoBanana,
  enhanceForKlingV3,
  enhanceForSeedance,
  type ImagePromptContext,
  type VideoPromptContext,
  type KlingEnhancedPrompt,
} from './lib/prompt-enhancer.js';

export {
  CostTracker,
  runWithCostTracker,
  recordCost,
  type CostEvent,
  type CostEventProvider,
} from './cost-tracker.js';

export type {
  WriterInput,
  WriterResult,
  GenerateWrittenAsset,
} from './agents/written.js';

export type {
  ArtDirectorInput,
  MarketingImageResult,
  GenerateMarketingImageAsset,
} from './agents/marketing-visual.js';

export type {
  VideoDirectorInput,
  VideoStoryboardResult,
  ProductVideoResult,
  GenerateVideoStoryboardAsset,
  GenerateProductVideoAsset,
} from './agents/product-video.js';

export type {
  VoiceCommercialInput,
  VoiceCommercialResult,
  GenerateVoiceCommercialAsset,
} from './agents/voice-commercial.js';

export type {
  PodcastScriptInput,
  PodcastScriptResult,
  GeneratePodcastScriptAsset,
} from './agents/podcast-script.js';

export type {
  WorldSceneAgentInput,
  WorldSceneAgentResult,
  GenerateWorldSceneAsset,
} from './agents/world-scene.js';
