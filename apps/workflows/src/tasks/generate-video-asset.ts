import { task } from '@renderinc/sdk/workflows';
import type { AssetType } from '@launchkit/shared';
import { dispatchAsset } from '../lib/dispatch-asset.js';
import { SingleAssetInputSchema, type SingleAssetInput } from './input-schemas.js';

/**
 * Video asset task — heavy compute, 20 minute timeout, conservative retry.
 *
 * Covers `product_video` (Kling ~10 min render) and `video_storyboard`
 * (Claude + fal.ai FLUX hero stills). Both benefit from the 2 CPU /
 * 4 GB `pro` instance — the Remotion prop-building path for the
 * storyboard does non-trivial in-memory work, and the Kling subscribe
 * polling loop holds the process open for the full render.
 *
 * Two retries instead of three: a genuine Kling failure costs $ in
 * fal.ai credits on every retry, and past the second attempt the
 * upstream is unlikely to recover on its own within the run window.
 * Backoff starts at 5s so a transient 503 doesn't immediately eat the
 * first retry budget.
 */

const VIDEO_ASSET_TYPES: readonly AssetType[] = [
  'product_video',
  'video_storyboard',
] as const;

export const generateVideoAsset = task<[SingleAssetInput], SingleAssetInput>(
  {
    name: 'generateVideoAsset',
    plan: 'pro',
    timeoutSeconds: 1200,
    retry: {
      maxRetries: 2,
      waitDurationMs: 5000,
      backoffScaling: 2,
    },
  },
  async function generateVideoAsset(
    input: SingleAssetInput
  ): Promise<SingleAssetInput> {
    const parsed = SingleAssetInputSchema.parse(input);
    await dispatchAsset({
      projectId: parsed.projectId,
      assetId: parsed.assetId,
      allowedTypes: VIDEO_ASSET_TYPES,
    });
    // See `generate-written-asset.ts` for the rationale on echoing
    // the parsed input as the task result instead of returning void.
    return parsed;
  }
);
