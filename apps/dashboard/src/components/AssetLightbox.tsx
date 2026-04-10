import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type { Asset } from '../lib/api.js';
import { LaunchStatusBadge } from './LaunchStatusBadge.js';
import { LaunchVideoPreview } from './LaunchVideoPreview.js';
import { Tooltip } from './ui/index.js';
import type { LaunchKitVideoProps } from '@launchkit/video';

interface AssetLightboxProps {
  asset: Asset;
  onClose: () => void;
  /** Action handlers lifted from the card so the lightbox can drive them. */
  actions?: {
    onApprove?: () => void;
    onReject?: () => void;
    onRegenerate?: () => void;
    regenerating?: boolean;
  };
}

/**
 * Full-viewport lightbox for media assets (images, videos, 3D).
 *
 * Rendered via `createPortal` into `document.body` so it escapes
 * the card's `overflow-hidden` ancestor. Opens with a fast
 * scale+fade, closes on Escape, backdrop click, or close button.
 *
 * Design: Manus.im-style centered media with bottom action bar
 * containing metadata + approve/reject/regenerate + download.
 */
export function AssetLightbox({ asset, onClose, actions }: AssetLightboxProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const metadata = asset.metadata ?? null;
  const remotionProps =
    asset.type === 'product_video'
      ? ((metadata?.['remotionProps'] as LaunchKitVideoProps | undefined) ?? null)
      : null;

  const worldLabsMetadata =
    asset.type === 'world_scene' &&
    typeof metadata?.['worldLabs'] === 'object' &&
    metadata['worldLabs'] !== null
      ? (metadata['worldLabs'] as Record<string, unknown>)
      : null;
  const worldPanoUrl =
    typeof worldLabsMetadata?.['panoUrl'] === 'string'
      ? worldLabsMetadata['panoUrl']
      : undefined;
  const thumbnailUrl =
    typeof metadata?.['thumbnailUrl'] === 'string'
      ? metadata['thumbnailUrl']
      : typeof worldLabsMetadata?.['thumbnailUrl'] === 'string'
        ? (worldLabsMetadata['thumbnailUrl'])
        : undefined;

  const label = ASSET_TYPE_LABELS[asset.type] ?? asset.type;

  const content = (
    <motion.div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Backdrop — clicking the dark area closes the lightbox */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-surface-900/80 border border-surface-700 text-surface-300 hover:text-white hover:bg-surface-800 transition-colors"
        aria-label="Close lightbox"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Content — stop propagation so clicks inside don't close */}
      <motion.div
        className="relative z-10 flex max-h-[90vh] max-w-[90vw] flex-col items-center"
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Media — takes priority in the flex column */}
        <div className="overflow-hidden rounded-xl shadow-2xl flex-1 min-h-0 flex items-center justify-center">
          {asset.type === 'product_video' ? (
            <div className="w-[80vw] max-w-4xl">
              <LaunchVideoPreview
                videoUrl={asset.mediaUrl ?? null}
                title={label}
                remotionProps={remotionProps}
                {...(thumbnailUrl !== undefined ? { thumbnailUrl } : {})}
              />
            </div>
          ) : asset.type === 'world_scene' ? (
            <div className="w-[80vw] max-w-4xl aspect-video bg-surface-900 rounded-xl overflow-hidden">
              {worldPanoUrl ? (
                <img src={worldPanoUrl} alt="3D World Scene panorama" className="w-full h-full object-cover" />
              ) : asset.mediaUrl ? (
                <iframe src={asset.mediaUrl} title="3D World Scene" className="w-full h-full border-0" allow="xr-spatial-tracking" />
              ) : thumbnailUrl ? (
                <img src={thumbnailUrl} alt="3D World Scene" className="w-full h-full object-cover" />
              ) : null}
            </div>
          ) : asset.mediaUrl ? (
            <img
              src={asset.mediaUrl}
              alt={label}
              className="max-h-[78vh] max-w-[85vw] object-contain rounded-xl"
            />
          ) : null}
        </div>

        {/* Bottom action bar */}
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-surface-900/95 border border-surface-800 px-5 py-2.5 text-sm backdrop-blur-sm shrink-0">
          {/* Label + status */}
          <span className="font-mono font-semibold text-surface-100">{label}</span>
          <LaunchStatusBadge status={asset.status} />

          {/* Metadata */}
          <span className="text-surface-600">v{asset.version}</span>
          {asset.costCents > 0 && (
            <span className="font-mono text-surface-400">${(asset.costCents / 100).toFixed(2)}</span>
          )}
          {asset.qualityScore !== null && (
            <Tooltip label={`Quality score: ${asset.qualityScore}/10`}>
              <span className={`font-mono font-semibold ${asset.qualityScore >= 7 ? 'text-accent-400' : asset.qualityScore >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
                {asset.qualityScore}/10
              </span>
            </Tooltip>
          )}
          {asset.userEdited && (
            <span className="text-amber-400 text-xs">edited</span>
          )}

          {/* Separator */}
          <div className="w-px h-5 bg-surface-700 mx-1" />

          {/* Actions */}
          {actions && asset.userApproved === null && (
            <>
              {actions.onApprove && (
                <button
                  type="button"
                  onClick={actions.onApprove}
                  className="flex items-center gap-1.5 text-accent-400 hover:text-accent-300 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Approve
                </button>
              )}
              {actions.onReject && (
                <button
                  type="button"
                  onClick={actions.onReject}
                  className="flex items-center gap-1.5 text-red-400 hover:text-red-300 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Reject
                </button>
              )}
            </>
          )}
          {actions && asset.userApproved !== null && (
            <span className={`text-xs flex items-center gap-1 ${asset.userApproved ? 'text-accent-400' : 'text-red-400'}`}>
              {asset.userApproved ? 'Approved' : 'Rejected'}
            </span>
          )}

          {actions?.onRegenerate && (
            <button
              type="button"
              onClick={actions.onRegenerate}
              disabled={actions.regenerating}
              className="flex items-center gap-1.5 text-surface-400 hover:text-white transition-colors disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {actions.regenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
          )}

          {/* Download link */}
          {asset.mediaUrl && (
            <a
              href={asset.type === 'product_video' ? `/api/assets/${asset.id}/video.mp4?download=1` : asset.mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-surface-400 hover:text-white transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </a>
          )}
        </div>

        {/* Review notes — clamped so they don't push the image off-screen */}
        {asset.reviewNotes && (
          <div className="mt-3 max-w-2xl rounded-lg bg-surface-900/90 border border-surface-800 px-4 py-3 backdrop-blur-sm max-h-24 overflow-y-auto">
            <p className="text-xs font-mono text-surface-500 mb-1">Creative Director Notes</p>
            <p className="text-xs text-surface-400 line-clamp-3">{asset.reviewNotes}</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  return createPortal(content, document.body);
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
