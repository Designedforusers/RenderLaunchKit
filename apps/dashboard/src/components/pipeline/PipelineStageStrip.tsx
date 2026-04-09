import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import gsap from 'gsap';
import {
  MagnifyingGlass,
  Compass,
  Target,
  Sparkle,
  SealCheck,
  Check,
  X,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import {
  PIPELINE_PHASES,
  PIPELINE_PHASE_META,
  phaseFromStatus,
  type PipelinePhase,
} from './event-helpers.js';

/**
 * Per-phase activity icon. Each icon represents what the stage
 * actually does rather than just a sequence number — the eye can
 * scan the pipeline and know what each stage will do even on a
 * first visit. Drops to a universal Check on completion so the
 * done-state is unambiguous.
 */
const PHASE_ICON: Record<PipelinePhase, PhosphorIcon> = {
  analyzing: MagnifyingGlass,
  researching: Compass,
  strategizing: Target,
  generating: Sparkle,
  reviewing: SealCheck,
};

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
 * Y-coordinate (in pixels, from the card grid's top) where the
 * global rail is drawn. This must exactly match the vertical
 * center of the stage node inside each card so the rail reads
 * as passing through the node when it exits the card edge.
 *
 * Math: card wrapper top = 0, wrapper has `p-px` (1px), inner
 * card has `pt-4` (16px), node is `h-11` (44px). Node center =
 * 1 + 16 + 22 = 39px.
 */
const RAIL_Y_PX = 39;

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
  const pipelinePct = stageProgressPct(stages);
  const shouldReduceMotion = useReducedMotion();

  const activeStage = stages.find((s) => s.state === 'active') ?? null;
  const hasActive = activeStage !== null;
  const displayedPct = Math.round(pipelinePct);
  const currentStageNumber =
    activeStage?.index ??
    (status === 'complete' ? stages.length : stages.length);
  const headerMetaLabel =
    activeStage?.label.toUpperCase() ??
    (status === 'complete' ? 'READY' : 'IDLE');

  // GSAP drives the rail fill width so the accent gradient eases in
  // with an `expo.out` curve that framer-motion's spring system
  // cannot express cleanly. The fill extends as pipelinePct grows,
  // and because the rail sits behind the cards (z-0) it's only
  // visible in the 12px gaps between cards — so visually, each gap
  // lights up in sequence as stages complete.
  const railFillRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = railFillRef.current;
    if (!el) return;
    if (shouldReduceMotion) {
      el.style.width = `${pipelinePct.toString()}%`;
      return;
    }
    const ctx = gsap.context(() => {
      gsap.to(el, {
        width: `${pipelinePct.toString()}%`,
        duration: 1.2,
        ease: 'expo.out',
      });
    });
    return () => {
      ctx.revert();
    };
  }, [pipelinePct, shouldReduceMotion]);

  // GSAP drives the header percent number tween so the value eases
  // in rather than popping. Under reduced-motion the value updates
  // instantly via the React-rendered text instead.
  const pctRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = pctRef.current;
    if (!el) return;
    if (shouldReduceMotion) {
      el.textContent = `${displayedPct.toString()}%`;
      return;
    }
    const obj = { v: Number(el.dataset['v'] ?? '0') };
    const ctx = gsap.context(() => {
      gsap.to(obj, {
        v: displayedPct,
        duration: 0.9,
        ease: 'expo.out',
        onUpdate: () => {
          el.textContent = `${Math.round(obj.v).toString()}%`;
          el.dataset['v'] = obj.v.toString();
        },
      });
    });
    return () => {
      ctx.revert();
    };
  }, [displayedPct, shouldReduceMotion]);

  return (
    <div className="card relative overflow-hidden">
      {/* Ambient gradient glow that responds to the current stage. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeStage?.phase ?? status}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-accent-500/[0.06] via-transparent to-transparent" />
          {hasActive && (
            <div className="absolute -top-24 left-1/2 h-48 w-[60%] -translate-x-1/2 rounded-full bg-accent-500/[0.08] blur-3xl" />
          )}
        </motion.div>
      </AnimatePresence>

      <div className="relative">
        {/* Meta header — editorial CAPS label on the left, monospace
            stage counter + active phase name + percentage on the
            right. The mono row reads like a terminal prompt. */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="label">Pipeline</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
              Stage {currentStageNumber.toString().padStart(2, '0')} /{' '}
              {stages.length.toString().padStart(2, '0')}
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
            <AnimatePresence mode="wait">
              <motion.span
                key={headerMetaLabel}
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 3 }}
                transition={{ duration: 0.25 }}
                className="text-text-tertiary"
              >
                {headerMetaLabel}
              </motion.span>
            </AnimatePresence>
            <span className="text-surface-700" aria-hidden="true">
              ·
            </span>
            <span ref={pctRef} className="text-accent-300" data-v="0">
              {displayedPct}%
            </span>
          </div>
        </div>

        {/* Card grid. The rail lives INSIDE the grid as a z-0
            absolute layer — cards (z-10) sit on top and mask the
            rail everywhere they are, so the rail is only visible
            in the 12px gaps between cards. This is the classic
            "progress bar behind steppers" pattern. */}
        <ol className="relative grid grid-cols-5 gap-3">
          {/* Rail base — hairline in surface-700. Spans the full
              grid width; hidden wherever a card covers it. */}
          <div
            className="pointer-events-none absolute inset-x-0 z-0 h-px bg-surface-700/80"
            style={{ top: `${RAIL_Y_PX.toString()}px` }}
            aria-hidden="true"
          />
          {/* Rail fill — GSAP-driven width, accent gradient, subtle
              outer glow. Width grows from 0% to pipelinePct%. */}
          <div
            ref={railFillRef}
            className="pointer-events-none absolute left-0 z-0 h-px w-0 bg-gradient-to-r from-accent-500 via-accent-400 to-accent-200"
            style={{
              top: `${RAIL_Y_PX.toString()}px`,
              boxShadow: '0 0 10px rgba(16, 185, 129, 0.55)',
            }}
            aria-hidden="true"
          />

          {stages.map((stage) => (
            <StageCard key={stage.phase} stage={stage} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StageCard({ stage }: { stage: StageInfo }) {
  const isActive = stage.state === 'active';
  const isComplete = stage.state === 'complete';
  const isFailed = stage.state === 'failed';

  // Static border wash — sits in the outer gradient wrapper and
  // defines the color of the border in all non-active states. When
  // active, the rotating conic gradient below paints over this.
  const borderWrapClass = isActive
    ? 'bg-accent-500/30'
    : isComplete
      ? 'bg-accent-500/25'
      : isFailed
        ? 'bg-red-500/35'
        : 'bg-surface-800';

  // Card interior fill — solid per state so it fully masks the
  // rail behind it. The rail should only be visible in the 12px
  // grid gaps, never through a card.
  const cardFillClass = isActive
    ? 'bg-gradient-to-b from-accent-500/[0.08] via-surface-900 to-surface-900'
    : isComplete
      ? 'bg-surface-900'
      : isFailed
        ? 'bg-gradient-to-b from-red-500/[0.05] via-surface-900 to-surface-900'
        : 'bg-surface-900';

  // Label color ramp — matches the node state so the text and the
  // badge reinforce each other.
  const shortLabelClass = isActive
    ? 'text-text-primary'
    : isComplete
      ? 'text-accent-200'
      : isFailed
        ? 'text-red-200'
        : 'text-text-muted';

  const indexClass = isActive
    ? 'text-accent-300'
    : isComplete
      ? 'text-accent-400/70'
      : isFailed
        ? 'text-red-400/80'
        : 'text-surface-600';

  return (
    // z-10 lifts the card (and everything inside it) above the
    // z-0 rail, so the card background fully masks the rail
    // wherever it overlaps.
    <li className="relative z-10 flex">
      {/* Outer gradient wrapper — acts as a 1px border that the
          active card can light up via a rotating conic gradient
          underneath. `p-px` inset gives the inner card a 1px ring
          of whatever color this wrapper is painted. */}
      <div
        className={`relative w-full overflow-hidden rounded-xl p-px ${borderWrapClass}`}
      >
        {/* Rotating conic gradient — only rendered when the stage
            is active. Sits BEHIND the card interior, inside the
            1px border ring, and paints a chasing-light effect
            around the border. */}
        {isActive && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[220%] -translate-x-1/2 -translate-y-1/2 animate-spin-border"
            style={{
              background:
                'conic-gradient(from 0deg, transparent 0deg, transparent 220deg, rgba(52, 211, 153, 0.95) 300deg, rgba(167, 243, 208, 1) 340deg, rgba(52, 211, 153, 0.95) 360deg)',
            }}
            aria-hidden="true"
          />
        )}

        {/* Card interior — solid background so the rail behind the
            grid doesn't bleed through. Layout is a centered
            column: node at top (pt-4), mono index, CAPS label,
            live caption / description. */}
        <div
          className={`relative flex h-full flex-col items-center rounded-[11px] px-3 pb-4 pt-4 text-center ${cardFillClass}`}
        >
          <StageNode state={stage.state} icon={PHASE_ICON[stage.phase]} />

          <span
            className={`mt-3 font-mono text-[9px] tracking-[0.2em] transition-colors duration-300 ${indexClass}`}
          >
            {stage.index.toString().padStart(2, '0')}
          </span>
          <span
            className={`mt-1 text-label uppercase transition-colors duration-300 ${shortLabelClass}`}
          >
            {stage.shortLabel}
          </span>

          {/* Live caption — reserved 20px height so the row doesn't
              shift as captions appear and disappear. */}
          <div className="relative mt-1.5 h-5 w-full">
            <AnimatePresence mode="wait">
              {isActive && stage.detail ? (
                <motion.p
                  key={stage.detail}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                  className="absolute inset-x-0 flex items-center justify-center gap-0.5 font-mono text-[10px] text-accent-300/90"
                >
                  <span className="truncate">{stage.detail}</span>
                  {/* Blinking terminal cursor — makes the caption
                      feel like live output. */}
                  <span
                    className="inline-block h-2 w-[2px] shrink-0 animate-cursor-blink bg-accent-300"
                    aria-hidden="true"
                  />
                </motion.p>
              ) : (
                <motion.p
                  key="static-description"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="absolute inset-x-0 truncate text-[10px] leading-5 text-text-muted"
                >
                  {stage.description}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </li>
  );
}

function StageNode({
  state,
  icon: StageIcon,
}: {
  state: StageState;
  /**
   * Phase-specific activity icon from Phosphor. Rendered at 18px
   * inside the 32px inner disc. Active and pending states show
   * this icon so the user can read "what does each stage do" at
   * a glance; the completed state falls back to a universal check
   * and the failed state falls back to an X so the state is
   * unambiguous.
   */
  icon: PhosphorIcon;
}) {
  if (state === 'complete') {
    return (
      <div className="relative h-11 w-11">
        <motion.div
          initial={{ scale: 0.4, opacity: 0, rotate: -20 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          className="absolute inset-[6px] flex items-center justify-center rounded-full border border-accent-400/60 bg-accent-500/25 shadow-[0_0_18px_-2px_rgba(16,185,129,0.6)]"
        >
          <Check weight="bold" size={16} className="text-accent-100" />
        </motion.div>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="relative h-11 w-11">
        <motion.div
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          className="absolute inset-[6px] flex items-center justify-center rounded-full border border-red-400/60 bg-red-500/25 shadow-[0_0_18px_-2px_rgba(239,68,68,0.55)]"
        >
          <X weight="bold" size={16} className="text-red-200" />
        </motion.div>
      </div>
    );
  }

  if (state === 'active') {
    return (
      <div className="relative h-11 w-11">
        {/* Aurora double-halo — two soft rings pulsing out of phase. */}
        <div
          className="pointer-events-none absolute inset-0 animate-aurora-outer rounded-full bg-accent-400/30 blur-md"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-[3px] animate-aurora-inner rounded-full bg-accent-400/35 blur-sm"
          aria-hidden="true"
        />

        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
          className="absolute inset-[6px] flex items-center justify-center rounded-full border-[1.5px] border-accent-400 bg-surface-950/90 shadow-[0_0_24px_-2px_rgba(16,185,129,0.65)]"
        >
          <StageIcon weight="bold" size={18} className="text-accent-200" />
          <span className="pointer-events-none absolute inset-0">
            <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 animate-orbit-medium rounded-full bg-accent-200 shadow-[0_0_6px_rgba(16,185,129,0.9)]" />
          </span>
        </motion.div>
      </div>
    );
  }

  // Pending — ghosted disc with a muted stage icon so the user can
  // still tell at a glance what each upcoming stage will do.
  return (
    <div className="relative h-11 w-11">
      <div className="absolute inset-[6px] flex items-center justify-center rounded-full border border-surface-700 bg-surface-900">
        <StageIcon weight="bold" size={16} className="text-surface-500" />
      </div>
    </div>
  );
}
