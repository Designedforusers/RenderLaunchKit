import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AssetLightbox } from './AssetLightbox.js';
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
import { api } from '../lib/api.js';
import type { Asset } from '../lib/api.js';
import { LaunchStatusBadge } from './LaunchStatusBadge.js';
import { LaunchVideoPreview } from './LaunchVideoPreview.js';
import { Tooltip, CopyButton, useToast, ModelSelector } from './ui/index.js';
import {
  WrittenAssetContent,
  parseStructuredAssetContent,
  type StructuredAssetContent,
} from './asset-content/index.js';
import type { LaunchKitVideoProps } from '@launchkit/video';

/**
 * Render a structured asset to its markdown form using the shared
 * per-type serializer. Returns a string for every kind in the
 * union — the caller gates on whether the asset has structured
 * content at all via `parseStructuredAssetContent`.
 */
function getMarkdownFromStructured(
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

const ASSET_TYPE_LABELS: Record<string, string> = {
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
  world_scene: '3D World Scene',
};

const ASSET_TYPE_ICONS: Record<string, string> = {
  blog_post:
    'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  twitter_thread:
    'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  og_image:
    'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  product_video:
    'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  faq: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  // Isometric cube — reads as a 3D object the user can walk around in
  world_scene:
    'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
};

// Tint palette per asset type — drives the icon halo + the quality
// score ring color. Gives each card a subtly distinct identity so a
// grid of 8 assets reads as a varied kit, not eight copies.
const ASSET_TYPE_TINTS: Record<string, { from: string; to: string; text: string }> = {
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
  // Lime for the world_scene — tactile, organic, "the real world".
  // Deliberately distinct from `changelog_entry`'s emerald so two
  // cards in the grid don't read as identical siblings.
  world_scene: {
    from: 'from-lime-500/20',
    to: 'to-lime-500/5',
    text: 'text-lime-300',
  },
};

const DEFAULT_TINT = {
  from: 'from-surface-700/20',
  to: 'to-surface-700/5',
  text: 'text-surface-300',
};

// ── Model selector options (mirrors @launchkit/shared model registry) ──

const IMAGE_MODEL_OPTIONS = [
  { id: 'flux-pro-ultra', name: 'FLUX Pro Ultra', badge: 'reliable', costLabel: '$0.06' },
  { id: 'nano-banana-pro', name: 'Gemini Pro Image', badge: 'best text', costLabel: '$0.15' },
] as const;

const VIDEO_MODEL_OPTIONS = [
  { id: 'kling-v3', name: 'Kling 3.0', badge: 'recommended', costLabel: '$0.17/s' },
  { id: 'seedance-2', name: 'Seedance 2.0', badge: 'native audio', costLabel: '$0.24/s' },
] as const;

const IMAGE_ASSET_TYPES = new Set(['og_image', 'social_card']);
const VIDEO_ASSET_TYPES = new Set(['product_video', 'video_storyboard']);

interface GeneratedAssetCardProps {
  asset: Asset;
  onRefresh: () => void;
  projectAssets?: Asset[];
}

export function GeneratedAssetCard({
  asset,
  onRefresh,
  projectAssets,
}: GeneratedAssetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [videoVariant, setVideoVariant] = useState<'visual' | 'narrated'>('visual');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [exportingNarrated, setExportingNarrated] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('auto');
  const { toast } = useToast();
  const shouldReduceMotion = useReducedMotion();
  const openLightbox = useCallback(() => setLightboxOpen(true), []);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  // Structured content dispatch — null for legacy pre-migration
  // assets and for non-written asset types. Drives both the
  // typed body renderer and the copy-as-markdown button.
  const structuredContent = useMemo(
    () => parseStructuredAssetContent(asset),
    [asset]
  );
  const markdownForCopy = useMemo(
    () =>
      structuredContent !== null
        ? getMarkdownFromStructured(structuredContent)
        : null,
    [structuredContent]
  );

  const isMedia = ['og_image', 'social_card', 'product_video', 'world_scene'].includes(asset.type);
  const isInProgress = ['queued', 'generating', 'regenerating'].includes(asset.status);
  const assetMetadata = asset.metadata ?? null;
  const remotionProps =
    asset.type === 'product_video'
      ? ((assetMetadata?.['remotionProps'] as LaunchKitVideoProps | undefined) ?? null)
      : null;
  // `thumbnailUrl` lives at the top of `metadata` for product_video,
  // og_image, etc. For `world_scene` the Marble-specific URLs are
  // nested under `metadata.worldLabs.{thumbnailUrl,panoUrl,splatUrl,...}`
  // because the world-scene agent emits a sub-object to keep the
  // Marble payload grouped. Fall back to the nested shape so the
  // card renders the actual thumbnail instead of the placeholder
  // text.
  const worldLabsMetadata =
    asset.type === 'world_scene' &&
    typeof assetMetadata?.['worldLabs'] === 'object' &&
    assetMetadata['worldLabs'] !== null
      ? (assetMetadata['worldLabs'] as Record<string, unknown>)
      : null;
  const worldLabsThumbnail = worldLabsMetadata?.['thumbnailUrl'];
  const thumbnailUrl =
    typeof assetMetadata?.['thumbnailUrl'] === 'string'
      ? assetMetadata['thumbnailUrl']
      : typeof worldLabsThumbnail === 'string'
        ? worldLabsThumbnail
        : undefined;
  // `panoUrl` is the public 360-degree equirectangular render URL
  // on Marble's CDN. Unlike the Marble viewer URL, the CDN bucket
  // is publicly readable regardless of the world's `permission`
  // flag, so we can surface the scene inline without bumping into
  // the viewer's "no permission to view this world" page for
  // worlds that were not generated with `permission: { public:
  // true, allow_id_access: true }`.
  const worldLabsPano = worldLabsMetadata?.['panoUrl'];
  const worldPanoUrl =
    typeof worldLabsPano === 'string' ? worldLabsPano : undefined;
  const hasPreview =
    Boolean(asset.content) ||
    Boolean(asset.mediaUrl) ||
    (asset.type === 'product_video' && Boolean(remotionProps));
  const voiceoverAsset = projectAssets?.find((candidate) => {
    if (candidate.type !== 'voiceover_script' || candidate.status === 'failed') {
      return false;
    }
    const segments = candidate.metadata?.['segments'];
    if (Array.isArray(segments)) {
      return segments.length > 0;
    }
    return Boolean(candidate.content?.includes('[SCREEN:'));
  });
  const hasNarratedVariant = asset.type === 'product_video' && Boolean(voiceoverAsset);
  const narratedPreviewUrl =
    asset.type === 'product_video'
      ? `/api/assets/${asset.id}/video.mp4?variant=narrated`
      : null;
  const label = ASSET_TYPE_LABELS[asset.type] ?? asset.type;
  const iconPath = ASSET_TYPE_ICONS[asset.type] ?? ASSET_TYPE_ICONS['blog_post'];
  const tint = ASSET_TYPE_TINTS[asset.type] ?? DEFAULT_TINT;
  // Structured content is rendered via the per-type body components,
  // which produce richer layouts than the character count of
  // `asset.content` can predict — a short tips list with 5 items,
  // for example, can exceed the 360px clamp even though its plain-
  // text form is under the 400-char threshold. Force the clamp on
  // for any asset with structured content so the "Show more"
  // affordance is always available when the body renderer might
  // overflow its container.
  const contentNeedsClamp =
    structuredContent !== null || (asset.content?.length ?? 0) > 400;

  // `exactOptionalPropertyTypes` rejects explicit `undefined` on
  // optional properties, so error descriptions are spread in only
  // when we actually have a message.
  const errorDescription = (err: unknown): { description?: string } =>
    err instanceof Error ? { description: err.message } : {};

  const handleApprove = async () => {
    try {
      await api.approveAsset(asset.id);
      toast({ message: 'Asset approved', variant: 'success', description: label });
      onRefresh();
    } catch (err) {
      toast({
        message: 'Approval failed',
        variant: 'error',
        ...errorDescription(err),
      });
    }
  };

  const handleReject = async () => {
    try {
      await api.rejectAsset(asset.id);
      toast({ message: 'Asset rejected', variant: 'info', description: label });
      onRefresh();
    } catch (err) {
      toast({
        message: 'Rejection failed',
        variant: 'error',
        ...errorDescription(err),
      });
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      // Build model preferences from the selector — only include the
      // relevant key for this asset's media type so we don't override
      // preferences for unrelated types.
      const modelPreferences =
        selectedModel !== 'auto'
          ? IMAGE_ASSET_TYPES.has(asset.type)
            ? { imageModel: selectedModel as 'flux-pro-ultra' | 'nano-banana-pro' }
            : VIDEO_ASSET_TYPES.has(asset.type)
              ? { videoModel: selectedModel as 'kling-v3' | 'seedance-2' }
              : undefined
          : undefined;

      await api.regenerateAsset(asset.id, {
        ...(modelPreferences !== undefined ? { modelPreferences } : {}),
      });
      setVideoVariant('visual');
      setVideoError(null);
      toast({
        message: 'Regeneration queued',
        variant: 'info',
        description: `${label} will refresh shortly`,
      });
      onRefresh();
    } catch (err) {
      toast({
        message: 'Regeneration failed',
        variant: 'error',
        ...errorDescription(err),
      });
    } finally {
      setRegenerating(false);
    }
  };

  const handleExportNarrated = async () => {
    if (!narratedPreviewUrl) {
      return;
    }

    setExportingNarrated(true);
    setVideoError(null);

    try {
      const response = await fetch(`${narratedPreviewUrl}&download=1`);
      if (!response.ok) {
        const errorBody = (await response
          .json()
          .catch(() => ({ error: 'Narrated export failed' }))) as {
          error?: string;
        };
        throw new Error(errorBody.error ?? `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition');
      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ??
        `launchkit-${asset.id}-narrated.mp4`;

      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast({ message: 'Narrated MP4 downloaded', variant: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Narrated export failed';
      setVideoError(message);
      toast({ message: 'Export failed', description: message, variant: 'error' });
    } finally {
      setExportingNarrated(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 240, damping: 24 }}
      whileHover={{ y: -2 }}
      className={`card group relative overflow-hidden bg-gradient-to-br ${tint.from} ${tint.to} hover:border-surface-700 transition-colors`}
    >
      {/* Lightbox (portalled to body) */}
      <AnimatePresence>
        {lightboxOpen && isMedia && (
          <AssetLightbox
            asset={asset}
            onClose={closeLightbox}
            actions={{
              onApprove: () => void handleApprove(),
              onReject: () => void handleReject(),
              onRegenerate: () => void handleRegenerate(),
              regenerating,
            }}
          />
        )}
      </AnimatePresence>

      {/* Header — full version for non-media cards only.
          Media cards are content-dominant: the header is replaced by
          a thin overlay label at the bottom of the media preview,
          and all metadata + actions live in the lightbox. */}
      {!isMedia && (
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <motion.div
              className={`w-10 h-10 rounded-lg bg-surface-900/80 border border-surface-800 flex items-center justify-center ${tint.text}`}
              whileHover={{ rotate: -6, scale: 1.06 }}
              transition={{ type: 'spring', stiffness: 360, damping: 18 }}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.75}
                  d={iconPath}
                />
              </svg>
            </motion.div>
            <div>
              <h4 className="font-mono font-semibold text-sm text-surface-100">
                {label}
              </h4>
              <div className="flex items-center gap-2 text-xs text-surface-500">
                <span>v{asset.version}</span>
                {asset.costCents > 0 && (
                  <Tooltip label="Provider cost for this asset generation">
                    <span className="font-mono text-surface-400">
                      ${(asset.costCents / 100).toFixed(2)}
                    </span>
                  </Tooltip>
                )}
                {asset.userEdited && (
                  <Tooltip label="This asset was edited by a reviewer">
                    <span className="flex items-center gap-0.5 text-amber-400">
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                      edited
                    </span>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {asset.qualityScore !== null && (
              <QualityScoreRing score={asset.qualityScore} />
            )}
            <LaunchStatusBadge status={asset.status} />
          </div>
        </div>
      )}

      {/* Content Preview */}
      {isInProgress ? (
        <InProgressBody tintText={tint.text} />
      ) : isMedia && asset.mediaUrl ? (
        <div
          className="mb-4 relative group/media cursor-pointer"
          onClick={openLightbox}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openLightbox(); }}
        >
          {/* Hover overlay — expand icon */}
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/0 group-hover/media:bg-black/30 transition-colors duration-200 pointer-events-none">
            <div className="opacity-0 group-hover/media:opacity-100 transition-opacity duration-200 bg-surface-900/80 rounded-full p-3 backdrop-blur-sm border border-surface-700">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
            </div>
          </div>
          {asset.type === 'product_video' ? (
            <LaunchVideoPreview
              videoUrl={videoVariant === 'narrated' ? narratedPreviewUrl : asset.mediaUrl}
              {...(thumbnailUrl !== undefined ? { thumbnailUrl } : {})}
              title={label}
              remotionProps={videoVariant === 'visual' ? remotionProps : null}
              {...(videoVariant === 'narrated'
                ? {
                    onError: () =>
                      setVideoError(
                        'Narrated preview is unavailable. Check the voiceover asset and ElevenLabs configuration.'
                      ),
                    onLoadedData: () => setVideoError(null),
                  }
                : {})}
            />
          ) : asset.type === 'world_scene' ? (
            // World Labs (Marble) 3D world scene. Renders the thumbnail
            // as a poster while collapsed, and swaps to the public 360°
            // equirectangular panorama on expand so the user can see
            // the full rendered scene directly in-dashboard. Falls
            // back to the Marble viewer iframe if the panorama URL is
            // not yet persisted in metadata (legacy rows) — but those
            // iframes will hit the "no permission" page for worlds
            // generated before PR #45's permission fix, since Marble
            // defaults new worlds to private and has no API to flip
            // them retroactively.
            <WorldScenePreview
              viewerUrl={asset.mediaUrl}
              thumbnailUrl={thumbnailUrl}
              {...(worldPanoUrl !== undefined ? { panoUrl: worldPanoUrl } : {})}
              title={label}
              description={asset.content}
            />
          ) : (
            <motion.img
              src={asset.mediaUrl}
              alt={label}
              className="w-full rounded-lg bg-surface-800 object-cover min-h-[200px]"
              loading="lazy"
              initial={{ opacity: 0, scale: 1.02 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
            />
          )}
          {/* Thin overlay label bar — replaces the full header for media cards */}
          <div className="absolute bottom-0 inset-x-0 z-[5] flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-t from-black/70 to-transparent rounded-b-lg pointer-events-none">
            <span className="font-mono text-xs font-semibold text-white/90 truncate">{label}</span>
            <div className="pointer-events-auto">
              <LaunchStatusBadge status={asset.status} />
            </div>
          </div>
        </div>
      ) : asset.type === 'product_video' && remotionProps ? (
        <div className="mb-4">
          <LaunchVideoPreview
            videoUrl={videoVariant === 'narrated' ? narratedPreviewUrl : null}
            title={label}
            {...(thumbnailUrl !== undefined ? { thumbnailUrl } : {})}
            remotionProps={videoVariant === 'visual' ? remotionProps : null}
            {...(videoVariant === 'narrated'
              ? {
                  onError: () =>
                    setVideoError(
                      'Narrated preview is unavailable. Check the voiceover asset and ElevenLabs configuration.'
                    ),
                  onLoadedData: () => setVideoError(null),
                }
              : {})}
          />
        </div>
      ) : asset.content ? (
        <div className="mb-4 relative">
          {/* Copy affordances in the top-right corner of the
              content area. Shows a "Copy as markdown" button for
              structured assets alongside the plain-text copy, both
              visible on hover so they don't clutter the resting
              state. */}
          <div className="absolute right-0 top-0 z-10 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
            {markdownForCopy !== null && (
              <CopyButton value={markdownForCopy} label="Copy markdown" />
            )}
            <CopyButton value={asset.content} />
          </div>
          <motion.div
            layout
            className={`relative text-sm text-surface-300 leading-relaxed ${
              expanded ? '' : 'max-h-[360px] overflow-hidden'
            }`}
          >
            <WrittenAssetContent asset={asset} />
          </motion.div>
          {/* Gradient fade when clamped so the cutoff reads as
              intentional, not arbitrary. */}
          {!expanded && contentNeedsClamp && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface-900 to-transparent" />
          )}
          {contentNeedsClamp && (
            <motion.button
              type="button"
              onClick={() => setExpanded(!expanded)}
              whileTap={{ scale: 0.97 }}
              className="btn-ghost text-xs mt-2 flex items-center gap-1"
            >
              {expanded ? 'Show less' : 'Show more'}
              <motion.svg
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </motion.svg>
            </motion.button>
          )}
        </div>
      ) : asset.status === 'failed' ? (
        <FailedAssetBody />
      ) : null}

      {asset.type === 'product_video' && videoError ? (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-500/15 bg-red-500/[0.04] px-3 py-2.5"
        >
          <svg
            className="h-4 w-4 flex-shrink-0 text-red-400/70 mt-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <p className="text-body-xs text-red-300/80 leading-relaxed">
            {videoError}
          </p>
        </motion.div>
      ) : null}

      {/* Review Notes */}
      {asset.reviewNotes && !isMedia && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-4 p-3 bg-surface-800/50 rounded-lg border border-surface-700/50"
        >
          <p className="text-xs font-mono text-surface-500 mb-1 flex items-center gap-1">
            <svg
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            Creative Director Notes
          </p>
          <p className="text-sm text-surface-300">{asset.reviewNotes}</p>
        </motion.div>
      )}

      {/* Actions — for media cards these now live in the lightbox.
          Non-media cards (written, audio) keep the inline footer. */}
      {!isInProgress && hasPreview && !isMedia && (
        <div className="flex items-center gap-2 pt-3 border-t border-surface-800">
          <AnimatePresence mode="wait" initial={false}>
            {asset.userApproved === null ? (
              <motion.div
                key="review-buttons"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <Tooltip label="Approve this asset">
                  <motion.button
                    type="button"
                    onClick={() => void handleApprove()}
                    whileTap={{ scale: 0.94 }}
                    className="btn-ghost text-accent-400 text-sm flex items-center gap-1.5"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Approve
                  </motion.button>
                </Tooltip>
                <Tooltip label="Reject this asset">
                  <motion.button
                    type="button"
                    onClick={() => void handleReject()}
                    whileTap={{ scale: 0.94 }}
                    className="btn-ghost text-red-400 text-sm flex items-center gap-1.5"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                    Reject
                  </motion.button>
                </Tooltip>
              </motion.div>
            ) : (
              <motion.span
                key="review-result"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                className={`text-xs flex items-center gap-1.5 ${
                  asset.userApproved ? 'text-accent-400' : 'text-red-400'
                }`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={
                      asset.userApproved
                        ? 'M5 13l4 4L19 7'
                        : 'M6 18L18 6M6 6l12 12'
                    }
                  />
                </svg>
                {asset.userApproved ? 'Approved' : 'Rejected'}
              </motion.span>
            )}
          </AnimatePresence>
          {asset.type === 'product_video' && remotionProps ? (
            <Tooltip label="Download the rendered visual cut">
              <a
                href={`/api/assets/${asset.id}/video.mp4?download=1`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost text-surface-400 text-sm flex items-center gap-1.5"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                MP4
              </a>
            </Tooltip>
          ) : null}
          {hasNarratedVariant ? (
            <Tooltip label="Toggle between visual and narrated cut">
              <motion.button
                type="button"
                onClick={() => {
                  setVideoVariant(videoVariant === 'visual' ? 'narrated' : 'visual');
                  setVideoError(null);
                }}
                whileTap={{ scale: 0.94 }}
                className="btn-ghost text-surface-400 text-sm"
              >
                {videoVariant === 'visual' ? 'Narrated cut' : 'Visual cut'}
              </motion.button>
            </Tooltip>
          ) : null}
          {hasNarratedVariant ? (
            <Tooltip label="Download the narrated MP4">
              <motion.button
                type="button"
                onClick={() => void handleExportNarrated()}
                disabled={exportingNarrated}
                whileTap={{ scale: 0.94 }}
                className="btn-ghost text-surface-400 text-sm"
              >
                {exportingNarrated ? 'Exporting...' : 'Export narrated'}
              </motion.button>
            </Tooltip>
          ) : null}
          <div className="flex-1" />
          {IMAGE_ASSET_TYPES.has(asset.type) ? (
            <ModelSelector
              label="Image"
              value={selectedModel}
              options={IMAGE_MODEL_OPTIONS}
              onChange={setSelectedModel}
            />
          ) : VIDEO_ASSET_TYPES.has(asset.type) ? (
            <ModelSelector
              label="Video"
              value={selectedModel}
              options={VIDEO_MODEL_OPTIONS}
              onChange={setSelectedModel}
            />
          ) : null}
          <Tooltip label="Discard this version and regenerate">
            <motion.button
              type="button"
              onClick={() => void handleRegenerate()}
              disabled={regenerating}
              whileTap={{ scale: 0.94 }}
              className="btn-ghost text-surface-400 text-sm flex items-center gap-1.5 disabled:opacity-60"
            >
              <motion.svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                animate={
                  regenerating && !shouldReduceMotion
                    ? { rotate: 360 }
                    : { rotate: 0 }
                }
                transition={
                  regenerating && !shouldReduceMotion
                    ? { duration: 1, repeat: Infinity, ease: 'linear' }
                    : { duration: 0.3 }
                }
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </motion.svg>
              {regenerating ? 'Regenerating' : 'Regenerate'}
            </motion.button>
          </Tooltip>
        </div>
      )}
    </motion.div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────

function QualityScoreRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(10, score)) / 10;
  const circumference = 2 * Math.PI * 10;
  const color =
    score >= 7
      ? 'text-accent-400'
      : score >= 5
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <Tooltip label={`Quality score: ${score.toFixed(1)} / 10`}>
      <div className={`relative flex h-7 w-7 items-center justify-center ${color}`}>
        <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full -rotate-90">
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={2}
          />
          <motion.circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - pct) }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          />
        </svg>
        <span className="font-mono text-[10px] font-bold">{score.toFixed(1)}</span>
      </div>
    </Tooltip>
  );
}

function InProgressBody({ tintText }: { tintText: string }) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="relative overflow-hidden py-8 flex flex-col items-center justify-center text-surface-500 min-h-[140px]">
      {/* Shimmer sweep backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      </div>
      <motion.div
        className={`relative mb-3 ${tintText}`}
        animate={shouldReduceMotion ? { rotate: 0 } : { rotate: 360 }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : { duration: 1.4, repeat: Infinity, ease: 'linear' }
        }
      >
        <svg className="h-8 w-8" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </motion.div>
      <motion.p
        className="text-sm"
        initial={{ opacity: 0.6 }}
        animate={shouldReduceMotion ? { opacity: 1 } : { opacity: [0.6, 1, 0.6] }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : { duration: 2, repeat: Infinity, ease: 'easeInOut' }
        }
      >
        Generating...
      </motion.p>
    </div>
  );
}

function FailedAssetBody() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="py-8 flex flex-col items-center gap-3"
    >
      <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
        <svg
          className="h-5 w-5 text-red-400/80"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-body-sm text-red-300/80 font-medium">
          Generation failed
        </p>
        <p className="text-body-xs text-text-muted mt-1">
          Try regenerating this asset
        </p>
      </div>
    </motion.div>
  );
}

// World Labs (Marble) 3D walk-through preview.
//
// Two-stage rendering: the thumbnail (if present) loads instantly as
// a poster image; tapping "Launch walk-through" swaps to the iframe
// embed so the heavy Marble viewer only loads when the user asks
// for it. The description text under the preview gives the user
// the prompt context — what the scene is depicting — so they can
// decide whether to launch the viewer without spinning up the 3D
// runtime. The "open in new tab" affordance lets the user escape
// to a full-screen Marble experience for the demo.
//
// Expanded view preference order when the user clicks "Launch walk-through":
//
//   1. If `panoUrl` is present on the asset's metadata.worldLabs, show
//      the public 360° equirectangular panorama directly as an <img>.
//      This works for EVERY world we generate, regardless of whether
//      the world was marked public or private on the Marble side,
//      because the CDN at cdn.marble.worldlabs.ai is publicly readable
//      even when the Marble viewer's per-world permission blocks access.
//
//   2. Otherwise, fall back to iframing the Marble viewer URL. This is
//      the only option for very old worlds whose panoUrl was not yet
//      persisted in metadata. The iframe works correctly for worlds
//      generated with `permission: { public: true, allow_id_access: true }`,
//      which is the default for every world generated by LaunchKit
//      post-PR #45. Worlds generated before that PR shipped with
//      `permission: { public: false, allow_id_access: false }` and
//      the iframe will render the Marble viewer's "no permission to
//      view this world" page for them — we cannot fix those legacy
//      worlds because the Marble API has no PATCH/PUT/share endpoint
//      to toggle permission post-creation.
//
// Sandbox on the iframe: we do NOT allow-forms or allow-popups or
// allow-top-navigation because the embedded viewer should not be
// able to navigate the host page. The Marble viewer needs
// `allow-scripts` and `allow-same-origin` to run its WebGL runtime,
// and we grant those because we trust the marble.worldlabs.ai
// domain (it's the same domain we POST to from the worker). If
// world-labs ever adds cross-origin iframe guidance, revisit this.
function WorldScenePreview({
  viewerUrl,
  thumbnailUrl,
  panoUrl,
  title,
  description,
}: {
  viewerUrl: string;
  thumbnailUrl: string | undefined;
  panoUrl?: string;
  title: string;
  description: string | null;
}) {
  const [launched, setLaunched] = useState(false);

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-lg bg-surface-800 aspect-video">
        {launched && panoUrl !== undefined ? (
          // Show the public CDN 360° panorama inline. Works
          // regardless of the world's Marble-side permission.
          <motion.img
            key={panoUrl}
            src={panoUrl}
            alt={title}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          />
        ) : launched ? (
          <iframe
            key={viewerUrl}
            src={viewerUrl}
            title={title}
            className="absolute inset-0 h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            allow="xr-spatial-tracking"
          />
        ) : thumbnailUrl !== undefined ? (
          <>
            <motion.img
              src={thumbnailUrl}
              alt={title}
              className="h-full w-full object-cover"
              loading="lazy"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface-900/90 via-surface-900/20 to-transparent" />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-lime-300/60 text-xs font-mono">
              3D scene ready · tap to walk through
            </div>
          </div>
        )}

        {!launched && (
          <div className="absolute inset-0 flex items-end justify-center p-4">
            <motion.button
              type="button"
              onClick={() => setLaunched(true)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-2 rounded-full bg-lime-500/90 px-4 py-2 text-sm font-medium text-surface-950 shadow-lg shadow-lime-500/30 backdrop-blur"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Launch walk-through
            </motion.button>
          </div>
        )}

        <a
          href={viewerUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-surface-950/70 px-2 py-1 text-[10px] font-mono uppercase tracking-wide text-lime-300 backdrop-blur hover:bg-surface-950/90 transition-colors"
          title="Open in a new tab"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
          Marble
        </a>
      </div>

      {description !== null && description.length > 0 && (
        <p className="mt-3 text-xs text-surface-400 leading-relaxed">
          <span className="font-mono uppercase tracking-wide text-lime-400/70">
            Scene prompt —{' '}
          </span>
          {description}
        </p>
      )}
    </div>
  );
}
