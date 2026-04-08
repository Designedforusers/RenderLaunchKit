import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { Competitor } from '@launchkit/shared';
import { useProjectDetailData } from '../hooks/useProjectData.js';
import { useProjectEventStream } from '../hooks/useProjectEventStream.js';
import { LaunchStatusBadge } from './LaunchStatusBadge.js';
import { LaunchStrategyCard } from './LaunchStrategyCard.js';
import { GeneratedAssetCard } from './GeneratedAssetCard.js';
import { LaunchOutcomeBanner } from './LaunchOutcomeBanner.js';
import { Tooltip } from './ui/index.js';
import {
  PipelineStageStrip,
  AgentToolCallStream,
  AnimatedAssetGrid,
  StageLoader,
  toolCallsFromEvents,
  latestDetailByPhase,
  phaseFromStatus,
} from './pipeline/index.js';

interface ProjectDetailViewProps {
  projectId: string;
}

export function ProjectDetailView({ projectId }: ProjectDetailViewProps) {
  const { project, loading, error, refresh } = useProjectDetailData(projectId);
  const { events } = useProjectEventStream(projectId);
  const [showResearch, setShowResearch] = useState(false);

  // Hook ordering: these derived values must be computed before any
  // early return so the hook call count stays constant across renders
  // (react-hooks/rules-of-hooks). They operate on `events`
  // independently of `project`, so computing them before the
  // loading/error guards is cheap and correct.
  const toolCalls = useMemo(() => toolCallsFromEvents(events), [events]);
  const detailsByPhase = useMemo(() => latestDetailByPhase(events), [events]);

  if (loading && !project) {
    return <ProjectDetailSkeleton />;
  }

  if (error || !project) {
    return <ProjectDetailErrorCard message={error ?? 'Project not found'} />;
  }

  const isInProgress = !['complete', 'failed'].includes(project.status);
  const textAssets = project.assets.filter(
    (a) => !['og_image', 'social_card', 'product_video'].includes(a.type)
  );
  const mediaAssets = project.assets.filter((a) =>
    ['og_image', 'social_card', 'product_video'].includes(a.type)
  );

  const currentPhase = phaseFromStatus(project.status);
  const activeDetail = currentPhase ? detailsByPhase[currentPhase] : null;
  const isGenerating = project.status === 'generating';
  // The strategy is the source of truth for how many assets the
  // worker is about to produce. Until the strategy is known we fall
  // back to the default kit size so the skeleton grid still
  // appears eagerly.
  const expectedAssetCount =
    project.strategy?.assetsToGenerate.length ?? project.assets.length + 3;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <motion.div
        className="flex items-start justify-between mb-8"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div>
          <Link
            to="/"
            className="text-surface-500 hover:text-surface-300 text-sm mb-2 inline-flex items-center gap-1 transition-colors group"
          >
            <motion.svg
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
              whileHover={{ x: -2 }}
              transition={{ type: 'spring', stiffness: 360, damping: 20 }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </motion.svg>
            All Projects
          </Link>
          <div className="flex items-center gap-4">
            <motion.h1
              className="font-mono text-2xl font-bold"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
            >
              {project.repoOwner}/{project.repoName}
            </motion.h1>
            <LaunchStatusBadge status={project.status} />
          </div>
          <motion.a
            href={project.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-surface-500 hover:text-accent-400 text-sm mt-1 inline-flex items-center gap-1.5 transition-colors group"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.16, duration: 0.4 }}
          >
            {project.repoUrl}
            <svg
              className="h-3 w-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </motion.a>
        </div>

        {project.reviewScore !== null && (
          <motion.div
            className="text-right"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: 0.2,
              type: 'spring',
              stiffness: 320,
              damping: 22,
            }}
          >
            <p className="text-xs font-mono text-surface-500 uppercase tracking-wider">
              Score
            </p>
            <p
              className={`text-3xl font-mono font-bold ${
                project.reviewScore >= 7
                  ? 'text-accent-400'
                  : project.reviewScore >= 5
                    ? 'text-amber-400'
                    : 'text-red-400'
              }`}
            >
              {project.reviewScore.toFixed(1)}
            </p>
          </motion.div>
        )}
      </motion.div>

      {/* Outcome banner — only mounts on `complete` or `failed`.
          AnimatePresence inside the component handles enter/exit so
          the banner slides in once the pipeline finishes and slides
          out cleanly on a regenerate. */}
      <LaunchOutcomeBanner
        status={project.status}
        reviewScore={project.reviewScore}
      />

      {/* Pipeline Strip — visible at every status so reviewers can
          see the flow even for completed projects. */}
      <div className="mb-6">
        <PipelineStageStrip
          status={project.status}
          detailsByPhase={detailsByPhase}
        />
      </div>

      {/* Active-stage spotlight — per-phase animated loader + live
          tool-call log. Only rendered while the pipeline is mid-run;
          collapses cleanly to nothing on complete/failed. */}
      <AnimatePresence>
        {isInProgress && (
          <motion.div
            key="stage-spotlight"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <StageLoader status={project.status} detail={activeDetail} />
              <AgentToolCallStream
                toolCalls={toolCalls}
                isStreaming={isInProgress}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content — 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Strategy Brief */}
          {project.strategy && (
            <LaunchStrategyCard strategy={project.strategy} />
          )}

          {/* Research Panel (Collapsible) */}
          {project.research && (
            <motion.div
              className="card"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <motion.button
                onClick={() => setShowResearch(!showResearch)}
                whileTap={{ scale: 0.995 }}
                className="w-full flex items-center justify-between text-left"
                aria-expanded={showResearch}
                aria-controls="research-panel"
              >
                <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider">
                  Research Findings
                </h3>
                <motion.svg
                  className="w-5 h-5 text-surface-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  animate={{ rotate: showResearch ? 180 : 0 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 22 }}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </motion.svg>
              </motion.button>

              <AnimatePresence initial={false}>
                {showResearch && (
                  <motion.div
                    id="research-panel"
                    key="research-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{
                      height: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
                      opacity: { duration: 0.24 },
                    }}
                    className="overflow-hidden"
                  >
                    <motion.div
                      className="mt-4 space-y-4"
                      initial="hidden"
                      animate="visible"
                      variants={{
                        visible: {
                          transition: { staggerChildren: 0.06, delayChildren: 0.05 },
                        },
                      }}
                    >
                      {/* Target Audience */}
                      <motion.div
                        variants={{
                          hidden: { opacity: 0, y: 8 },
                          visible: { opacity: 1, y: 0 },
                        }}
                      >
                        <h4 className="text-xs font-mono text-surface-500 uppercase mb-1">
                          Target Audience
                        </h4>
                        <p className="text-sm text-surface-300">
                          {project.research.targetAudience}
                        </p>
                      </motion.div>

                      {/* Market Context */}
                      <motion.div
                        variants={{
                          hidden: { opacity: 0, y: 8 },
                          visible: { opacity: 1, y: 0 },
                        }}
                      >
                        <h4 className="text-xs font-mono text-surface-500 uppercase mb-1">
                          Market Context
                        </h4>
                        <p className="text-sm text-surface-300">
                          {project.research.marketContext}
                        </p>
                      </motion.div>

                      {/* Competitors */}
                      {project.research.competitors?.length > 0 && (
                        <motion.div
                          variants={{
                            hidden: { opacity: 0, y: 8 },
                            visible: { opacity: 1, y: 0 },
                          }}
                        >
                          <h4 className="text-xs font-mono text-surface-500 uppercase mb-2">
                            Competitors
                          </h4>
                          <motion.div
                            className="space-y-2"
                            variants={{
                              visible: { transition: { staggerChildren: 0.05 } },
                            }}
                          >
                            {project.research.competitors.map(
                              (comp: Competitor, i: number) => (
                                <motion.div
                                  key={i}
                                  variants={{
                                    hidden: { opacity: 0, x: -8 },
                                    visible: { opacity: 1, x: 0 },
                                  }}
                                  whileHover={{ x: 2 }}
                                  transition={{
                                    type: 'spring',
                                    stiffness: 360,
                                    damping: 24,
                                  }}
                                  className="p-3 bg-surface-800/50 rounded-lg border border-transparent hover:border-surface-700 transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">
                                      {comp.name}
                                    </span>
                                    {comp.stars && (
                                      <span className="text-xs text-surface-500 flex items-center gap-0.5">
                                        <svg
                                          className="h-3 w-3"
                                          fill="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                                        </svg>
                                        {comp.stars}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-surface-400 mt-0.5">
                                    {comp.differentiator}
                                  </p>
                                </motion.div>
                              )
                            )}
                          </motion.div>
                        </motion.div>
                      )}

                      {/* Unique Angles */}
                      {project.research.uniqueAngles?.length > 0 && (
                        <motion.div
                          variants={{
                            hidden: { opacity: 0, y: 8 },
                            visible: { opacity: 1, y: 0 },
                          }}
                        >
                          <h4 className="text-xs font-mono text-surface-500 uppercase mb-2">
                            Unique Angles
                          </h4>
                          <motion.ul
                            className="space-y-1"
                            variants={{
                              visible: { transition: { staggerChildren: 0.04 } },
                            }}
                          >
                            {project.research.uniqueAngles.map(
                              (angle: string, i: number) => (
                                <motion.li
                                  key={i}
                                  variants={{
                                    hidden: { opacity: 0, x: -6 },
                                    visible: { opacity: 1, x: 0 },
                                  }}
                                  className="text-sm text-surface-300 flex items-start gap-2"
                                >
                                  <span className="text-accent-500">*</span>
                                  {angle}
                                </motion.li>
                              )
                            )}
                          </motion.ul>
                        </motion.div>
                      )}
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Media Assets */}
          {(mediaAssets.length > 0 || isGenerating) && (
            <div>
              <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider mb-4">
                Media
              </h3>
              <AnimatedAssetGrid
                assets={mediaAssets}
                expectedCount={Math.min(2, expectedAssetCount)}
                isGenerating={isGenerating && mediaAssets.length === 0}
                className="grid gap-4 sm:grid-cols-2"
                renderAsset={(asset) => (
                  <GeneratedAssetCard
                    asset={asset}
                    onRefresh={refresh}
                    projectAssets={project.assets}
                  />
                )}
              />
            </div>
          )}

          {/* Text Assets */}
          {(textAssets.length > 0 || isGenerating) && (
            <div>
              <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider mb-4">
                Content
              </h3>
              <AnimatedAssetGrid
                assets={textAssets}
                expectedCount={Math.max(
                  0,
                  expectedAssetCount - mediaAssets.length
                )}
                isGenerating={isGenerating}
                className="grid gap-4"
                renderAsset={(asset) => (
                  <GeneratedAssetCard
                    asset={asset}
                    onRefresh={refresh}
                    projectAssets={project.assets}
                  />
                )}
              />
            </div>
          )}

          {project.assets.length === 0 && !isInProgress && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="text-center py-12 text-surface-500 border border-dashed border-surface-800 rounded-2xl"
            >
              <span className="block mb-2 text-2xl text-surface-700">~</span>
              No assets generated yet
            </motion.div>
          )}
        </div>

        {/* Sidebar — 1 column */}
        <div className="space-y-6">
          {/* Job History */}
          {project.jobs.length > 0 && (
            <motion.div
              className="card"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider mb-4">
                Job History
              </h3>
              <motion.div
                className="space-y-2"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: {
                    transition: { staggerChildren: 0.04, delayChildren: 0.18 },
                  },
                }}
              >
                {project.jobs.slice(0, 10).map((job) => (
                  <motion.div
                    key={job.id}
                    className="flex items-center justify-between text-sm group"
                    variants={{
                      hidden: { opacity: 0, x: -8 },
                      visible: { opacity: 1, x: 0 },
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <JobStatusDot status={job.status} />
                      <Tooltip label={job.name}>
                        <span className="text-surface-300 font-mono text-xs truncate group-hover:text-surface-100 transition-colors">
                          {job.name}
                        </span>
                      </Tooltip>
                    </div>
                    {job.duration && (
                      <span className="text-surface-500 text-xs font-mono flex-shrink-0">
                        {(job.duration / 1000).toFixed(1)}s
                      </span>
                    )}
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          )}

          {/* Repo Analysis Summary */}
          {project.repoAnalysis && (
            <motion.div
              className="card"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider mb-4">
                Repo Analysis
              </h3>
              <motion.div
                className="space-y-3 text-sm"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: {
                    transition: { staggerChildren: 0.04, delayChildren: 0.26 },
                  },
                }}
              >
                <RepoAnalysisRow
                  label="Language"
                  value={project.repoAnalysis.language}
                />
                <RepoAnalysisRow
                  label="Category"
                  value={project.repoAnalysis.category}
                />
                <RepoAnalysisRow
                  label="Stars"
                  value={
                    project.repoAnalysis.stars?.toLocaleString() ?? '—'
                  }
                />
                {project.repoAnalysis.framework && (
                  <RepoAnalysisRow
                    label="Framework"
                    value={project.repoAnalysis.framework}
                  />
                )}
                <RepoAnalysisRow
                  label="Has Tests"
                  value={project.repoAnalysis.hasTests ? 'Yes' : 'No'}
                />
                <RepoAnalysisRow
                  label="Has CI"
                  value={project.repoAnalysis.hasCi ? 'Yes' : 'No'}
                />
              </motion.div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Sidebar pulse dot for the job history rows. Animated per-status so
 * a glance at the list communicates pipeline health without reading
 * any text. Extracted to its own component so the motion variants
 * stay scoped and the parent row stays readable.
 */
function JobStatusDot({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <span className="relative flex h-2 w-2 items-center justify-center flex-shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-60 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
      </span>
    );
  }
  if (status === 'completed') {
    return <span className="h-2 w-2 rounded-full bg-accent-500 flex-shrink-0" />;
  }
  if (status === 'failed') {
    return <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />;
  }
  return <span className="h-2 w-2 rounded-full bg-surface-600 flex-shrink-0" />;
}

/**
 * Single key/value row in the repo analysis card. Extracted so the
 * stagger animation stays consistent across every row and a future
 * row addition doesn't forget to wrap itself in a motion variant.
 */
function RepoAnalysisRow({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: -6 },
        visible: { opacity: 1, x: 0 },
      }}
      className="flex justify-between items-center group"
    >
      <span className="text-surface-500 group-hover:text-surface-400 transition-colors">
        {label}
      </span>
      <span className="text-surface-300 font-mono text-xs">{value}</span>
    </motion.div>
  );
}

/**
 * Animated detail-view skeleton. Mirrors the real layout of the
 * project page (header strip + pipeline strip + 2-col grid) so the
 * jump to the loaded view doesn't reflow the document, only fades in.
 * Each block uses framer-motion for a stagger entrance and tailwind's
 * `animate-shimmer-sweep` for the diagonal sheen effect.
 */
function ProjectDetailSkeleton() {
  const blocks = [
    { className: 'h-7 w-72', delay: 0 },
    { className: 'h-4 w-48', delay: 0.04 },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="space-y-3 mb-8">
        {blocks.map((b, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: b.delay, duration: 0.4 }}
            className="relative h-7 overflow-hidden rounded-md bg-surface-900"
            style={{ width: undefined }}
          >
            <div className={`relative h-full ${b.className} bg-surface-800/80`} />
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-accent-500/10 to-transparent" />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Pipeline strip skeleton — six pill placeholders */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.4 }}
        className="relative mb-6 flex gap-3 overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/60 p-5"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex-1 space-y-2">
            <div className="h-2 w-full animate-pulse rounded-full bg-surface-800" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-surface-800/60" />
          </div>
        ))}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-accent-500/8 to-transparent" />
        </div>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {[0, 1].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.06, duration: 0.4 }}
              className="relative h-56 overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/60"
            >
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-accent-500/8 to-transparent" />
              </div>
              <div className="relative space-y-3 p-6">
                <div className="h-3 w-32 animate-pulse rounded-full bg-surface-800" />
                <div className="h-2 w-full animate-pulse rounded-full bg-surface-800/80" />
                <div className="h-2 w-5/6 animate-pulse rounded-full bg-surface-800/80" />
                <div className="h-2 w-2/3 animate-pulse rounded-full bg-surface-800/80" />
              </div>
            </motion.div>
          ))}
        </div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.4 }}
          className="relative h-56 overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/60"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-accent-500/8 to-transparent" />
          </div>
          <div className="relative space-y-3 p-6">
            <div className="h-3 w-24 animate-pulse rounded-full bg-surface-800" />
            <div className="h-2 w-full animate-pulse rounded-full bg-surface-800/80" />
            <div className="h-2 w-3/4 animate-pulse rounded-full bg-surface-800/80" />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/**
 * Motion-aware error card for the detail view. Replaces the previous
 * flat red `<p>` so a missing project / failed fetch reads as a
 * proper UI state rather than a debug message.
 */
function ProjectDetailErrorCard({ message }: { message: string }) {
  return (
    <div className="max-w-6xl mx-auto px-6 py-16 flex justify-center">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent p-8 text-center"
      >
        <motion.div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-300"
          initial={{ scale: 0.5, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            delay: 0.1,
            type: 'spring',
            stiffness: 360,
            damping: 18,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-7 w-7"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </motion.div>
        <motion.p
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-red-300/70"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          Something went wrong
        </motion.p>
        <motion.p
          className="mt-2 text-base text-surface-200"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
        >
          {message}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36 }}
        >
          <Link
            to="/"
            className="btn-secondary mt-6 inline-flex items-center gap-2"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Back to projects
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
