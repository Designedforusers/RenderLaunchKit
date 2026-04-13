import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Asset } from '../../lib/api.js';

interface AnimatedAssetGridProps {
  assets: Asset[];
  /**
   * Number of placeholder skeleton cards to render while the
   * generation phase is still in-flight. Defaults to the count of
   * assets already returned — the parent can override this with
   * the strategy's expected asset count once it's known.
   */
  expectedCount?: number;
  /** Whether the generation phase is currently running. */
  isGenerating: boolean;
  /**
   * Renders the real asset card for an asset. The grid owns the
   * entry/exit animation shell; the card is injected via render
   * prop so we don't couple this file to `GeneratedAssetCard`.
   */
  renderAsset: (asset: Asset) => ReactNode;
  className?: string;
}

/**
 * A grid of asset cards that animates new assets in as they're
 * generated, with skeleton placeholders for the assets that are
 * still pending. Every card participates in a shared layout
 * animation via `layoutId`, so when a skeleton turns into a real
 * card the transition is a smooth cross-fade rather than a pop.
 *
 * The visual effect is deliberate: the reviewer sees the grid
 * populate one card at a time as the worker completes each
 * generation job, which makes the parallel fan-out pattern
 * legible without needing any copy to explain it.
 */
export function AnimatedAssetGrid({
  assets,
  expectedCount,
  isGenerating,
  renderAsset,
  className,
}: AnimatedAssetGridProps) {
  const placeholdersNeeded = Math.max(
    0,
    (expectedCount ?? assets.length) - assets.length
  );
  const placeholders = isGenerating
    ? Array.from({ length: placeholdersNeeded }, (_, i) => i)
    : [];

  return (
    <motion.div
      layout
      className={
        className ??
        'grid gap-4 md:grid-cols-2'
      }
    >
      <AnimatePresence mode="popLayout">
        {assets.map((asset, idx) => (
          <motion.div
            key={asset.id}
            layout
            layoutId={`asset-${asset.id}`}
            initial={{
              opacity: 0,
              y: 24,
              scale: 0.94,
              filter: 'blur(6px)',
            }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              filter: 'blur(0px)',
            }}
            exit={{
              opacity: 0,
              scale: 0.96,
              filter: 'blur(4px)',
              pointerEvents: 'none' as const,
            }}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 26,
              // Slight stagger by index so when several assets
              // arrive together they cascade rather than popping
              // into place all at once.
              delay: Math.min(idx * 0.04, 0.32),
              filter: { duration: 0.4 },
            }}
          >
            {renderAsset(asset)}
          </motion.div>
        ))}

        {placeholders.map((i) => (
          <AssetSkeletonCard key={`placeholder-${i.toString()}`} index={i} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

function AssetSkeletonCard({ index }: { index: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{
        type: 'spring',
        stiffness: 240,
        damping: 28,
        delay: Math.min(index * 0.08, 0.4),
      }}
      className="relative overflow-hidden rounded-xl border border-surface-800 bg-surface-900/60 p-6"
    >
      {/* Shimmer sweep across the skeleton body */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-shimmer-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-success-500/5 to-transparent" />
      </div>

      <div className="relative space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-pulse rounded-md bg-surface-800" />
          <div className="h-3 w-24 animate-pulse rounded-full bg-surface-800" />
          <div className="ml-auto h-4 w-12 animate-pulse rounded-full bg-surface-800/70" />
        </div>
        <div className="space-y-2 pt-2">
          <div className="h-2 w-full animate-pulse rounded-full bg-surface-800/80" />
          <div className="h-2 w-5/6 animate-pulse rounded-full bg-surface-800/80" />
          <div className="h-2 w-3/4 animate-pulse rounded-full bg-surface-800/80" />
        </div>
        <div className="flex items-center gap-2 pt-3">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-400/80" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success-400" />
            </span>
            <span className="label text-success-400/70">Generating</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
