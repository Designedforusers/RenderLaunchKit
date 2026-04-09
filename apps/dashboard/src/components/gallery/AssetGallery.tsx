import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { Asset } from '../../lib/api.js';
import { AnimatedAssetGrid } from '../pipeline/AnimatedAssetGrid.js';
import {
  ASSET_CATEGORY_DESCRIPTIONS,
  ASSET_CATEGORY_LABELS,
  ASSET_CATEGORY_ORDER,
  groupAssetsByCategory,
  type AssetCategory,
} from './asset-categories.js';

type GalleryTab = 'all' | AssetCategory;

/**
 * The complete tab list. `'all'` is surfaced first so the default view
 * still presents every asset — users can glance the kit shape before
 * drilling into a specific category.
 */
const TAB_ORDER: readonly GalleryTab[] = [
  'all',
  ...ASSET_CATEGORY_ORDER,
] as const;

const TAB_LABELS: Record<GalleryTab, string> = {
  all: 'All',
  ...ASSET_CATEGORY_LABELS,
};

interface AssetGalleryProps {
  assets: readonly Asset[];
  /** Expected total asset count from the strategy, drives skeleton slots. */
  expectedCount: number;
  isGenerating: boolean;
  /**
   * Per-asset render function. The gallery owns tab navigation,
   * section layout, and grid animation — the actual card is injected
   * so this component stays decoupled from `GeneratedAssetCard`.
   */
  renderAsset: (asset: Asset) => ReactNode;
}

/**
 * Tabbed asset gallery for the launch kit.
 *
 * Four-category view ("Visuals | Videos | Audio | Written") plus an
 * "All" tab that collapses everything into sectioned headers. The
 * All tab is the default because it's the most useful "read the
 * whole kit at once" shape; the specific tabs are for when a user
 * wants to focus on one medium at a time (e.g., pulling up just
 * the social images to hand to a designer).
 *
 * Layout responsibilities:
 *   - Tab bar with Framer Motion layoutId indicator that slides
 *     between tabs on click (the kind of detail that makes the
 *     demo video land).
 *   - Per-tab count badges so reviewers can see the kit shape at a
 *     glance ("Visuals 3, Videos 1, Audio 0, Written 6").
 *   - Empty-state per tab when the generator hasn't produced any
 *     asset of that type — "no audio yet" with a one-line hint.
 *   - Layout animations on tab changes so the transition doesn't
 *     feel like a hard page swap.
 *
 * Accessibility:
 *   - Tabs use `role="tablist"` / `role="tab"` with `aria-selected`
 *     and `aria-controls` wiring so screen readers narrate the
 *     selection correctly.
 *   - Active panel has `role="tabpanel"` + matching `id`.
 *   - Tab buttons are focus-visible and keyboard-navigable by
 *     default (left/right arrow navigation is deferred — not
 *     worth the complexity for a 5-tab bar).
 */
