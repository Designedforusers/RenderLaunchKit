import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import gsap from 'gsap';
import {
  PIPELINE_PHASE_META,
  phaseFromStatus,
  type PipelinePhase,
} from './event-helpers.js';

interface StageLoaderProps {
  /** The raw API status — we narrow to a pipeline phase internally. */
  status: string;
  /** The most recent live caption for the active phase. */
  detail?: string | null;
}

/**
 * Dispatches to a per-phase animated loading panel that reinforces
 * what the current pipeline stage is actually doing. Each sub-loader
 * uses a different visual metaphor so the reviewer never sees two
 * consecutive stages look alike — the sense of progress comes from
 * the metaphor changing, not just the stage pill filling.
 */
export function StageLoader({ status, detail }: StageLoaderProps) {
  const phase = phaseFromStatus(status);

  if (!phase || status === 'complete' || status === 'failed') {
    return null;
  }

  const meta = PIPELINE_PHASE_META[phase];

  return (
    <div className="card relative overflow-hidden">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-accent-400">
            Stage {meta.index.toString().padStart(2, '0')}
          </p>
          <h3 className="mt-1 font-mono text-lg font-semibold text-surface-100">
            {meta.label}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-400" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent-400">
            Running
          </span>
        </div>
      </div>

      <div className="relative">
        <StageBody phase={phase} />
      </div>

      <div className="relative mt-4 h-4">
        <AnimatePresence mode="wait">
          <motion.p
            key={detail ?? meta.description}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-x-0 truncate font-mono text-xs text-surface-500"
          >
            {detail ?? meta.description}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

function StageBody({ phase }: { phase: PipelinePhase }) {
  switch (phase) {
    case 'analyzing':
      return <AnalyzeBody />;
    case 'researching':
      return <ResearchBody />;
    case 'strategizing':
      return <StrategizeBody />;
    case 'generating':
      return <GenerateBody />;
    case 'reviewing':
      return <ReviewBody />;
  }
}

// ── Analyze ──────────────────────────────────────────────────────────
// A mock file tree with a scan highlight sweeping top-to-bottom.
// Rows get individually highlighted as the scan line passes through
// them, like a linter walking a repository.

const ANALYZE_ROWS = [
  { indent: 0, name: 'README.md', size: 'w-24' },
  { indent: 0, name: 'package.json', size: 'w-28' },
  { indent: 0, name: 'src/', size: 'w-12' },
  { indent: 1, name: 'index.ts', size: 'w-20' },
  { indent: 1, name: 'routes/', size: 'w-16' },
  { indent: 2, name: 'api.ts', size: 'w-16' },
  { indent: 2, name: 'auth.ts', size: 'w-20' },
  { indent: 0, name: 'tsconfig.json', size: 'w-28' },
];

function AnalyzeBody() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="relative h-48 overflow-hidden rounded-lg border border-surface-800 bg-surface-950/60 p-4 font-mono text-xs">
      {/* Scan line sweeping top to bottom — suppressed under reduced-motion */}
      {!shouldReduceMotion && (
        <motion.div
          className="pointer-events-none absolute inset-x-0 h-8 bg-gradient-to-b from-transparent via-accent-500/15 to-transparent"
          animate={{ y: ['-20%', '120%'] }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
      <div className="relative space-y-1.5">
        {ANALYZE_ROWS.map((row, idx) => (
          <motion.div
            key={`${row.name}-${idx.toString()}`}
            className="flex items-center gap-2 text-surface-400"
            initial={{ opacity: 0.3 }}
            animate={
              shouldReduceMotion
                ? { opacity: 1 }
                : {
                    opacity: [0.3, 1, 0.3],
                    color: [
                      'rgb(148 163 184)',
                      'rgb(52 211 153)',
                      'rgb(148 163 184)',
                    ],
                  }
            }
            transition={
              shouldReduceMotion
                ? { duration: 0.2, ease: 'easeOut' }
                : {
                    duration: 2.4,
                    delay: (idx / ANALYZE_ROWS.length) * 2.4,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }
            }
            style={{ paddingLeft: `${(row.indent * 12).toString()}px` }}
          >
            <span className="text-surface-700">&#9500;&#9472;</span>
            <span>{row.name}</span>
            <span className={`h-1 ${row.size} rounded-full bg-surface-800`} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Research ─────────────────────────────────────────────────────────
// Concentric pulse rings plus floating search chips drifting outward.
// GSAP drives the ring pulse because we want an explicit stagger
// loop that framer-motion's variants would make more verbose.

const RESEARCH_CHIPS = [
  { label: 'github', angle: 20 },
  { label: 'hn', angle: 110 },
  { label: 'devto', angle: 200 },
  { label: 'exa', angle: 290 },
];

function ResearchBody() {
  const ringsRef = useRef<HTMLDivElement | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const el = ringsRef.current;
    if (!el) return;
    const rings = el.querySelectorAll<HTMLDivElement>('[data-ring]');
    if (rings.length === 0) return;
    // Under reduced-motion, land the rings on a static final frame
    // (faintly visible, no scale tween) instead of running the
    // infinite GSAP repeat.
    if (shouldReduceMotion) {
      gsap.set(rings, { scale: 1, opacity: 0.25 });
      return;
    }
    const ctx = gsap.context(() => {
      gsap.set(rings, { scale: 0, opacity: 0.6 });
      gsap.to(rings, {
        scale: 1,
        opacity: 0,
        duration: 2.6,
        ease: 'power2.out',
        stagger: 0.6,
        repeat: -1,
      });
    });
    return () => {
      ctx.revert();
    };
  }, [shouldReduceMotion]);

  return (
    <div className="relative flex h-48 items-center justify-center overflow-hidden rounded-lg border border-surface-800 bg-surface-950/60">
      <div ref={ringsRef} className="pointer-events-none absolute inset-0">
        <div
          data-ring
          className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-500/40"
        />
        <div
          data-ring
          className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-500/40"
        />
        <div
          data-ring
          className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-500/40"
        />
      </div>

      {/* Central node */}
      <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-accent-500/20 ring-2 ring-accent-400/40">
        <div className="h-3 w-3 animate-breathe rounded-full bg-accent-400" />
      </div>

      {/* Orbiting source chips — under reduced-motion the chips land
          at their final positions with a static opacity instead of
          the repeat: Infinity fade loop. */}
      {RESEARCH_CHIPS.map((chip, idx) => {
        const finalX = Math.cos((chip.angle * Math.PI) / 180) * 70;
        const finalY = Math.sin((chip.angle * Math.PI) / 180) * 56;
        return (
          <motion.div
            key={chip.label}
            className="absolute left-1/2 top-1/2 font-mono text-[10px] uppercase tracking-wider text-accent-300"
            initial={{
              x: 0,
              y: 0,
              opacity: 0,
            }}
            animate={
              shouldReduceMotion
                ? { x: finalX, y: finalY, opacity: 0.8 }
                : {
                    x: finalX,
                    y: finalY,
                    opacity: [0, 1, 1, 0],
                  }
            }
            transition={
              shouldReduceMotion
                ? { duration: 0.2, ease: 'easeOut' }
                : {
                    duration: 2.6,
                    repeat: Infinity,
                    delay: idx * 0.4,
                    ease: 'easeOut',
                  }
            }
          >
            <span className="rounded-full bg-accent-500/10 px-2 py-1 ring-1 ring-accent-500/30">
              {chip.label}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Strategize ───────────────────────────────────────────────────────
// A small graph of nodes being connected one edge at a time. Each
// edge animates its pathLength from 0 to 1 on a stagger, so the
// strategy visibly "takes shape" as the agent reasons through it.

function StrategizeBody() {
  const shouldReduceMotion = useReducedMotion();
  const nodes = [
    { id: 'audience', x: 20, y: 30, label: 'Audience' },
    { id: 'tone', x: 80, y: 24, label: 'Tone' },
    { id: 'channels', x: 140, y: 40, label: 'Channels' },
    { id: 'angle', x: 60, y: 90, label: 'Angle' },
    { id: 'assets', x: 130, y: 90, label: 'Assets' },
  ] as const;
  const edges = [
    ['audience', 'tone'],
    ['tone', 'channels'],
    ['audience', 'angle'],
    ['angle', 'assets'],
    ['channels', 'assets'],
    ['tone', 'angle'],
  ] as const;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="relative h-48 overflow-hidden rounded-lg border border-surface-800 bg-surface-950/60 p-4">
      <svg
        viewBox="0 0 170 130"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {edges.map(([fromId, toId], idx) => {
          const from = nodeMap.get(fromId);
          const to = nodeMap.get(toId);
          if (!from || !to) return null;
          return (
            <motion.line
              key={`${fromId}-${toId}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgb(52 211 153)"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="0 1"
              initial={{ pathLength: 0 }}
              animate={
                shouldReduceMotion
                  ? { pathLength: 1 }
                  : { pathLength: [0, 1, 1, 0] }
              }
              transition={
                shouldReduceMotion
                  ? { duration: 0.2, ease: 'easeOut' }
                  : {
                      duration: 3.2,
                      delay: idx * 0.35,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }
              }
            />
          );
        })}
        {nodes.map((node, idx) => (
          <motion.g
            key={node.id}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: idx * 0.15,
              type: 'spring',
              stiffness: 260,
              damping: 20,
            }}
            style={{ transformOrigin: `${node.x.toString()}px ${node.y.toString()}px` }}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={4}
              fill="rgb(16 185 129)"
              fillOpacity={0.9}
            />
            <circle
              cx={node.x}
              cy={node.y}
              r={7}
              fill="none"
              stroke="rgb(52 211 153)"
              strokeOpacity={0.3}
            />
          </motion.g>
        ))}
      </svg>
      {/* Floating labels positioned absolutely so they stay crisp */}
      {nodes.map((node, idx) => (
        <motion.span
          key={`label-${node.id}`}
          className="absolute font-mono text-[9px] uppercase tracking-wider text-surface-500"
          style={{
            left: `${((node.x / 170) * 100).toString()}%`,
            top: `${((node.y / 130) * 100).toString()}%`,
            transform: 'translate(8px, -50%)',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.8 }}
          transition={{ delay: 0.4 + idx * 0.15 }}
        >
          {node.label}
        </motion.span>
      ))}
    </div>
  );
}

// ── Generate ─────────────────────────────────────────────────────────
// A 2x4 grid of tiles that sequentially fill in — this mirrors the
// parallel fan-out of generation jobs in BullMQ. The worker launches
// 5-8 jobs in parallel; the grid shows that happening abstractly.

const GENERATE_TILES = [
  'Blog',
  'Tweet',
  'FAQ',
  'OG Image',
  'Video',
  'Podcast',
  'Voice Ad',
  'HN Post',
];

function GenerateBody() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="relative h-48 overflow-hidden rounded-lg border border-surface-800 bg-surface-950/60 p-4">
      <div className="grid h-full grid-cols-4 grid-rows-2 gap-2">
        {GENERATE_TILES.map((label, idx) => (
          <motion.div
            key={label}
            className="relative flex items-center justify-center overflow-hidden rounded-md border border-surface-800 bg-surface-900/60"
            initial={{ opacity: 0.2, scale: 0.9 }}
            animate={
              shouldReduceMotion
                ? { opacity: 1, scale: 1, borderColor: 'rgb(52 211 153)' }
                : {
                    opacity: [0.2, 1, 1, 0.2],
                    scale: [0.9, 1, 1, 0.9],
                    borderColor: [
                      'rgb(30 41 59)',
                      'rgb(52 211 153)',
                      'rgb(52 211 153)',
                      'rgb(30 41 59)',
                    ],
                  }
            }
            transition={
              shouldReduceMotion
                ? { duration: 0.2, ease: 'easeOut' }
                : {
                    duration: 2.6,
                    delay: (idx % 4) * 0.15 + Math.floor(idx / 4) * 0.08,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }
            }
          >
            {/* Background shimmer */}
            <div className="absolute inset-0 overflow-hidden">
              <div className="animate-shimmer-sweep absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-accent-500/10 to-transparent" />
            </div>
            <span className="relative font-mono text-[10px] uppercase tracking-wider text-surface-300">
              {label}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Review ───────────────────────────────────────────────────────────
// Mock review rows where each one fills a progress bar and pops in
// a score badge. Evokes the creative-director agent walking down
// the list of generated assets and scoring them.

const REVIEW_ROWS = [
  { label: 'blog_post', score: 8.4 },
  { label: 'twitter_thread', score: 7.9 },
  { label: 'og_image', score: 9.1 },
  { label: 'product_video', score: 7.2 },
];

function ReviewBody() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="h-48 overflow-hidden rounded-lg border border-surface-800 bg-surface-950/60 p-4">
      <div className="flex h-full flex-col justify-between">
        {REVIEW_ROWS.map((row, idx) => {
          const targetWidth = `${(row.score * 10).toString()}%`;
          return (
            <div
              key={row.label}
              className="flex items-center gap-3 font-mono text-xs"
            >
              <span className="w-28 truncate text-surface-400">{row.label}</span>
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-800">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent-600 via-accent-400 to-accent-300"
                  initial={{ width: '0%' }}
                  animate={
                    shouldReduceMotion
                      ? { width: targetWidth }
                      : { width: [`0%`, targetWidth, targetWidth, '0%'] }
                  }
                  transition={
                    shouldReduceMotion
                      ? { duration: 0.2, ease: 'easeOut' }
                      : {
                          duration: 3.2,
                          delay: idx * 0.3,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          times: [0, 0.35, 0.85, 1],
                        }
                  }
                />
              </div>
              <motion.span
                className={`w-10 text-right font-semibold ${
                  row.score >= 8 ? 'text-accent-300' : 'text-amber-300'
                }`}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={
                  shouldReduceMotion
                    ? { opacity: 1, scale: 1 }
                    : {
                        opacity: [0, 1, 1, 0],
                        scale: [0.5, 1, 1, 0.5],
                      }
                }
                transition={
                  shouldReduceMotion
                    ? { duration: 0.2, ease: 'easeOut' }
                    : {
                        duration: 3.2,
                        delay: idx * 0.3 + 0.5,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        times: [0, 0.2, 0.85, 1],
                      }
                }
              >
                {row.score.toFixed(1)}
              </motion.span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
