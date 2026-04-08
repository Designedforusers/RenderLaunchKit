import {
  VIDEO_FPS,
  type VoiceCommercialProps,
} from '@launchkit/video';
import type {
  RepoAnalysis,
  ResearchResult,
  StrategyBrief,
  StrategyInsight,
} from '@launchkit/shared';
import { generateWrittenAsset } from './written-asset-agent.js';
import {
  buildAudioCacheKey,
  synthesizeSingleVoice,
} from '../lib/elevenlabs.js';
import { generateImage } from '../lib/fal-media-client.js';
import { accentColorForTone } from '../lib/strategy-style.js';

/**
 * Voice commercial pipeline (Phase 4).
 *
 * Orchestrates three steps:
 *   1. Writer agent produces a 30-second ad-style script (`voice_commercial`
 *      branch in `ASSET_PROMPTS`).
 *   2. ElevenLabs single-voice synthesis renders the script to MP3 in the
 *      shared `.cache/elevenlabs-rendered/` cache. The `audioCacheKey` is
 *      derived from the asset id + script content so a regeneration with
 *      the same script reuses the existing audio.
 *   3. fal FLUX renders a hero still that the (future) Remotion render
 *      route uses as the visual backdrop.
 *
 * The function returns the script content + a metadata bag containing the
 * audio cache key (consumed by the `/api/assets/:id/audio.mp3` streaming
 * route in `apps/web`) and a fully-typed `VoiceCommercialProps` blob ready
 * for `renderRemotionComposition({ compositionId: 'LaunchKitVoiceCommercial' })`.
 */

interface VoiceCommercialInput {
  assetId: string;
  repoName: string;
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  pastInsights: StrategyInsight[];
  generationInstructions: string;
  revisionInstructions?: string;
}

export interface VoiceCommercialResult {
  script: string;
  audioCacheKey: string;
  metadata: Record<string, unknown>;
}

export async function generateVoiceCommercialAsset(
  input: VoiceCommercialInput
): Promise<VoiceCommercialResult> {
  const writerResult = await generateWrittenAsset({
    repoAnalysis: input.repoAnalysis,
    research: input.research,
    strategy: input.strategy,
    pastInsights: input.pastInsights,
    assetType: 'voice_commercial',
    generationInstructions: input.generationInstructions,
    ...(input.revisionInstructions !== undefined
      ? { revisionInstructions: input.revisionInstructions }
      : {}),
  });

  // Cache key folds in the asset id + script so the cached MP3 only
  // matches the exact (asset, content) pair. Regenerating the asset
  // with a fresh script invalidates the previous render automatically.
  const audioCacheKey = buildAudioCacheKey(
    `${input.assetId}:voice_commercial:${writerResult.content}`
  );

  const audio = await synthesizeSingleVoice({
    cacheKey: audioCacheKey,
    text: writerResult.content,
  });

  const heroImage = await generateImage(
    `Hero still for a 30-second voice commercial about ${input.repoAnalysis.description}. ${input.strategy.positioning}. Cinematic dark backdrop, accent ${accentColorForTone(input.strategy.tone)}.`,
    { aspectRatio: '16:9', style: 'cinematic dark tech' }
  );

  const durationInFrames = Math.max(
    VIDEO_FPS,
    Math.ceil(audio.durationSeconds * VIDEO_FPS)
  );

  // Single-caption track spanning the entire duration. The TTS
  // alignment-driven multi-caption split is the same upgrade path as
  // the existing narrated product video; deferring it here keeps the
  // PR scope tight and the demo path working without extra plumbing.
  const remotionProps: VoiceCommercialProps = {
    productName: input.repoName,
    heroImageUrl: heroImage.url,
    accentColor: accentColorForTone(input.strategy.tone),
    backgroundColor: '#020617',
    audioSrc: audio.audioPath,
    durationInFrames,
    outroCta: `Ship ${input.repoName} with a sharper launch story.`,
    captions: [
      {
        startInFrames: 0,
        endInFrames: durationInFrames,
        text: writerResult.content,
      },
    ],
  };

  return {
    script: writerResult.content,
    audioCacheKey,
    metadata: {
      ...writerResult.metadata,
      audioCacheKey,
      audioCached: audio.cached,
      audioDurationSeconds: audio.durationSeconds,
      heroImageUrl: heroImage.url,
      heroImagePrompt: heroImage.prompt,
      remotionProps,
    },
  };
}
