import type { AssetType } from '@launchkit/shared';
import type { Asset } from '../../lib/api.js';

/**
 * Category taxonomy for the asset gallery.
 *
 * The user's mental model for the launch kit is four buckets:
 *   - **Visuals** — still images: OG, social cards, World Labs 3D scenes
 *   - **Videos** — moving pictures: product videos, storyboards, per-commit teasers
 *   - **Audio** — things you listen to (or scripts that drive audio):
 *     voice commercials, podcast scripts, voiceover scripts
 *   - **Written** — publishable written content: blog posts, tweets, FAQs,
 *     tips, changelog entries
 *
 * This shape matches how a marketing lead would actually present the kit
 * to a stakeholder: "here are the visuals, here are the videos, here's
 * the audio, here's everything to read and ship."
 *
 * The `voiceover_script` lives in Audio rather than Written because its
 * purpose is to be narrated — the text is an intermediate artifact, not
 * a standalone piece of writing. Same for `video_storyboard` in Videos.
 */

export type AssetCategory = 'visuals' | 'videos' | 'audio' | 'written';

/**
 * Exhaustive mapping from `AssetType` to `AssetCategory`.
 *
 * Typed as `Record<AssetType, AssetCategory>` so TypeScript enforces
 * exhaustiveness — adding a new asset type to the Drizzle pgEnum without
 * assigning it a category here will fail `tsc` immediately. That's the
 * point: every new asset type MUST be categorised before it can ship,
 * or the gallery would silently drop it.
 */
export const ASSET_CATEGORY_MAP: Record<AssetType, AssetCategory> = {
  // Visuals
  og_image: 'visuals',
  social_card: 'visuals',
  world_scene: 'visuals',

  // Videos
  product_video: 'videos',
  video_storyboard: 'videos',
  per_commit_teaser: 'videos',

  // Audio
  voice_commercial: 'audio',
  podcast_script: 'audio',
  voiceover_script: 'audio',

  // Written — publishable marketing content + ops artifacts
  blog_post: 'written',
  twitter_thread: 'written',
  linkedin_post: 'written',
  product_hunt_description: 'written',
  hacker_news_post: 'written',
  faq: 'written',
  changelog_entry: 'written',
  tips: 'written',
};

/**
 * Display order for the four categories. Visuals first because they
 * carry the most immediate "wow" on the demo video; Written last because
 * it has the most entries and reads as a long-form wall of cards.
 */
export const ASSET_CATEGORY_ORDER: readonly AssetCategory[] = [
  'visuals',
  'videos',
  'audio',
  'written',
] as const;

/** Display label shown in the tab bar and section heading. */
export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  visuals: 'Visuals',
  videos: 'Videos',
  audio: 'Audio',
  written: 'Written',
};

/**
 * Short description under the category name, used in empty states
 * ("no visuals yet") and as a subtitle on the section header. Keeps
 * the gallery legible on first glance for a reviewer who is trying to
 * understand the kit shape.
 */
export const ASSET_CATEGORY_DESCRIPTIONS: Record<AssetCategory, string> = {
  visuals: 'OG images, social cards, and interactive 3D scenes',
  videos: 'Rendered product videos, storyboards, and teaser cards',
  audio: 'Voice commercials, podcasts, and voiceover scripts',
  written: 'Blog posts, tweets, FAQs, and changelog entries',
};

/**
 * Look up the category for an asset. Safe with
 * `noUncheckedIndexedAccess` because the map is exhaustive on
 * `AssetType` — any known asset type returns a defined category.
 * Falls back to `'written'` for the unreachable "unknown type" case
 * so the gallery never silently loses an asset.
 */
export function categoryOf(asset: Asset): AssetCategory {
  // The Record lookup is typed `AssetCategory` (not `| undefined`)
  // because `AssetType` is a finite union and the map is exhaustive.
  // The `?? 'written'` is a defence-in-depth for runtime shapes that
  // might include an asset type not yet in the Zod enum (e.g., a
  // database row created by a newer worker version than the dashboard
  // bundle). Belt-and-braces.
  return ASSET_CATEGORY_MAP[asset.type] ?? 'written';
}

/** Group an array of assets by category, preserving the input order within each bucket. */
export function groupAssetsByCategory(
  assets: readonly Asset[]
): Record<AssetCategory, Asset[]> {
  const grouped: Record<AssetCategory, Asset[]> = {
    visuals: [],
    videos: [],
    audio: [],
    written: [],
  };
  for (const asset of assets) {
    grouped[categoryOf(asset)].push(asset);
  }
  return grouped;
}
