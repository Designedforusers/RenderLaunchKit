import { Megaphone, Microphone } from '@phosphor-icons/react';
import {
  blogPostToMarkdown,
  changelogEntryToMarkdown,
  faqToMarkdown,
  hackerNewsPostToMarkdown,
  linkedInPostToMarkdown,
  podcastScriptToMarkdown,
  productHuntToMarkdown,
  tipsToMarkdown,
  twitterThreadToMarkdown,
  voiceCommercialToMarkdown,
} from '@launchkit/shared';
import type { StructuredAssetContent } from '../asset-content/index.js';

/**
 * Render a structured asset to its markdown form using the shared
 * per-type serializer. Returns a string for every kind in the
 * union -- the caller gates on whether the asset has structured
 * content at all via `parseStructuredAssetContent`.
 */
export function getMarkdownFromStructured(
  structured: StructuredAssetContent
): string {
  switch (structured.kind) {
    case 'blog_post':
      return blogPostToMarkdown(structured.content);
    case 'twitter_thread':
      return twitterThreadToMarkdown(structured.content);
    case 'linkedin_post':
      return linkedInPostToMarkdown(structured.content);
    case 'product_hunt':
      return productHuntToMarkdown(structured.content);
    case 'hacker_news_post':
      return hackerNewsPostToMarkdown(structured.content);
    case 'faq':
      return faqToMarkdown(structured.content);
    case 'changelog_entry':
      return changelogEntryToMarkdown(structured.content);
    case 'tips':
      return tipsToMarkdown(structured.content);
    case 'voice_commercial':
      return voiceCommercialToMarkdown(structured.content);
    case 'podcast_script':
      return podcastScriptToMarkdown(structured.content);
  }
}

export const ASSET_TYPE_LABELS: Record<string, string> = {
  blog_post: 'Blog Post',
  twitter_thread: 'Twitter Thread',
  linkedin_post: 'LinkedIn Post',
  product_hunt_description: 'Product Hunt',
  hacker_news_post: 'Hacker News',
  faq: 'FAQ',
  changelog_entry: 'Changelog',
  og_image: 'OG Image',
  social_card: 'Social Card',
  product_video: 'Product Video',
  voiceover_script: 'Voiceover',
  video_storyboard: 'Storyboard',
  tips: 'Tips',
  voice_commercial: 'Voice Commercial',
  podcast_script: 'Podcast Script',
  per_commit_teaser: 'Commit Teaser',
  world_scene: '3D World Scene',
};

export const ASSET_TYPE_ICONS: Record<string, string> = {
  blog_post:
    'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  twitter_thread:
    'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  og_image:
    'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  product_video:
    'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  faq: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  // Isometric cube -- reads as a 3D object the user can walk around in
  world_scene:
    'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
};

// Phosphor icon overrides for asset types that benefit from a
// purpose-built icon rather than a generic SVG path.
export const ASSET_TYPE_PHOSPHOR: Record<string, React.ComponentType<{ size?: number; weight?: 'fill' | 'regular' | 'bold' }>> = {
  podcast_script: Microphone,
  voice_commercial: Megaphone,
};

// Tint palette per asset type -- drives the icon halo + the quality
// score ring color. Gives each card a subtly distinct identity so a
// grid of 8 assets reads as a varied kit, not eight copies.
export const ASSET_TYPE_TINTS: Record<string, { from: string; to: string; text: string }> = {
  blog_post: { from: 'from-blue-500/20', to: 'to-blue-500/5', text: 'text-blue-300' },
  twitter_thread: {
    from: 'from-sky-500/20',
    to: 'to-sky-500/5',
    text: 'text-sky-300',
  },
  linkedin_post: {
    from: 'from-indigo-500/20',
    to: 'to-indigo-500/5',
    text: 'text-indigo-300',
  },
  product_hunt_description: {
    from: 'from-orange-500/20',
    to: 'to-orange-500/5',
    text: 'text-orange-300',
  },
  hacker_news_post: {
    from: 'from-amber-500/20',
    to: 'to-amber-500/5',
    text: 'text-amber-300',
  },
  faq: { from: 'from-teal-500/20', to: 'to-teal-500/5', text: 'text-teal-300' },
  changelog_entry: {
    from: 'from-emerald-500/20',
    to: 'to-emerald-500/5',
    text: 'text-emerald-300',
  },
  og_image: {
    from: 'from-violet-500/20',
    to: 'to-violet-500/5',
    text: 'text-violet-300',
  },
  social_card: {
    from: 'from-pink-500/20',
    to: 'to-pink-500/5',
    text: 'text-pink-300',
  },
  product_video: {
    from: 'from-accent-500/20',
    to: 'to-accent-500/5',
    text: 'text-accent-300',
  },
  voiceover_script: {
    from: 'from-yellow-500/20',
    to: 'to-yellow-500/5',
    text: 'text-yellow-300',
  },
  video_storyboard: {
    from: 'from-fuchsia-500/20',
    to: 'to-fuchsia-500/5',
    text: 'text-fuchsia-300',
  },
  voice_commercial: {
    from: 'from-rose-500/20',
    to: 'to-rose-500/5',
    text: 'text-rose-300',
  },
  podcast_script: {
    from: 'from-red-500/20',
    to: 'to-red-500/5',
    text: 'text-red-300',
  },
  // Lime for the world_scene -- tactile, organic, "the real world".
  // Deliberately distinct from `changelog_entry`'s emerald so two
  // cards in the grid don't read as identical siblings.
  world_scene: {
    from: 'from-lime-500/20',
    to: 'to-lime-500/5',
    text: 'text-lime-300',
  },
};

export const DEFAULT_TINT = {
  from: 'from-surface-700/20',
  to: 'to-surface-700/5',
  text: 'text-surface-300',
};


// -- Model selector options (mirrors @launchkit/shared model registry) --

export const IMAGE_MODEL_OPTIONS = [
  { id: 'flux-pro-ultra', name: 'FLUX Pro Ultra', badge: 'reliable', costLabel: '$0.06' },
  { id: 'nano-banana-pro', name: 'Gemini Pro Image', badge: 'best text', costLabel: '$0.15' },
] as const;

export const VIDEO_MODEL_OPTIONS = [
  { id: 'kling-v3', name: 'Kling 3.0', badge: 'recommended', costLabel: '$0.17/s' },
  { id: 'seedance-2', name: 'Seedance 2.0', badge: 'native audio', costLabel: '$0.24/s' },
] as const;

export const IMAGE_ASSET_TYPES = new Set(['og_image', 'social_card']);
export const VIDEO_ASSET_TYPES = new Set(['product_video', 'video_storyboard']);
