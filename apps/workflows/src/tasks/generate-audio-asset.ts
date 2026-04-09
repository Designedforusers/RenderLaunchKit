import { task } from '@renderinc/sdk/workflows';
import type { AssetType } from '@launchkit/shared';
import { dispatchAsset } from '../lib/dispatch-asset.js';
import { SingleAssetInputSchema, type SingleAssetInput } from './input-schemas.js';

/**
 * Audio asset task — medium-heavy compute, 15 minute timeout.
 *
 * Covers `voice_commercial` (single-voice, ~2-5 min total with TTS
 * synthesis and hero-image generation) and `podcast_script`
 * (multi-voice, ~3-8 min for a full 18-30-line dialogue). ElevenLabs
 * TTS is the dominant cost-center in wall-clock terms; the writer
 * agent for the dialogue script is fast by comparison.
 *
 * Standard (1 CPU / 2 GB) has plenty of RAM for the per-line MP3
 * buffers (the podcast path concatenates 18-30 lines before writing
 * the final MP3 to the local cache). Two retries with 3-6-12s
 * backoff rides out transient ElevenLabs 5xx without burning the
 * full run budget on a permanent failure.
 */

const AUDIO_ASSET_TYPES: readonly AssetType[] = [
  'voice_commercial',
  'podcast_script',
] as const;

export const generateAudioAsset = task<[SingleAssetInput], SingleAssetInput>(
  {
    name: 'generateAudioAsset',
    plan: 'standard',
    timeoutSeconds: 900,
    retry: {
      maxRetries: 2,
      waitDurationMs: 3000,
      backoffScaling: 2,
    },
  },
  async function generateAudioAsset(
    input: SingleAssetInput
  ): Promise<SingleAssetInput> {
    const parsed = SingleAssetInputSchema.parse(input);
    await dispatchAsset({
      projectId: parsed.projectId,
      assetId: parsed.assetId,
      allowedTypes: AUDIO_ASSET_TYPES,
    });
    // See `generate-written-asset.ts` for the rationale on echoing
    // the parsed input as the task result instead of returning void.
    return parsed;
  }
);
