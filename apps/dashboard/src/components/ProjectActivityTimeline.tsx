import type { ProgressEvent } from '@launchkit/shared';

const PHASES = [
  { key: 'analyzing', label: 'Analyzing Repo', icon: '01' },
  { key: 'researching', label: 'Researching Market', icon: '02' },
  { key: 'strategizing', label: 'Crafting Strategy', icon: '03' },
  { key: 'generating', label: 'Generating Assets', icon: '04' },
  { key: 'reviewing', label: 'Creative Review', icon: '05' },
];

interface ProjectActivityTimelineProps {
  status: string;
  events: ProgressEvent[];
}

export function ProjectActivityTimeline({
  status,
  events,
}: ProjectActivityTimelineProps) {
  const currentPhaseIdx = PHASES.findIndex((p) => p.key === status);

  return (
    <div className="card">
      <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider mb-6">
        Pipeline Progress
      </h3>

      <div className="space-y-1">
        {PHASES.map((phase, idx) => {
          const isComplete = idx < currentPhaseIdx || status === 'complete';
          const isCurrent = phase.key === status || (status === 'revising' && phase.key === 'reviewing');
          const isPending = idx > currentPhaseIdx && status !== 'complete';
          const isFailed = status === 'failed' && idx === currentPhaseIdx;

          // Get events for this phase
          const phaseEvents = events.filter((e) => e.phase === phase.key);
          const lastEvent = phaseEvents[phaseEvents.length - 1];

          return (
            <div key={phase.key} className="flex gap-4">
              {/* Vertical line and dot */}
              <div className="flex flex-col items-center">
                <div
                  className={`
                    w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold
                    transition-all duration-300
                    ${isComplete ? 'bg-accent-500/20 text-accent-400' : ''}
                    ${isCurrent ? 'bg-accent-500 text-white ring-2 ring-accent-500/30' : ''}
                    ${isPending ? 'bg-surface-800 text-surface-500' : ''}
                    ${isFailed ? 'bg-red-500/20 text-red-400' : ''}
                  `}
                >
                  {isComplete ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    phase.icon
                  )}
                </div>
                {idx < PHASES.length - 1 && (
                  <div
                    className={`w-0.5 h-8 my-1 rounded-full transition-colors duration-300 ${
                      isComplete ? 'bg-accent-500/40' : 'bg-surface-800'
                    }`}
                  />
                )}
              </div>

              {/* Phase info */}
              <div className="flex-1 pb-4">
                <p
                  className={`font-medium text-sm ${
                    isCurrent
                      ? 'text-surface-100'
                      : isComplete
                        ? 'text-surface-300'
                        : 'text-surface-500'
                  }`}
                >
                  {phase.label}
                </p>
                {lastEvent && (
                  <p className="text-xs text-surface-500 mt-0.5 animate-fade-in">
                    {(typeof lastEvent.data?.['detail'] === 'string'
                      ? lastEvent.data['detail']
                      : typeof lastEvent.data?.['toolName'] === 'string'
                        ? lastEvent.data['toolName']
                        : '') || ''}
                  </p>
                )}
                {isCurrent && !isFailed && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="w-1 h-1 bg-accent-400 rounded-full animate-pulse-dot" />
                    <span className="text-xs text-accent-400">In progress</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
