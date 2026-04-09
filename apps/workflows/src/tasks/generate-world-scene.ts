import { task } from '@renderinc/sdk/workflows';
import type { AssetType } from '@launchkit/shared';
import { dispatchAsset } from '../lib/dispatch-asset.js';
import { SingleAssetInputSchema, type SingleAssetInput } from './input-schemas.js';

/**
 * World scene task — heavy compute, 20 minute timeout.
 *
 * Handles the single `world_scene` asset type. The World Labs Marble
 * API runs a polling-based long-running operation that takes ~5
 * minutes on the happy path; we set the timeout at 20 minutes to
 * ride out upstream slowdowns without tripping the run cap. The 5
 * minutes of polling is almost pure wait, so the `pro` plan is
 * overkill from a CPU perspective but gives the JSON-validation and
 * snapshot-parsing steps headroom and keeps the compute class
 * consistent with the other heavy-tail tasks.
 *
 * Two retries at 5-10-20s backoff. A Marble operation failure
 * usually means the prompt was rejected server-side (content filter)
 * or the world_id was never issued — neither recovers on a retry —
 * but the two attempts catch transient polling 5xx blips.
 */

const WORLD_SCENE_ASSET_TYPES: readonly AssetType[] = ['world_scene'] as const;

export const generateWorldScene = task<[SingleAssetInput], void>(
  {
    name: 'generateWorldScene',
    plan: 'pro',
    timeoutSeconds: 1200,
    retry: {
      maxRetries: 2,
      waitDurationMs: 5000,
      backoffScaling: 2,
    },
  },
  async function generateWorldScene(input: SingleAssetInput): Promise<void> {
    const parsed = SingleAssetInputSchema.parse(input);
    await dispatchAsset({
      projectId: parsed.projectId,
      assetId: parsed.assetId,
      allowedTypes: WORLD_SCENE_ASSET_TYPES,
    });
  }
);
