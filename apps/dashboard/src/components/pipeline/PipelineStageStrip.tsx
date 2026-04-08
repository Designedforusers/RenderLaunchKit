import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import gsap from 'gsap';
import {
  PIPELINE_PHASES,
  PIPELINE_PHASE_META,
  phaseFromStatus,
  type PipelinePhase,
} from './event-helpers.js';

type StageState = 'pending' | 'active' | 'complete' | 'failed';

interface StageInfo {
  phase: PipelinePhase;
  state: StageState;
  index: number;
  label: string;
  shortLabel: string;
  description: string;
  detail: string | null;
}

interface PipelineStageStripProps {
  /**
   * The current project status as returned by the API. Can be any of
   * the pipeline phases, `pending`, `complete`, `failed`, `revising`,
   * or other transient states. We narrow internally.
   */
  status: string;
  /**
   * Live detail captions keyed by phase. The stream hook returns
   * this via `latestDetailByPhase`. Optional — the strip still
   * renders without it.
   */
  detailsByPhase?: Record<PipelinePhase, string | null>;
}

/**
 * Resolve the display state of every pipeline stage from a single
 * status string. Pure function — no React, easy to test.
 */
function computeStages(
  status: string,
  detailsByPhase: Record<PipelinePhase, string | null> | undefined
): StageInfo[] {
  const currentPhase = phaseFromStatus(status);
  const currentIdx = currentPhase
    ? PIPELINE_PHASES.indexOf(currentPhase)
    : status === 'complete'
      ? PIPELINE_PHASES.length
      : -1;
  const isFailed = status === 'failed';

  return PIPELINE_PHASES.map((phase, idx) => {
    const meta = PIPELINE_PHASE_META[phase];
    let state: StageState;
    if (status === 'complete') {
      state = 'complete';
    } else if (isFailed && idx === currentIdx) {
      state = 'failed';
    } else if (currentIdx === -1) {
      state = 'pending';
    } else if (idx < currentIdx) {
      state = 'complete';
    } else if (idx === currentIdx) {
      state = 'active';
    } else {
      state = 'pending';
    }
    return {
      phase,
      state,
      index: meta.index,
      label: meta.label,
      shortLabel: meta.shortLabel,
      description: meta.description,
      detail: detailsByPhase?.[phase] ?? null,
    };
  });
}

function stageProgressPct(stages: StageInfo[]): number {
  const completed = stages.filter((s) => s.state === 'complete').length;
  const hasActive = stages.some((s) => s.state === 'active');
  const base = (completed / stages.length) * 100;
  // Add a half-step of progress into the active stage so the fill
  // visibly advances the moment a new stage begins — without this
  // the bar only jumps when stages complete, which makes the
  // "researching for 60 seconds" phase feel stalled.
  return hasActive ? Math.min(base + 100 / stages.length / 2, 100) : base;
}

export function PipelineStageStrip({
  status,
  detailsByPhase,
}: PipelineStageStripProps) {
  const stages = computeStages(status, detailsByPhase);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const targetPct = stageProgressPct(stages);

  // GSAP drives the fill bar explicitly so we can use an ease that
  // framer-motion's spring system does not expose cleanly — and so
  // the fill animation is decoupled from React reconciliation. The
  // bar tweens to its new target whenever the percentage changes,
  // which happens on every phase transition.
  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      gsap.to(el, {
        width: `${targetPct.toString()}%`,
        duration: 1.1,
        ease: 'expo.out',
      });
    });
    return () => {
      ctx.revert();
    };
  }, [targetPct]);

  return (
    <div className="card relative overflow-hidden">
      {/* Ambient gradient glow that responds to the current stage */}
      <AnimatePresence mode="wait">
        <motion.div
          key={status}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent-500/5 via-transparent to-transparent"
          aria-hidden="true"
        />
      </AnimatePresence>

      <div className="relative">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-mono text-sm font-semibold uppercase tracking-wider text-surface-400">
            Pipeline
          </h3>
          <motion.span
            key={`pct-${Math.round(targetPct).toString()}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="font-mono text-xs text-surface-500"
          >
            {Math.round(targetPct)}%
          </motion.span>
        </div>

        {/* Progress rail — GSAP-driven fill on a full-width track */}
        <div className="relative mb-6 h-1 overflow-hidden rounded-full bg-surface-800">
          <div
            ref={fillRef}
            className="absolute inset-y-0 left-0 w-0 rounded-full bg-gradient-to-r from-accent-600 via-accent-400 to-accent-300"
          />
          {/* Shimmer sweep — only visible while something is actively running */}
          {stages.some((s) => s.state === 'active') && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
              <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
          )}
        </div>

        {/* Stage pills */}
        <ol className="grid grid-cols-5 gap-2">
          {stages.map((stage) => (
            <StagePill key={stage.phase} stage={stage} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StagePill({ stage }: { stage: StageInfo }) {
  const stateStyles: Record<StageState, string> = {
    pending: 'bg-surface-800/60 text-surface-500 border-surface-800',
    active:
      'bg-accent-500/15 text-accent-100 border-accent-500/50 shadow-[0_0_24px_-8px_rgba(16,185,129,0.6)]',
    complete: 'bg-accent-500/10 text-accent-300 border-accent-500/30',
    failed: 'bg-red-500/15 text-red-300 border-red-500/40',
  };

  return (
    <motion.li
      layout
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={`relative flex flex-col rounded-xl border p-3 transition-colors duration-500 ${stateStyles[stage.state]}`}
    >
      {/* Breathing halo for the active stage */}
      {stage.state === 'active' && (
        <div
          className="pointer-events-none absolute inset-0 animate-breathe rounded-xl ring-1 ring-accent-400/30"
          aria-hidden="true"
        />
      )}

      <div className="relative flex items-center gap-2">
        <StageBadge state={stage.state} index={stage.index} />
        <span className="truncate font-mono text-[11px] font-semibold uppercase tracking-wider">
          {stage.shortLabel}
        </span>
      </div>

      {/* Live caption — fades in and out as the detail string changes */}
      <div className="relative mt-2 h-4">
        <AnimatePresence mode="wait">
          {stage.state === 'active' && stage.detail ? (
            <motion.p
              key={stage.detail}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-x-0 truncate font-mono text-[10px] text-accent-300/90"
            >
              {stage.detail}
            </motion.p>
          ) : (
            <motion.p
              key="static-description"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-x-0 truncate text-[10px] text-surface-500"
            >
              {stage.description}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}

function StageBadge({ state, index }: { state: StageState; index: number }) {
  const label = index.toString().padStart(2, '0');

  if (state === 'complete') {
    return (
      <motion.div
        key="complete"
        initial={{ scale: 0.4, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-500/25"
      >
        <svg
          className="h-3.5 w-3.5 text-accent-200"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </motion.div>
    );
  }

  if (state === 'failed') {
    return (
      <motion.div
        key="failed"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/25"
      >
        <svg
          className="h-3.5 w-3.5 text-red-200"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </motion.div>
    );
  }

  if (state === 'active') {
    return (
      <div className="relative flex h-6 w-6 items-center justify-center rounded-md bg-accent-500/20">
        <span className="font-mono text-[10px] font-bold text-accent-100">
          {label}
        </span>
        {/* Orbiting dot — GSAP-free pure CSS keyframe for cheapness */}
        <span className="pointer-events-none absolute inset-0">
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 animate-orbit-medium rounded-full bg-accent-300" />
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-800/80">
      <span className="font-mono text-[10px] font-bold text-surface-600">
        {label}
      </span>
    </div>
  );
}
