import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Competitor } from '@launchkit/shared';
import { useProjectDetailData } from '../hooks/useProjectData.js';
import { useProjectEventStream } from '../hooks/useProjectEventStream.js';
import { LaunchStatusBadge } from './LaunchStatusBadge.js';
import { ProjectActivityTimeline } from './ProjectActivityTimeline.js';
import { LaunchStrategyCard } from './LaunchStrategyCard.js';
import { GeneratedAssetCard } from './GeneratedAssetCard.js';

interface ProjectDetailViewProps {
  projectId: string;
}

export function ProjectDetailView({ projectId }: ProjectDetailViewProps) {
  const { project, loading, error, refresh } = useProjectDetailData(projectId);
  const { events } = useProjectEventStream(projectId);
  const [showResearch, setShowResearch] = useState(false);

  if (loading && !project) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="skeleton h-8 w-64 mb-4" />
        <div className="skeleton h-4 w-96 mb-8" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="skeleton h-64 lg:col-span-2" />
          <div className="skeleton h-64" />
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8 text-center">
        <p className="text-red-400">{error ?? 'Project not found'}</p>
        <Link to="/" className="btn-ghost mt-4 inline-block">Back to projects</Link>
      </div>
    );
  }

  const isInProgress = !['complete', 'failed'].includes(project.status);
  const textAssets = project.assets.filter(
    (a) => !['og_image', 'social_card', 'product_video'].includes(a.type)
  );
  const mediaAssets = project.assets.filter((a) =>
    ['og_image', 'social_card', 'product_video'].includes(a.type)
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <Link to="/" className="text-surface-500 hover:text-surface-300 text-sm mb-2 inline-block transition-colors">
            &larr; All Projects
          </Link>
          <div className="flex items-center gap-4">
            <h1 className="font-mono text-2xl font-bold">
              {project.repoOwner}/{project.repoName}
            </h1>
            <LaunchStatusBadge status={project.status} />
          </div>
          <a
            href={project.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-surface-500 hover:text-accent-400 text-sm mt-1 inline-block transition-colors"
          >
            {project.repoUrl}
          </a>
        </div>

        {project.reviewScore !== null && (
          <div className="text-right">
            <p className="text-xs font-mono text-surface-500 uppercase tracking-wider">Score</p>
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
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content — 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Strategy Brief */}
          {project.strategy && (
            <LaunchStrategyCard strategy={project.strategy} />
          )}

          {/* Research Panel (Collapsible) */}
          {project.research && (
            <div className="card">
              <button
                onClick={() => setShowResearch(!showResearch)}
                className="w-full flex items-center justify-between"
              >
                <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider">
                  Research Findings
                </h3>
                <svg
                  className={`w-5 h-5 text-surface-500 transition-transform ${showResearch ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showResearch && (
                <div className="mt-4 space-y-4 animate-fade-in">
                  {/* Target Audience */}
                  <div>
                    <h4 className="text-xs font-mono text-surface-500 uppercase mb-1">Target Audience</h4>
                    <p className="text-sm text-surface-300">{project.research.targetAudience}</p>
                  </div>

                  {/* Market Context */}
                  <div>
                    <h4 className="text-xs font-mono text-surface-500 uppercase mb-1">Market Context</h4>
                    <p className="text-sm text-surface-300">{project.research.marketContext}</p>
                  </div>

                  {/* Competitors */}
                  {project.research.competitors?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-mono text-surface-500 uppercase mb-2">Competitors</h4>
                      <div className="space-y-2">
                        {project.research.competitors.map((comp: Competitor, i: number) => (
                          <div key={i} className="p-3 bg-surface-800/50 rounded-lg">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{comp.name}</span>
                              {comp.stars && (
                                <span className="text-xs text-surface-500">{comp.stars} stars</span>
                              )}
                            </div>
                            <p className="text-xs text-surface-400 mt-0.5">{comp.differentiator}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Unique Angles */}
                  {project.research.uniqueAngles?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-mono text-surface-500 uppercase mb-2">Unique Angles</h4>
                      <ul className="space-y-1">
                        {project.research.uniqueAngles.map((angle: string, i: number) => (
                          <li key={i} className="text-sm text-surface-300 flex items-start gap-2">
                            <span className="text-accent-500">*</span>
                            {angle}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Media Assets */}
          {mediaAssets.length > 0 && (
            <div>
              <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider mb-4">
                Media
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {mediaAssets.map((asset) => (
                  <GeneratedAssetCard
                    key={asset.id}
                    asset={asset}
                    onRefresh={refresh}
                    projectAssets={project.assets}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Text Assets */}
          {textAssets.length > 0 && (
            <div>
              <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider mb-4">
                Content
              </h3>
              <div className="grid gap-4">
                {textAssets.map((asset) => (
                  <GeneratedAssetCard
                    key={asset.id}
                    asset={asset}
                    onRefresh={refresh}
                    projectAssets={project.assets}
                  />
                ))}
              </div>
            </div>
          )}

          {project.assets.length === 0 && !isInProgress && (
            <div className="text-center py-12 text-surface-500">
              No assets generated yet
            </div>
          )}
        </div>

        {/* Sidebar — 1 column */}
        <div className="space-y-6">
          {/* Progress Timeline */}
          <ProjectActivityTimeline status={project.status} events={events} />

          {/* Job History */}
          {project.jobs.length > 0 && (
            <div className="card">
              <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider mb-4">
                Job History
              </h3>
              <div className="space-y-2">
                {project.jobs.slice(0, 10).map((job) => (
                  <div key={job.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          job.status === 'completed'
                            ? 'bg-accent-500'
                            : job.status === 'failed'
                              ? 'bg-red-500'
                              : job.status === 'active'
                                ? 'bg-blue-500 animate-pulse-dot'
                                : 'bg-surface-600'
                        }`}
                      />
                      <span className="text-surface-300 font-mono text-xs">
                        {job.name}
                      </span>
                    </div>
                    {job.duration && (
                      <span className="text-surface-500 text-xs font-mono">
                        {(job.duration / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Repo Analysis Summary */}
          {project.repoAnalysis && (
            <div className="card">
              <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider mb-4">
                Repo Analysis
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-surface-500">Language</span>
                  <span className="text-surface-300">{project.repoAnalysis.language}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-500">Category</span>
                  <span className="text-surface-300">{project.repoAnalysis.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-500">Stars</span>
                  <span className="text-surface-300">{project.repoAnalysis.stars?.toLocaleString()}</span>
                </div>
                {project.repoAnalysis.framework && (
                  <div className="flex justify-between">
                    <span className="text-surface-500">Framework</span>
                    <span className="text-surface-300">{project.repoAnalysis.framework}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-surface-500">Has Tests</span>
                  <span className="text-surface-300">{project.repoAnalysis.hasTests ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-500">Has CI</span>
                  <span className="text-surface-300">{project.repoAnalysis.hasCi ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
