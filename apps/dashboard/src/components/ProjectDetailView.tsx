import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { Competitor } from '@launchkit/shared';
import type { LaunchKitVideoProps } from '@launchkit/video';
import type { Asset } from '../lib/api.js';
import { useProjectDetailData } from '../hooks/useProjectData.js';
import { useProjectEventStream } from '../hooks/useProjectEventStream.js';
import { LaunchStatusBadge } from './LaunchStatusBadge.js';
import { LaunchStrategyCard } from './LaunchStrategyCard.js';
import { GeneratedAssetCard } from './GeneratedAssetCard.js';
import { RemotionPreviewCard } from './RemotionPreviewCard.js';
import { VerticalPreviewCard } from './VerticalPreviewCard.js';
import { LaunchOutcomeBanner } from './LaunchOutcomeBanner.js';
import { ProjectCostChip } from './ProjectCostChip.js';
import { PikaMeetingCard } from './PikaMeetingCard.js';
import { ChatPanel } from './ChatPanel.js';
import { Tooltip } from './ui/index.js';
import { AssetGallery } from './gallery/index.js';
import {
  JobStatusDot,
  RepoAnalysisRow,
  ProjectDetailSkeleton,
  ProjectDetailErrorCard,
} from './ProjectDetailParts.js';
import {
  PipelineStageStrip,
  AgentToolCallStream,
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

  // Remotion composition cards: product_video assets with
  // remotionProps get a companion card in the Videos gallery.
  // Computed before early returns to satisfy rules-of-hooks.
  const projectAssets = useMemo(() => project?.assets ?? [], [project?.assets]);
  type GalleryEntry = Asset & { _remotionCard?: true; _verticalCard?: true };
  const remotionAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of projectAssets) {
      if (
        a.type === 'product_video' &&
        a.status !== 'failed' &&
        a.metadata?.['remotionProps']
      ) {
        ids.add(a.id);
      }
    }
    return ids;
  }, [projectAssets]);

  const galleryAssets = useMemo((): GalleryEntry[] => {
    const entries: GalleryEntry[] = [];
    for (const a of projectAssets) {
      entries.push(a);
      if (remotionAssetIds.has(a.id)) {
        entries.push({ ...a, id: `${a.id}__remotion`, _remotionCard: true });
        entries.push({ ...a, id: `${a.id}__vertical`, _verticalCard: true });
      }
    }
    return entries;
  }, [projectAssets, remotionAssetIds]);

  if (loading && !project) {
    return <ProjectDetailSkeleton />;
  }

  if (error || !project) {
    return <ProjectDetailErrorCard message={error ?? 'Project not found'} />;
  }

  const isInProgress = !['complete', 'failed'].includes(project.status);

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
    <div
      className="max-w-6xl mx-auto px-6 py-8"
      data-testid="project-detail-view"
    >
      {/* Header */}
      <motion.div
        className="flex items-start justify-between mb-8"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div>
          <Link
            to="/app"
            className="text-text-muted hover:text-text-tertiary text-body-sm mb-2 inline-flex items-center gap-1 transition-colors group"
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
          <div
            className="flex items-center gap-4"
            data-testid="project-header"
          >
            <motion.h1
              className="font-display text-display-md text-text-primary"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1, duration: 0.4 }}
            >
              {project.repoOwner}/{project.repoName}
            </motion.h1>
            <LaunchStatusBadge status={project.status} />
            <Link
              to="/create"
              className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700/60 bg-surface-900/50 px-3 py-1.5 text-body-xs font-medium text-text-muted hover:border-accent-500/40 hover:text-accent-400 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create manually
            </Link>
          </div>
          <motion.a
            href={project.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted hover:text-accent-400 font-mono text-mono-sm mt-2 inline-flex items-center gap-1.5 transition-colors group"
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
            <p className="label">Score</p>
            <p
              className={`font-display text-display-lg mt-1 ${
                project.reviewScore >= 7
                  ? 'text-success-400'
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
                phase={currentPhase}
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
                <h3 className="label">
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
                        <h4 className="label mb-2">
                          Target Audience
                        </h4>
                        <p className="text-body-md text-text-secondary">
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
                        <h4 className="label mb-2">
                          Market Context
                        </h4>
                        <p className="text-body-md text-text-secondary">
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
                          <h4 className="label mb-2">
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
                                    <span className="text-heading-sm text-text-primary">
                                      {comp.name}
                                    </span>
                                    {comp.stars && (
                                      <span className="text-body-xs text-text-muted flex items-center gap-0.5">
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
                                  <p className="text-body-xs text-text-tertiary mt-1">
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
                          <h4 className="label mb-2">
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
                                  className="text-body-md text-text-secondary flex items-start gap-2"
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

          {/* Asset Gallery — tabbed by category (All / Visuals /
              Videos / Audio / Written). Replaces the previous
              Media + Content split so `world_scene`, `voice_commercial`,
              and future asset types get a clear home instead of
              falling into a catch-all bucket. Owns its own empty
              state; renders the full kit on the default "All" tab. */}
          {(project.assets.length > 0 || isGenerating || !isInProgress) && (
            <div>
              {/* Project-level provider cost chip. Hides itself when
                  the total is zero (seed / placeholder projects) or
                  when the costs API request fails — the chip is
                  informational and a cost-tracking hiccup should not
                  show as an error in the gallery. */}
              <ProjectCostChip projectId={project.id} />
              <AssetGallery
                assets={galleryAssets}
                expectedCount={expectedAssetCount + remotionAssetIds.size * 2}
                isGenerating={isGenerating}
                renderAsset={(asset) => {
                  const entry = asset as GalleryEntry;
                  if (entry._remotionCard || entry._verticalCard) {
                    const suffix = entry._remotionCard ? '__remotion' : '__vertical';
                    const realAsset = project.assets.find(
                      (a) => a.id === asset.id.replace(suffix, '')
                    );
                    const props = (realAsset?.metadata as Record<string, unknown> | null)?.['remotionProps'] as LaunchKitVideoProps | undefined;
                    if (!realAsset || !props) return null;
                    return entry._verticalCard ? (
                      <VerticalPreviewCard
                        assetId={realAsset.id}
                        remotionProps={props}
                        version={realAsset.version}
                      />
                    ) : (
                      <RemotionPreviewCard
                        assetId={realAsset.id}
                        remotionProps={props}
                        version={realAsset.version}
                      />
                    );
                  }
                  return (
                    <GeneratedAssetCard
                      asset={asset}
                      onRefresh={refresh}
                      projectAssets={project.assets}
                    />
                  );
                }}
              />
              {/* Pika video-meeting card — rendered after the asset
                  gallery so it reads as the "next action" once the
                  launch kit is generated. The card is self-gated:
                  it hides itself until the initial list fetch lands
                  (to avoid a flash of empty state), and its Invite
                  button is disabled while a session is in flight. */}
              <PikaMeetingCard projectId={project.id} />
            </div>
          )}
        </div>

      {/* Floating chat panel — Bufo agent with tool calling.
          Renders as a fixed-position slide-over from the right
          edge, triggered by a floating action button in the
          bottom-right corner. Positioned outside the grid so
          it overlays the entire viewport. */}
      <ChatPanel projectId={project.id} />

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
              <h3 className="label mb-4">
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
                    className="flex items-center justify-between text-body-sm group"
                    variants={{
                      hidden: { opacity: 0, x: -8 },
                      visible: { opacity: 1, x: 0 },
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <JobStatusDot status={job.status} />
                      <Tooltip label={job.name}>
                        <span className="text-text-secondary font-mono text-mono-sm truncate group-hover:text-text-primary transition-colors">
                          {job.name}
                        </span>
                      </Tooltip>
                    </div>
                    {job.duration && (
                      <span className="text-text-muted font-mono text-mono-sm flex-shrink-0">
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
              <h3 className="label mb-4">
                Repo Analysis
              </h3>
              <motion.div
                className="space-y-3 text-body-sm"
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

