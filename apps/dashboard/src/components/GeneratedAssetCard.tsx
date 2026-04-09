import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { api } from '../lib/api.js';
import type { Asset } from '../lib/api.js';
import { LaunchStatusBadge } from './LaunchStatusBadge.js';
import { LaunchVideoPreview } from './LaunchVideoPreview.js';
import { Tooltip, CopyButton, useToast } from './ui/index.js';
import type { LaunchKitVideoProps } from '@launchkit/video';

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
};

const DEFAULT_TINT = {
  from: 'from-surface-700/20',
  to: 'to-surface-700/5',
  text: 'text-surface-300',
};

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
  const { toast } = useToast();
  const shouldReduceMotion = useReducedMotion();

  const isMedia = ['og_image', 'social_card', 'product_video'].includes(asset.type);
  const isInProgress = ['queued', 'generating', 'regenerating'].includes(asset.status);
  const assetMetadata = asset.metadata ?? null;
  const remotionProps =
    asset.type === 'product_video'
      ? ((assetMetadata?.['remotionProps'] as LaunchKitVideoProps | undefined) ?? null)
      : null;
  const thumbnailUrl =
    typeof assetMetadata?.['thumbnailUrl'] === 'string'
      ? assetMetadata['thumbnailUrl']
      : undefined;
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
  const contentNeedsClamp = (asset.content?.length ?? 0) > 400;

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
      await api.regenerateAsset(asset.id);
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
      {/* Header */}
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

      {/* Content Preview */}
      {isInProgress ? (
        <InProgressBody tintText={tint.text} />
      ) : isMedia && asset.mediaUrl ? (
        <div className="mb-4">
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
          ) : (
            <motion.img
              src={asset.mediaUrl}
              alt={label}
              className="w-full rounded-lg bg-surface-800 object-cover"
              loading="lazy"
              initial={{ opacity: 0, scale: 1.02 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
            />
          )}
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
          {/* Copy affordance in the top-right corner of the content
              area, visible on hover so it doesn't clutter the resting
              state. */}
          <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
            <CopyButton value={asset.content} />
          </div>
          <motion.div
            layout
            className={`text-sm text-surface-300 leading-relaxed ${
              expanded ? '' : 'line-clamp-6'
            }`}
          >
            <pre className="whitespace-pre-wrap font-sans">{asset.content}</pre>
          </motion.div>
          {/* Gradient fade when clamped so the cutoff reads as
              intentional, not arbitrary. */}
          {!expanded && contentNeedsClamp && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-900 to-transparent" />
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
          animate={{ opacity: 1, y: 0, x: [0, -4, 4, -2, 2, 0] }}
          transition={{
            duration: 0.5,
            x: { duration: 0.4, ease: 'easeOut' },
          }}
          className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {videoError}
        </motion.div>
      ) : null}

      {/* Review Notes */}
      {asset.reviewNotes && (
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

      {/* Actions */}
      {!isInProgress && hasPreview && (
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
      animate={{ opacity: 1, y: 0, x: [0, -4, 4, -2, 2, 0] }}
      transition={{
        duration: 0.5,
        x: { duration: 0.4, ease: 'easeOut' },
      }}
      className="py-6 text-center text-red-400 text-sm flex flex-col items-center gap-2"
    >
      <svg
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      Generation failed
    </motion.div>
  );
}