export function AssetGallery({
  assets,
  expectedCount,
  isGenerating,
  renderAsset,
}: AssetGalleryProps) {
  const [activeTab, setActiveTab] = useState<GalleryTab>('all');
  const shouldReduceMotion = useReducedMotion();

  // Group once per render and memoise — the downstream components
  // read from this repeatedly and we don't want an O(n) re-walk on
  // every tab change or hover.
  const grouped = useMemo(
    () => groupAssetsByCategory(assets),
    [assets]
  );

  // Per-category counts for the tab bar badges. Recomputed with the
  // group so they never drift from what the tab panel shows.
  const counts: Record<GalleryTab, number> = useMemo(
    () => ({
      all: assets.length,
      visuals: grouped.visuals.length,
      videos: grouped.videos.length,
      audio: grouped.audio.length,
      written: grouped.written.length,
    }),
    [assets.length, grouped]
  );

  return (
    <div>
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Asset categories"
        className="mb-6 flex flex-wrap items-center gap-1 border-b border-surface-800"
      >
        {TAB_ORDER.map((tab) => {
          const isActive = tab === activeTab;
          const count = counts[tab];
          return (
            <button
              key={tab}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`gallery-panel-${tab}`}
              id={`gallery-tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`relative px-4 py-2.5 text-label uppercase transition-colors ${
                isActive
                  ? 'text-accent-400'
                  : 'text-text-muted hover:text-text-tertiary'
              } focus-visible:outline-none focus-visible:text-accent-300`}
            >
              <span className="inline-flex items-center gap-2">
                {TAB_LABELS[tab]}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      isActive
                        ? 'bg-accent-500/20 text-accent-300'
                        : 'bg-surface-800 text-surface-500'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </span>
              {isActive && (
                <motion.span
                  layoutId="gallery-tab-underline"
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent-400"
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 380, damping: 30 }
                  }
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab panels — AnimatePresence swaps the body on tab change
          with a quick cross-fade. `mode="wait"` so the old panel
          finishes its exit before the new one enters, preventing
          a brief double-grid. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          role="tabpanel"
          id={`gallery-panel-${activeTab}`}
          aria-labelledby={`gallery-tab-${activeTab}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
          }
        >
          {activeTab === 'all' ? (
            <AllCategoriesPanel
              grouped={grouped}
              expectedCount={expectedCount}
              isGenerating={isGenerating}
              renderAsset={renderAsset}
              totalAssets={assets.length}
            />
          ) : (
            <SingleCategoryPanel
              category={activeTab}
              assets={grouped[activeTab]}
              isGenerating={isGenerating}
              renderAsset={renderAsset}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── All-categories view ──
//
// Shows every non-empty category as its own section with a heading.
// Empty categories are hidden on the All tab (there's no point
// showing "Audio (0)" three times when the user can see the count
// on the tab bar above). If the user wants to verify a category is
// genuinely empty they can click that tab for the dedicated empty
// state.

function AllCategoriesPanel({
  grouped,
  expectedCount,
  isGenerating,
  renderAsset,
  totalAssets,
}: {
  grouped: Record<AssetCategory, Asset[]>;
  expectedCount: number;
  isGenerating: boolean;
  renderAsset: (asset: Asset) => ReactNode;
  totalAssets: number;
}) {
  // Eagerly show the visuals skeletons while the generate phase
  // runs so the grid doesn't collapse to zero between analyze and
  // generate. We split the expected count proportionally — the
  // gallery has no way to know *which* assets the strategy will
  // produce until they land, so we default to putting unknown
  // slots in the "written" bucket (the biggest category).
  const unknownSlotsTarget = Math.max(0, expectedCount - totalAssets);

  const nonEmptySections = ASSET_CATEGORY_ORDER.filter(
    (category) => grouped[category].length > 0
  );

  // Early empty state: no assets at all and we're not mid-generation.
  if (totalAssets === 0 && !isGenerating) {
    return <GalleryEmptyState tone="all" />;
  }

  return (
    <div className="space-y-8">
      {nonEmptySections.map((category) => (
        <CategorySection
          key={category}
          category={category}
          assets={grouped[category]}
          isGenerating={false}
          renderAsset={renderAsset}
        />
      ))}

      {/* Unassigned skeleton grid while generation is in flight and
          we don't know which category the next assets will land in.
          We park the unknowns in their own "Generating…" section
          below the real sections so the user can see new cards
          appear there and watch them migrate into their real
          category once the strategy assignments land. */}
      {isGenerating && unknownSlotsTarget > 0 && (
        <div>
          <SectionHeader
            label="Generating…"
            description="Worker is still producing assets"
            count={unknownSlotsTarget}
            tone="pending"
          />
          <AnimatedAssetGrid
            assets={[]}
            expectedCount={unknownSlotsTarget}
            isGenerating
            className="grid gap-4 md:grid-cols-2"
            renderAsset={renderAsset}
          />
        </div>
      )}
    </div>
  );
}

// ── Single-category view ──
//
// One category's assets in a flat grid. Shows a dedicated empty
// state when the category has zero assets and the pipeline is
// complete, instead of a bare grid.

function SingleCategoryPanel({
  category,
  assets,
  isGenerating,
  renderAsset,
}: {
  category: AssetCategory;
  assets: Asset[];
  isGenerating: boolean;
  renderAsset: (asset: Asset) => ReactNode;
}) {
  if (assets.length === 0 && !isGenerating) {
    return <GalleryEmptyState tone={category} />;
  }

  return (
    <CategorySection
      category={category}
      assets={assets}
      isGenerating={isGenerating && assets.length === 0}
      renderAsset={renderAsset}
      hideHeader
    />
  );
}

// ── Section rendering helpers ──

function CategorySection({
  category,
  assets,
  isGenerating,
  renderAsset,
  hideHeader = false,
}: {
  category: AssetCategory;
  assets: Asset[];
  isGenerating: boolean;
  renderAsset: (asset: Asset) => ReactNode;
  hideHeader?: boolean;
}) {
  // Layout choice: visuals and videos get a 2-column grid (media
  // cards benefit from the wider tiles); audio and written get a
  // 1-column vertical list because the cards carry more text and
  // read better at full width.
  const isWideLayout = category === 'visuals' || category === 'videos';
  const gridClassName = isWideLayout
    ? 'grid gap-4 sm:grid-cols-2'
    : 'grid gap-4';

  return (
    <div>
      {!hideHeader && (
        <SectionHeader
          label={ASSET_CATEGORY_LABELS[category]}
          description={ASSET_CATEGORY_DESCRIPTIONS[category]}
          count={assets.length}
          tone={category}
        />
      )}
      <AnimatedAssetGrid
        assets={assets}
        expectedCount={assets.length}
        isGenerating={isGenerating}
        className={gridClassName}
        renderAsset={renderAsset}
      />
    </div>
  );
}

// ── Section header ──
//
// Shared by the category sections and the "Generating…" fallback.
// Uses a tone-based accent colour (same palette as the asset card
// tints) so each section reads with its own identity.

function SectionHeader({
  label,
  description,
  count,
  tone,
}: {
  label: string;
  description: string;
  count: number;
  tone: AssetCategory | 'pending';
}) {
  const toneClasses: Record<typeof tone, string> = {
    visuals: 'text-violet-300',
    videos: 'text-accent-300',
    audio: 'text-yellow-300',
    written: 'text-blue-300',
    pending: 'text-surface-500',
  };

  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <div>
        <h3 className={`text-label uppercase ${toneClasses[tone]}`}>
          {label}{' '}
          <span className="ml-1 text-body-xs font-normal text-text-muted normal-case tracking-normal">
            ({count})
          </span>
        </h3>
        <p className="mt-1 text-body-xs text-text-muted">{description}</p>
      </div>
    </div>
  );
}

// ── Empty state ──

function GalleryEmptyState({ tone }: { tone: AssetCategory | 'all' }) {
  const messages: Record<typeof tone, { title: string; body: string }> = {
    all: {
      title: 'No assets generated yet',
      body: 'Kick off a launch run to see visuals, videos, audio, and written content populate here.',
    },
    visuals: {
      title: 'No visuals yet',
      body: 'This kit didn\u2019t generate any OG images, social cards, or 3D scenes — the strategy agent chose a text-first approach.',
    },
    videos: {
      title: 'No videos yet',
      body: 'Video assets are high-impact but expensive; the strategy agent skipped them for this product.',
    },
    audio: {
      title: 'No audio yet',
      body: 'Voice commercials and podcast scripts need ELEVENLABS_API_KEY to render. If you set it and re-run, audio will land here.',
    },
    written: {
      title: 'No written assets yet',
      body: 'Something unusual happened — every launch kit should include at least a blog post. Check the job history.',
    },
  };
  const message = messages[tone];

  return (
    <div className="rounded-2xl border border-dashed border-surface-800 py-12 text-center">
      <span className="mb-2 block text-2xl text-surface-700">~</span>
      <p className="text-sm text-surface-300">{message.title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-surface-500">
        {message.body}
      </p>
    </div>
  );
}
