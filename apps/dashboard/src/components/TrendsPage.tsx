import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendUp,
  ArrowSquareOut,
  ArrowsClockwise,
  FunnelSimple,
  MagnifyingGlass,
  Globe,
  Lightning,
  Newspaper,
  Hash,
  CaretRight,
  CaretDown,
  X,
} from '@phosphor-icons/react';
import { api } from '../lib/api.js';
import type {
  TrendItem,
  TrendSearchResponse,
  InterestPoint,
  ExaResult,
  DiscoverItem,
} from '../lib/api.js';

// ── Source display config ────────────────────────────────────────────

const SOURCE_META: Record<string, { label: string; color: string }> = {
  hn: { label: 'Hacker News', color: 'text-orange-400 bg-orange-400/10 ring-orange-400/30' },
  devto: { label: 'DEV.to', color: 'text-teal-400 bg-teal-400/10 ring-teal-400/30' },
  reddit: { label: 'Reddit', color: 'text-red-400 bg-red-400/10 ring-red-400/30' },
  grok: { label: 'X / Grok', color: 'text-sky-400 bg-sky-400/10 ring-sky-400/30' },
  exa: { label: 'Exa', color: 'text-emerald-400 bg-emerald-400/10 ring-emerald-400/30' },
  producthunt: { label: 'Product Hunt', color: 'text-amber-400 bg-amber-400/10 ring-amber-400/30' },
  github: { label: 'GitHub', color: 'text-purple-400 bg-purple-400/10 ring-purple-400/30' },
  google_trends: { label: 'Google', color: 'text-green-400 bg-green-400/10 ring-green-400/30' },
};

const SUGGESTION_PILLS = [
  'AI agents',
  'sustainable fashion',
  'TikTok trends',
  'fintech',
  'remote work',
  'electric vehicles',
  'creator economy',
];

/** Initial number of trends shown before "Show more" */
const INITIAL_TREND_COUNT = 15;

function getSourceMeta(source: string) {
  return SOURCE_META[source] ?? { label: source, color: 'text-text-secondary bg-surface-800 ring-surface-700' };
}

// ── Velocity bar ─────────────────────────────────────────────────────

function VelocityBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-surface-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-accent-500"
          initial={{ width: 0 }}
          animate={{ width: `${pct.toString()}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.1 }}
        />
      </div>
      <span className="font-mono text-mono-xs text-text-muted w-8 text-right">
        {pct}
      </span>
    </div>
  );
}

// ── Interest sparkline ──────────────────────────────────────────────

function InterestSparkline({ data }: { data: InterestPoint[] }) {
  if (data.length < 2) return null;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const width = 400;
  const height = 80;
  const padding = 2;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - (d.value / maxVal) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(' L ')}`;
  const areaD = `${pathD} L ${(width - padding).toFixed(1)},${(height - padding).toFixed(1)} L ${padding.toFixed(1)},${(height - padding).toFixed(1)} Z`;

  // Peak value annotation
  const peakIdx = data.reduce((best, d, i) => {
    const bestVal = data[best];
    return bestVal && d.value > bestVal.value ? i : best;
  }, 0);
  const peakVal = data[peakIdx]?.value ?? 0;
  const peakX = padding + (peakIdx / (data.length - 1)) * (width - padding * 2);
  const peakY = height - padding - (peakVal / maxVal) * (height - padding * 2);

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="w-full h-20"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="[stop-color:theme(colors.accent.500)]" stopOpacity="0.25" />
          <stop offset="100%" className="[stop-color:theme(colors.accent.500)]" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkFill)" />
      <path d={pathD} fill="none" className="stroke-accent-500" strokeWidth="1.5" />
      {/* Peak dot */}
      <circle cx={peakX} cy={peakY} r="3" className="fill-accent-400" />
      <circle cx={peakX} cy={peakY} r="6" className="fill-accent-400/20" />
    </svg>
  );
}

// ── Relative time ────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins.toString()}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours.toString()}h ago`;
  const days = Math.floor(hours / 24);
  return `${days.toString()}d ago`;
}

