import { Link } from 'react-router-dom';
import type { ProjectSummary } from '../lib/api.js';
import { LaunchStatusBadge } from './LaunchStatusBadge.js';

interface ProjectSummaryListProps {
  projects: ProjectSummary[];
  loading: boolean;
}

export function ProjectSummaryList({
  projects,
  loading,
}: ProjectSummaryListProps) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card">
            <div className="skeleton h-6 w-48 mb-3" />
            <div className="skeleton h-4 w-32 mb-4" />
            <div className="flex gap-2">
              <div className="skeleton h-5 w-20" />
              <div className="skeleton h-5 w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 opacity-50">~</div>
        <p className="text-surface-400 text-lg">No projects yet</p>
        <p className="text-surface-500 mt-1">Paste a GitHub repo URL above to get started</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {projects.map((project) => (
        <Link
          key={project.id}
          to={`/projects/${project.id}`}
          className="card-hover group block"
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-mono font-semibold text-lg group-hover:text-accent-400 transition-colors">
                {project.repoOwner}/{project.repoName}
              </h3>
              <p className="text-surface-500 text-sm mt-0.5">
                {new Date(project.createdAt).toLocaleDateString()}
              </p>
            </div>
            <LaunchStatusBadge status={project.status} />
          </div>

          <div className="flex items-center gap-4 mt-4">
            <div className="flex items-center gap-1.5 text-sm text-surface-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {project.completedAssets}/{project.assetCount} assets
            </div>

            {project.reviewScore && (
              <div className="flex items-center gap-1.5 text-sm">
                <div
                  className={`w-2 h-2 rounded-full ${
                    project.reviewScore >= 7
                      ? 'bg-accent-500'
                      : project.reviewScore >= 5
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                />
                <span className="text-surface-300">{project.reviewScore.toFixed(1)}</span>
              </div>
            )}

            {project.webhookEnabled && (
              <div className="flex items-center gap-1.5 text-sm text-surface-500">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                webhook
              </div>
            )}
          </div>

          {/* Progress bar for in-progress projects */}
          {!['complete', 'failed', 'pending'].includes(project.status) && (
            <div className="mt-4">
              <div className="h-1 bg-surface-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${getProgressPercent(project.status)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}

function getProgressPercent(status: string): number {
  const map: Record<string, number> = {
    analyzing: 15,
    researching: 30,
    strategizing: 45,
    generating: 65,
    reviewing: 85,
    revising: 75,
    complete: 100,
    failed: 100,
  };
  return map[status] || 0;
}
