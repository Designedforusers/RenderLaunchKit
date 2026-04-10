import { useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type { Asset } from '../lib/api.js';
import { LaunchVideoPreview } from './LaunchVideoPreview.js';
import type { LaunchKitVideoProps } from '@launchkit/video';

// ── World scene preview (inline to avoid circular dep) ──
// The full WorldScenePreview in GeneratedAssetCard handles a
// two-stage thumbnail→viewer transition. The lightbox always
// shows the expanded form, so we skip the poster stage.

interface AssetLightboxProps {
  asset: Asset | null;
  onClose: () => void;
}

/**
 * Full-viewport lightbox for media assets (images, videos, 3D).
 *
 * Rendered via a portal-free `AnimatePresence` wrapper at the card
 * level. Opens with a fast scale+fade, closes on Escape, backdrop
 * click, or the explicit close button.
 *
 * Design references: Manus.im lightbox (dark overlay, centered
 * image, bottom toolbar), Luma (minimal close-X overlay),
 * Netflix (16:9 centered media with close control).
 */
export function AssetLightbox({ asset, onClose }: AssetLightboxProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // Prevent body scroll while open.
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  if (!asset) return null;

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

  return (
    <motion.div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-surface-900/80 border border-surface-700 text-surface-300 hover:text-white hover:bg-surface-800 transition-colors"
        aria-label="Close lightbox"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      {/* Content */}
      <motion.div
        className="relative z-10 flex max-h-[90vh] max-w-[90vw] flex-col items-center"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Media */}
        <div className="overflow-hidden rounded-xl shadow-2xl">
          {asset.type === 'product_video' ? (
            <div className="w-[80vw] max-w-4xl">
              <LaunchVideoPreview
                videoUrl={asset.mediaUrl ?? null}
                title={asset.type}
                remotionProps={remotionProps}
                {...(thumbnailUrl !== undefined ? { thumbnailUrl } : {})}
              />
            </div>
          ) : asset.type === 'world_scene' ? (
            <div className="w-[80vw] max-w-4xl aspect-video bg-surface-900 rounded-xl overflow-hidden">
              {worldPanoUrl ? (
                <img
                  src={worldPanoUrl}
                  alt="3D World Scene panorama"
                  className="w-full h-full object-cover"
                />
              ) : asset.mediaUrl ? (
                <iframe
                  src={asset.mediaUrl}
                  title="3D World Scene"
                  className="w-full h-full border-0"
                  allow="xr-spatial-tracking"
                />
              ) : thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt="3D World Scene"
                  className="w-full h-full object-cover"
                />
              ) : null}
            </div>
          ) : asset.mediaUrl ? (
            <img
              src={asset.mediaUrl}
              alt={asset.type}
              className="max-h-[80vh] max-w-[85vw] object-contain rounded-xl"
            />
          ) : null}
        </div>

        {/* Bottom metadata bar */}
        <div className="mt-4 flex items-center gap-4 rounded-lg bg-surface-900/90 border border-surface-800 px-4 py-2.5 text-sm backdrop-blur-sm">
          <span className="font-mono font-semibold text-surface-100">
            {ASSET_TYPE_LABELS[asset.type] ?? asset.type}
          </span>
          {asset.costCents > 0 && (
            <span className="font-mono text-surface-400">
              ${(asset.costCents / 100).toFixed(2)}
            </span>
          )}
          {asset.mediaUrl && (
            <a
              href={asset.mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-surface-400 hover:text-white transition-colors"
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
              Open original
            </a>
          )}
          <span className="text-surface-600">
            v{asset.version}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Reuse label map — keep in sync with GeneratedAssetCard.
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