// ── Section divider ─────────────────────────────────────────────────

function SectionDivider() {
  return <div className="border-t border-surface-800/60 my-10" />;
}

// ── Main page ────────────────────────────────────────────────────────

export function TrendsPage() {
  // Currently-trending state (DB signals)
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [showAllTrends, setShowAllTrends] = useState(false);

  // Discover state (broad Exa trends)
  const [discoverItems, setDiscoverItems] = useState<DiscoverItem[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(true);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TrendSearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load existing trends + discover in parallel
  const loadTrends = useCallback(async () => {
    setTrendsLoading(true);
    try {
      const data = await api.getTrends();
      setTrends(data.trends);
    } catch {
      // Trends are best-effort
    } finally {
      setTrendsLoading(false);
    }
  }, []);

  const loadDiscover = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const data = await api.discoverTrends();
      setDiscoverItems(data.items);
    } catch {
      // Discover is best-effort
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  useEffect(() => { void loadTrends(); void loadDiscover(); }, [loadTrends, loadDiscover]);

  // Search handler
  const handleSearch = useCallback(async (query: string) => {
    if (query.trim().length === 0) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    try {
      const data = await api.searchTrends(query.trim());
      setSearchResults(data);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleSearch(searchQuery);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
    setSearchError(null);
    inputRef.current?.focus();
  };

  const sources = [...new Set(trends.map((t) => t.source))].sort();
  const filteredTrends = sourceFilter
    ? trends.filter((t) => t.source === sourceFilter)
    : trends;
  const visibleTrends = showAllTrends
    ? filteredTrends
    : filteredTrends.slice(0, INITIAL_TREND_COUNT);
  const hasMoreTrends = filteredTrends.length > INITIAL_TREND_COUNT;

  const isSearchActive = searchResults !== null || searchLoading;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* ─── ZONE 1: Search ─────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex items-center gap-2.5 mb-1">
          <TrendUp weight="bold" size={22} className="text-accent-400" />
          <h2 className="font-display text-display-lg text-text-primary tracking-tight">
            Trends
          </h2>
        </div>
        <p className="text-body-sm text-text-muted mb-6">
          Search across Google Trends, Exa, and {sources.length > 0 ? `${sources.length.toString()} community` : 'community'} sources
        </p>

        {/* Search input */}
        <form onSubmit={onSubmit} className="relative mb-4">
          <div className="relative">
            <MagnifyingGlass
              weight="bold"
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search trends... try 'AI agents' or 'sustainable fashion'"
              className="input w-full pl-11 pr-24 py-3.5 text-body-md rounded-xl"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-16 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-surface-700 transition-colors"
              >
                <X weight="bold" size={14} className="text-text-muted" />
              </button>
            )}
            <button
              type="submit"
              disabled={searchQuery.trim().length === 0 || searchLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 btn-primary py-2 px-4 text-body-xs rounded-lg disabled:opacity-40"
            >
              {searchLoading ? (
                <ArrowsClockwise weight="bold" size={14} className="animate-spin" />
              ) : (
                'Search'
              )}
            </button>
          </div>
        </form>

        {/* Quick search suggestions */}
        {!isSearchActive && (
          <motion.div
            className="flex items-center gap-2 mb-2 flex-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <span className="text-[11px] font-mono text-text-muted uppercase tracking-widest mr-1">
              Try
            </span>
            {SUGGESTION_PILLS.map((pill, i) => (
              <motion.button
                key={pill}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.03 }}
                onClick={() => {
                  setSearchQuery(pill);
                  void handleSearch(pill);
                }}
                className="group inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-body-xs font-mono text-text-secondary bg-surface-900 ring-1 ring-surface-800 hover:ring-accent-500/40 hover:text-accent-400 hover:bg-accent-500/5 transition-all duration-150"
              >
                {pill}
                <CaretRight weight="bold" size={9} className="text-text-muted group-hover:text-accent-400 transition-colors" />
              </motion.button>
            ))}
          </motion.div>
        )}
      </motion.div>

      {/* ─── ZONE 2: Search Results ─────────────────────────── */}
      <AnimatePresence mode="wait">
        {searchError && (
          <motion.div
            key="search-error"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-4 mt-6 mb-6"
          >
            <p className="text-body-sm text-red-400">{searchError}</p>
          </motion.div>
        )}

        {isSearchActive && (
          <motion.div
            key="search-results"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
            className="mt-8 mb-4"
          >
            {searchLoading && <SearchSkeleton />}

            {searchResults && (
              <div className="space-y-8">
                {/* Google Trends interest chart */}
                {searchResults.googleTrends &&
                  searchResults.googleTrends.interestOverTime.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl border border-surface-800 bg-surface-900/60 p-5"
                    >
                      <div className="flex items-center gap-2 mb-4">
                        <Globe weight="bold" size={16} className="text-green-400" />
                        <h3 className="text-body-sm font-semibold text-text-primary">
                          Google Trends
                        </h3>
                        <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-400/10 text-green-400 ring-1 ring-green-400/30">
                          12 months
                        </span>
                        {/* Peak value callout */}
                        <span className="ml-auto text-[11px] font-mono text-text-muted">
                          Peak: <span className="text-green-400 font-semibold">{Math.max(...searchResults.googleTrends.interestOverTime.map(p => p.value)).toString()}</span>/100
                        </span>
                      </div>
                      <InterestSparkline data={searchResults.googleTrends.interestOverTime} />
                      <div className="flex justify-between mt-2">
                        <span className="text-[10px] text-text-muted font-mono">
                          {searchResults.googleTrends.interestOverTime[0]?.date ?? ''}
                        </span>
                        <span className="text-[10px] text-text-muted font-mono">
                          {searchResults.googleTrends.interestOverTime.at(-1)?.date ?? ''}
                        </span>
                      </div>

                      {/* Related / Rising queries */}
                      {(searchResults.googleTrends.risingQueries.length > 0 ||
                        searchResults.googleTrends.topQueries.length > 0) && (
                        <div className="mt-4 pt-4 border-t border-surface-800">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {searchResults.googleTrends.risingQueries.length > 0 && (
                              <div>
                                <div className="flex items-center gap-1.5 mb-2.5">
                                  <Lightning weight="bold" size={12} className="text-amber-400" />
                                  <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
                                    Rising
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {searchResults.googleTrends.risingQueries.map((rq) => (
                                    <button
                                      key={rq.query}
                                      onClick={() => {
                                        setSearchQuery(rq.query);
                                        void handleSearch(rq.query);
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono text-amber-300 bg-amber-400/10 ring-1 ring-amber-400/20 hover:ring-amber-400/40 transition-colors cursor-pointer"
                                    >
                                      {rq.query}
                                      <CaretRight weight="bold" size={8} />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {searchResults.googleTrends.topQueries.length > 0 && (
                              <div>
                                <div className="flex items-center gap-1.5 mb-2.5">
                                  <Hash weight="bold" size={12} className="text-text-muted" />
                                  <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
                                    Related
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {searchResults.googleTrends.topQueries.map((rq) => (
                                    <button
                                      key={rq.query}
                                      onClick={() => {
                                        setSearchQuery(rq.query);
                                        void handleSearch(rq.query);
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono text-text-secondary bg-surface-800 ring-1 ring-surface-700 hover:ring-surface-600 transition-colors cursor-pointer"
                                    >
                                      {rq.query}
                                      <CaretRight weight="bold" size={8} />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}

                {/* Exa web results */}
                {searchResults.exaResults.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Newspaper weight="bold" size={16} className="text-emerald-400" />
                      <h3 className="text-body-sm font-semibold text-text-primary">
                        Web Results
                      </h3>
                      <span className="text-[10px] font-mono text-text-muted">
                        {searchResults.exaResults.length.toString()} via Exa
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {searchResults.exaResults.map((result, i) => (
                        <motion.div
                          key={result.url}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.04 * i }}
                        >
                          <ExaResultCard result={result} />
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Matched existing signals */}
                {searchResults.matchedSignals.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12 }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Lightning weight="bold" size={16} className="text-accent-400" />
                      <h3 className="text-body-sm font-semibold text-text-primary">
                        Matching Signals
                      </h3>
                      <span className="text-[10px] font-mono text-text-muted">
                        {searchResults.matchedSignals.length.toString()} from community sources
                      </span>
                    </div>
                    <div className="space-y-2">
                      {searchResults.matchedSignals.map((signal) => (
                        <TrendSignalRow key={signal.id} trend={signal} />
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Empty search results */}
                {!searchResults.googleTrends &&
                  searchResults.exaResults.length === 0 &&
                  searchResults.matchedSignals.length === 0 && (
                    <div className="rounded-xl border border-dashed border-surface-800 bg-surface-900/30 py-12 text-center">
                      <MagnifyingGlass weight="thin" size={40} className="mx-auto mb-3 text-text-muted" />
                      <p className="text-body-sm text-text-muted">
                        No results found for &ldquo;{searchResults.query}&rdquo;
                      </p>
                    </div>
                  )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <SectionDivider />

      {/* ─── Trending Across the Web (Exa discover) ───────── */}
      {(discoverItems.length > 0 || discoverLoading) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-5">
            <Globe weight="bold" size={16} className="text-emerald-400" />
            <h3 className="text-body-sm font-semibold text-text-primary uppercase tracking-wider">
              Trending Across the Web
            </h3>
            <span className="text-[10px] font-mono text-emerald-400/60">
              via Exa
            </span>
          </div>

          {discoverLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="rounded-xl border border-surface-800 bg-surface-900/60 p-4">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-surface-800 mb-2" />
                  <div className="h-3 w-full animate-pulse rounded bg-surface-800/60 mb-1.5" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-surface-800/50" />
                </div>
              ))}
            </div>
          )}

          {!discoverLoading && discoverItems.length > 0 && (
            <>
              {/* Featured row — first 2 items larger */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                {discoverItems.slice(0, 2).map((item, i) => (
                  <motion.div
                    key={item.url}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * i }}
                  >
                    <DiscoverCard item={item} featured />
                  </motion.div>
                ))}
              </div>
              {/* Remaining items — 3-column grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {discoverItems.slice(2).map((item, i) => (
                  <motion.div
                    key={item.url}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 + 0.03 * i }}
                  >
                    <DiscoverCard item={item} />
                  </motion.div>
                ))}
              </div>
            </>
          )}

          <SectionDivider />
        </motion.div>
      )}

      {/* ─── Community Signals ───────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
      >
        {/* Section header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <TrendUp weight="bold" size={16} className="text-accent-400" />
            <h3 className="text-body-sm font-semibold text-text-primary uppercase tracking-wider">
              Community Signals
            </h3>
            <span className="text-[10px] font-mono text-text-muted">
              {trends.length.toString()} signals &middot; refreshed every 6h
            </span>
          </div>
          <button
            onClick={() => void loadTrends()}
            disabled={trendsLoading}
            className="btn-ghost text-body-xs flex items-center gap-1.5"
          >
            <ArrowsClockwise
              weight="bold"
              size={14}
              className={trendsLoading ? 'animate-spin' : ''}
            />
            Refresh
          </button>
        </div>

        {/* Source filter tabs */}
        {sources.length > 1 && (
          <div className="flex items-center gap-1.5 mb-5 flex-wrap">
            <FunnelSimple weight="bold" size={14} className="text-text-muted mr-1" />
            <button
              onClick={() => { setSourceFilter(null); setShowAllTrends(false); }}
              className={`px-2.5 py-1 rounded-md text-body-xs font-mono transition-colors ring-1 ${
                sourceFilter === null
                  ? 'text-accent-400 bg-accent-400/10 ring-accent-400/30'
                  : 'text-text-muted bg-surface-900 ring-surface-800 hover:ring-surface-700'
              }`}
            >
              All
            </button>
            {sources.map((source) => {
              const meta = getSourceMeta(source);
              return (
                <button
                  key={source}
                  onClick={() => { setSourceFilter(sourceFilter === source ? null : source); setShowAllTrends(false); }}
                  className={`px-2.5 py-1 rounded-md text-body-xs font-mono transition-colors ring-1 ${
                    sourceFilter === source
                      ? meta.color
                      : 'text-text-muted bg-surface-900 ring-surface-800 hover:ring-surface-700'
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Loading skeleton */}
        {trendsLoading && trends.length === 0 && <TrendsSkeleton />}

        {/* Empty state */}
        {!trendsLoading && trends.length === 0 && (
          <div className="relative overflow-hidden rounded-2xl border border-dashed border-surface-800 bg-surface-900/30 py-16 text-center">
            <TrendUp weight="thin" size={48} className="mx-auto mb-4 text-text-muted" />
            <p className="font-display text-display-md text-text-primary">
              No signals yet
            </p>
            <p className="text-body-md text-text-muted mt-2">
              Signals are ingested every 6 hours from community sources
            </p>
          </div>
        )}

        {/* Trending list — ranked rows */}
        <div className="space-y-0.5">
          <AnimatePresence mode="popLayout">
            {visibleTrends.map((trend, index) => (
              <motion.div
                key={trend.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, pointerEvents: 'none' as const, transition: { duration: 0.12 } }}
                transition={{
                  type: 'spring',
                  stiffness: 240,
                  damping: 28,
                  delay: 0.02 * Math.min(index, 15),
                }}
                className="group flex items-start gap-4 px-4 py-3 rounded-lg hover:bg-surface-900/80 transition-colors"
              >
                {/* Rank number */}
                <span className="shrink-0 w-6 text-right font-mono text-mono-sm text-text-muted/50 pt-0.5 tabular-nums">
                  {(index + 1).toString()}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="font-mono text-mono-sm text-accent-400 font-medium">
                      {trend.topic}
                    </span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ring-1 ${getSourceMeta(trend.source).color}`}
                    >
                      {getSourceMeta(trend.source).label}
                    </span>
                    {trend.category && (
                      <span className="text-[10px] font-mono text-text-muted/60 uppercase tracking-wider">
                        {trend.category}
                      </span>
                    )}
                  </div>
                  <p className="text-body-sm text-text-secondary leading-relaxed line-clamp-2">
                    {trend.headline}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[11px] text-text-muted/60 font-mono">
                      {relativeTime(trend.ingestedAt)}
                    </span>
                    {trend.url && (
                      <a
                        href={trend.url.startsWith('http') ? trend.url : `https://news.ycombinator.com${trend.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-accent-400 transition-colors font-mono"
                      >
                        Source
                        <ArrowSquareOut weight="bold" size={10} />
                      </a>
                    )}
                  </div>
                </div>

                {/* Velocity */}
                <div className="shrink-0 pt-1">
                  <VelocityBar score={trend.velocityScore} />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Show more / Show less */}
        {hasMoreTrends && !showAllTrends && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 text-center"
          >
            <button
              onClick={() => setShowAllTrends(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-body-xs font-mono text-text-secondary bg-surface-900 ring-1 ring-surface-800 hover:ring-surface-700 hover:text-text-primary transition-colors"
            >
              Show all {filteredTrends.length.toString()} signals
              <CaretDown weight="bold" size={12} />
            </button>
          </motion.div>
        )}
        {showAllTrends && hasMoreTrends && (
          <div className="mt-4 text-center">
            <button
              onClick={() => setShowAllTrends(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-body-xs font-mono text-text-muted hover:text-text-primary transition-colors"
            >
              Show less
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function DiscoverCard({ item, featured }: { item: DiscoverItem; featured?: boolean }) {
  const domain = (() => {
    try {
      return new URL(item.url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  })();

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group block rounded-xl border border-surface-800 bg-surface-900/60 hover:border-emerald-500/30 hover:bg-surface-900 transition-all duration-150 ${
        featured ? 'p-5' : 'p-4'
      }`}
    >
      <p className={`font-medium text-text-primary group-hover:text-emerald-400 transition-colors line-clamp-2 mb-1.5 ${
        featured ? 'text-body-md' : 'text-body-sm'
      }`}>
        {item.title}
      </p>
      {item.snippet && (
        <p className={`text-text-muted leading-relaxed mb-2 ${
          featured ? 'text-body-xs line-clamp-3' : 'text-[12px] line-clamp-2'
        }`}>
          {item.snippet}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-emerald-400/70">
          {domain}
        </span>
        {item.publishedDate && (
          <span className="text-[10px] font-mono text-text-muted/60">
            {relativeTime(item.publishedDate)}
          </span>
        )}
        <ArrowSquareOut
          weight="bold"
          size={10}
          className="text-text-muted/40 group-hover:text-emerald-400 transition-colors ml-auto"
        />
      </div>
    </a>
  );
}

function ExaResultCard({ result }: { result: ExaResult }) {
  const domain = (() => {
    try {
      return new URL(result.url).hostname.replace('www.', '');
    } catch {
      return '';
    }
  })();

  return (
    <a
      href={result.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-xl border border-surface-800 bg-surface-900/60 p-4 hover:border-surface-700 hover:bg-surface-900 transition-all duration-150"
    >
      <p className="text-body-sm font-medium text-text-primary group-hover:text-accent-400 transition-colors line-clamp-2 mb-1.5">
        {result.title}
      </p>
      {result.snippet && (
        <p className="text-[12px] text-text-muted leading-relaxed line-clamp-2 mb-2">
          {result.snippet}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-emerald-400">
          {domain}
        </span>
        {result.publishedDate && (
          <span className="text-[10px] font-mono text-text-muted/60">
            {relativeTime(result.publishedDate)}
          </span>
        )}
        <ArrowSquareOut
          weight="bold"
          size={10}
          className="text-text-muted/40 group-hover:text-accent-400 transition-colors ml-auto"
        />
      </div>
    </a>
  );
}

function TrendSignalRow({ trend }: { trend: TrendItem }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 rounded-lg border border-surface-800 bg-surface-900/40 hover:bg-surface-900/60 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-mono-xs text-accent-400 font-medium">{trend.topic}</span>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ring-1 ${getSourceMeta(trend.source).color}`}
          >
            {getSourceMeta(trend.source).label}
          </span>
        </div>
        <p className="text-[12px] text-text-secondary line-clamp-1">{trend.headline}</p>
      </div>
      <VelocityBar score={trend.velocityScore} />
    </div>
  );
}

// ── Skeletons ────────────────────────────────────────────────────────

function SearchSkeleton() {
  return (
    <div className="space-y-6">
      {/* Chart skeleton */}
      <div className="rounded-xl border border-surface-800 bg-surface-900/60 p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-surface-800 mb-4" />
        <div className="h-20 w-full animate-pulse rounded bg-surface-800/60" />
        <div className="flex gap-2 mt-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-5 w-20 animate-pulse rounded bg-surface-800/50" />
          ))}
        </div>
      </div>
      {/* Cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-surface-800 bg-surface-900/60 p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-800 mb-2" />
            <div className="h-3 w-full animate-pulse rounded bg-surface-800/60 mb-1.5" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-800/50" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendsSkeleton() {
  return (
    <div className="space-y-0.5">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div key={i} className="flex items-start gap-4 px-4 py-3">
          <div className="w-6 h-4 animate-pulse rounded bg-surface-800/50" />
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <div className="h-4 w-28 animate-pulse rounded bg-surface-800" />
              <div className="h-4 w-16 animate-pulse rounded bg-surface-800/70" />
            </div>
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-800/60" />
          </div>
          <div className="h-3 w-24 animate-pulse rounded bg-surface-800/60 mt-2" />
        </div>
      ))}
    </div>
  );
}
