import { task } from '@renderinc/sdk/workflows';
import type { AssetType } from '@launchkit/shared';
import { dispatchAsset } from '../lib/dispatch-asset.js';
import { SingleAssetInputSchema, type SingleAssetInput } from './input-schemas.js';

/**
 * Image asset task — medium compute, ~5 minute timeout.
 *
 * Covers `og_image` and `social_card`. Each one is a Claude JSON call
 * (to craft the FLUX prompt) plus one fal.ai FLUX subscribe call.
 * `standard` (1 CPU / 2 GB) gives comfortable headroom for the
 * fal.ai polling loop without overpaying. Three retries at 2-4-8s
 * backoff handles fal.ai queue backpressure on busy hours.
 */

const IMAGE_ASSET_TYPES: readonly AssetType[] = [
  'og_image',
  'social_card',
] as const;

export const generateImageAsset = task<[SingleAssetInput], SingleAssetInput>(
  {
    name: 'generateImageAsset',
    plan: 'standard',
    timeoutSeconds: 300,
    retry: {
      maxRetries: 3,
      waitDurationMs: 2000,
      backoffScaling: 2,
    },
  },
  async function generateImageAsset(
    input: SingleAssetInput
  ): Promise<SingleAssetInput> {
    const parsed = SingleAssetInputSchema.parse(input);
    await dispatchAsset({
      projectId: parsed.projectId,
      assetId: parsed.assetId,
      allowedTypes: IMAGE_ASSET_TYPES,
    });
    // See `generate-written-asset.ts` for the rationale on echoing
    // the parsed input as the task result instead of returning void.
    return parsed;
  }
);
