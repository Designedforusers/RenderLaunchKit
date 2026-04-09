import { task } from '@renderinc/sdk/workflows';
import type { AssetType } from '@launchkit/shared';
import { dispatchAsset } from '../lib/dispatch-asset.js';
import { SingleAssetInputSchema, type SingleAssetInput } from './input-schemas.js';

/**
 * Written asset task — cheap compute, short timeout, aggressive retry.
 *
 * Covers every text-only asset type (blog post, twitter thread,
 * linkedin post, etc.). These are all single-shot Anthropic calls
 * with no external media generation, so a 0.5 CPU / 512 MB starter
 * instance is plenty, a 3-minute timeout rides out a slow Claude
 * response without inflating run cost, and three retries with 1-2-4s
 * backoff handles the occasional 429 from the Anthropic API.
 */

const WRITTEN_ASSET_TYPES: readonly AssetType[] = [
  'blog_post',
  'twitter_thread',
  'linkedin_post',
  'product_hunt_description',
  'hacker_news_post',
  'faq',
  'changelog_entry',
  'voiceover_script',
  'tips',
] as const;

export const generateWrittenAsset = task<[SingleAssetInput], SingleAssetInput>(
  {
    name: 'generateWrittenAsset',
    plan: 'starter',
    timeoutSeconds: 180,
    retry: {
      maxRetries: 3,
      waitDurationMs: 1000,
      backoffScaling: 2,
    },
  },
  async function generateWrittenAsset(
    input: SingleAssetInput
  ): Promise<SingleAssetInput> {
    const parsed = SingleAssetInputSchema.parse(input);
    await dispatchAsset({
      projectId: parsed.projectId,
      assetId: parsed.assetId,
      allowedTypes: WRITTEN_ASSET_TYPES,
    });
    // Return the parsed input as the task result. The Render task
    // runner requires every task to complete with either a concrete
    // result value or an explicit throw — a bare `Promise<void>`
    // surfaces as "Either results or error must be provided" on the
    // local dev task server (and leaves the prod dashboard with an
    // empty `results` array that is indistinguishable from a pending
    // run). Echoing the input gives the Render run page a
    // human-readable trace of which asset this run handled, costs
    // nothing, and matches the pattern the other task files use.
    return parsed;
  }
);
