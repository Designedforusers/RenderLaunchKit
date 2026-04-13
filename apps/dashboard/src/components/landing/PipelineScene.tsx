import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CaretDown, CheckCircle } from '@phosphor-icons/react';

import { SCROLL_STAGES } from './data.js';

gsap.registerPlugin(ScrollTrigger);

// ─────────────────────────────────────────────────────────────────────
// Section: Scrollytelling pipeline. GSAP ScrollTrigger pins a stage and
// the left copy column swaps between SCROLL_STAGES as the user scrolls.
// ─────────────────────────────────────────────────────────────────────

export function PipelineScene() {
  const sectionRef = useRef<HTMLElement>(null);
  const [stageIndex, setStageIndex] = useState(0);

  const variant: VisualVariant = useMemo(() => {
    if (typeof window === 'undefined') return 'living';
    const v = new URLSearchParams(window.location.search).get('visuals');
    return v === 'schematic' ? 'schematic' : 'living';
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const mm = gsap.matchMedia();

    mm.add('(min-width: 1024px)', () => {
      const trigger = ScrollTrigger.create({
        trigger: el,
        start: 'top top',
        end: () => `+=${SCROLL_STAGES.length * 480}`,
        pin: true,
        scrub: 0.6,
        onUpdate: (self) => {
          const raw = self.progress * SCROLL_STAGES.length;
          const i = Math.min(SCROLL_STAGES.length - 1, Math.max(0, Math.floor(raw)));
          setStageIndex(i);
        },
      });
      return () => {
        trigger.kill();
      };
    });

    return () => {
      mm.revert();
    };
  }, []);

  const stage = SCROLL_STAGES[stageIndex] ?? SCROLL_STAGES[0];
  if (!stage) return null;

  return (
    <section
      ref={sectionRef}
      id="pipeline"
      className="relative z-10 overflow-hidden py-14 md:min-h-screen md:py-24"
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 md:gap-16 lg:grid-cols-12">
        {/* LEFT — copy (swaps on scroll) */}
        <div className="flex flex-col justify-center lg:col-span-5 lg:min-h-[60vh]">
          <div className="flex items-center gap-2 text-label text-text-muted">
            <span className="h-px w-6 bg-accent-500" />
            THE PIPELINE
          </div>
          <h2 className="mt-4 font-display text-display-lg leading-[1.02] tracking-[-0.02em] text-text-primary">
            Four agents, one&nbsp;kit.
          </h2>
          <p className="mt-4 max-w-md text-body-lg text-text-secondary">
            Most AI tools &ldquo;generate marketing&rdquo; in one prompt. LaunchKit runs a
            staged pipeline where each agent has a single job, writes to a
            checkpoint, and hands off to the next.
          </p>

          <AnimatePresence mode="wait">
            <motion.div
              key={stage.index}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="mt-10 rounded-2xl border border-surface-800 bg-surface-900/60 p-6 backdrop-blur-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-mono-sm text-success-400">
                  {stage.index} / 04
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  {stage.mono}
                </span>
              </div>
              <h3 className="mt-3 text-heading-xl text-text-primary">
                {stage.title}
              </h3>
              <p className="mt-2 text-body-md text-text-secondary">
                {stage.body}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* RIGHT — big stage visual */}
        <div className="lg:col-span-7">
          <div className="sticky top-24 lg:min-h-[60vh]">
            <StageVisual activeIdx={stageIndex} variant={variant} />
          </div>
        </div>
      </div>

      {/* Scroll hint on first load */}
      <div className="pointer-events-none absolute inset-x-0 bottom-10 hidden justify-center lg:flex">
        <motion.div
          className="flex flex-col items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted"
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          scroll
          <CaretDown size={12} weight="bold" />
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Agent visuals — four tiny schematic illustrations, one per agent.
// Consistent visual language: thin 1px strokes, dot nodes, mono labels,
// all on a 240x120 viewBox so they line up across the 2x2 grid.
//
// Color strategy: parent sets CSS `color` via Tailwind `text-*`, children
// use `fill="currentColor"` / `stroke="currentColor"` so each visual
// inherits the right accent-or-muted tone depending on agent state. This
// means every visual reshades automatically when you swap themes.
// ─────────────────────────────────────────────────────────────────────

type VisualProps = { isActive: boolean; isDone: boolean };

function VisualCanvas({
  children,
  isActive,
  isDone,
}: VisualProps & { children: React.ReactNode }) {
  return (
    <div
      className={`relative flex h-full w-full items-center justify-center transition-opacity duration-500 ${
        isActive ? 'opacity-100' : isDone ? 'opacity-90' : 'opacity-85'
      }`}
    >
      <svg
        viewBox="0 0 240 120"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-full w-full overflow-visible"
      >
        {children}
      </svg>
    </div>
  );
}

/** 01 · Reader — a tiny file tree with a scan highlight on README.md */
function Agent01Reader({ isActive, isDone }: VisualProps) {
  const activeColor = isActive ? 'rgb(var(--success-400))' : 'rgb(var(--surface-400))';
  const dimColor = 'rgb(var(--surface-300) / 0.95)';
  const mutedColor = 'rgb(var(--surface-400) / 0.85)';

  return (
    <VisualCanvas isActive={isActive} isDone={isDone}>
      {/* Tree trunk */}
      <path
        d="M 54 30 L 54 98 M 54 48 L 70 48 M 54 66 L 70 66 M 54 84 L 70 84"
        stroke={dimColor}
        strokeWidth={1}
      />

      {/* Root: readme.md — the active one */}
      <g>
        {/* Highlight bar on active */}
        {isActive && (
          <motion.rect
            x={50}
            y={22}
            width={160}
            height={16}
            rx={3}
            fill={activeColor}
            fillOpacity={0.12}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <circle cx={54} cy={30} r={3.2} fill={activeColor} />
        <text
          x={66}
          y={34}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          fill={activeColor}
          fontWeight={600}
        >
          readme.md
        </text>
        {/* scan cursor — CSS keyframe animation with hard steps easing */}
        {isActive && (
          <rect
            x={128}
            y={24}
            width={1.4}
            height={12}
            fill={activeColor}
            className="animate-cursor-blink"
          />
        )}
      </g>

      {/* child nodes */}
      <g>
        <circle cx={70} cy={48} r={2.6} fill={dimColor} />
        <text
          x={80}
          y={52}
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
          fill={dimColor}
        >
          package.json
        </text>

        <circle cx={70} cy={66} r={2.6} fill={dimColor} />
        <text
          x={80}
          y={70}
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
          fill={dimColor}
        >
          src/
        </text>

        <circle cx={70} cy={84} r={2.6} fill={mutedColor} />
        <text
          x={80}
          y={88}
          fontSize={9}
          fontFamily="JetBrains Mono, monospace"
          fill={mutedColor}
        >
          docs/
        </text>
      </g>

      {/* file count ticker */}
      <text
        x={190}
        y={112}
        fontSize={8}
        fontFamily="JetBrains Mono, monospace"
        fill={mutedColor}
        textAnchor="end"
      >
        1,284 files
      </text>
    </VisualCanvas>
  );
}

/** 02 · Researcher — radial citation network */
function Agent02Researcher({ isActive, isDone }: VisualProps) {
  const activeColor = isActive ? 'rgb(var(--success-400))' : 'rgb(var(--surface-400))';
  const dimColor = 'rgb(var(--surface-300))';
  const mutedColor = 'rgb(var(--surface-400) / 0.85)';

  // 6 outer nodes on a circle around center (120, 60).
  const cx = 120;
  const cy = 58;
  const r = 38;
  const nodes = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, i };
  });

  return (
    <VisualCanvas isActive={isActive} isDone={isDone}>
      {/* connector lines */}
      {nodes.map((n) => (
        <motion.line
          key={`l-${n.i}`}
          x1={cx}
          y1={cy}
          x2={n.x}
          y2={n.y}
          stroke={isActive ? activeColor : dimColor}
          strokeWidth={1}
          strokeDasharray="2 3"
          initial={{ pathLength: 0, opacity: 0.3 }}
          animate={isActive ? { pathLength: 1, opacity: 1 } : { pathLength: 1, opacity: 0.5 }}
          transition={{ duration: 0.9, delay: n.i * 0.08, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}

      {/* outer nodes with tiny citation badges */}
      {nodes.map((n) => (
        <g key={`n-${n.i}`}>
          <motion.circle
            cx={n.x}
            cy={n.y}
            r={4}
            fill="rgb(var(--surface-950))"
            stroke={isActive ? activeColor : dimColor}
            strokeWidth={1.2}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4, delay: 0.1 + n.i * 0.06 }}
          />
          <text
            x={n.x}
            y={n.y + 2.5}
            fontSize={6}
            fontFamily="JetBrains Mono, monospace"
            fontWeight={600}
            fill={isActive ? activeColor : dimColor}
            textAnchor="middle"
          >
            {n.i + 1}
          </text>
        </g>
      ))}

      {/* center node — repo */}
      <circle cx={cx} cy={cy} r={6} fill={activeColor} />
      {isActive && (
        <motion.circle
          cx={cx}
          cy={cy}
          r={6}
          fill="none"
          stroke={activeColor}
          strokeWidth={1}
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
        />
      )}

      {/* counter */}
      <text
        x={120}
        y={112}
        fontSize={8}
        fontFamily="JetBrains Mono, monospace"
        fill={mutedColor}
        textAnchor="middle"
      >
        14 searches · 12 citations
      </text>
    </VisualCanvas>
  );
}

/** 03 · Strategist — top node fans out to 5 compute buckets */
function Agent03Strategist({ isActive, isDone }: VisualProps) {
  const activeColor = isActive ? 'rgb(var(--success-400))' : 'rgb(var(--surface-400))';
  const dimColor = 'rgb(var(--surface-300))';
  const mutedColor = 'rgb(var(--surface-400) / 0.85)';

  const topX = 120;
  const topY = 22;
  const rowY = 80;
  const laneWidth = 38;
  const lanes = Array.from({ length: 5 }, (_, i) => ({
    x: topX + (i - 2) * laneWidth,
    i,
    label: ['TX', 'IM', 'VD', 'AU', '3D'][i],
  }));

  return (
    <VisualCanvas isActive={isActive} isDone={isDone}>
      {/* Top node — strategist */}
      <circle cx={topX} cy={topY} r={5} fill={activeColor} />
      <text
        x={topX}
        y={topY - 9}
        fontSize={8}
        fontFamily="JetBrains Mono, monospace"
        fill={isActive ? activeColor : dimColor}
        fontWeight={600}
        textAnchor="middle"
      >
        STRATEGY
      </text>

      {/* fanout lines */}
      {lanes.map((l) => (
        <motion.path
          key={`p-${l.i}`}
          d={`M ${topX} ${topY + 6} Q ${topX} ${(topY + rowY) / 2}, ${l.x} ${rowY - 6}`}
          stroke={isActive ? activeColor : dimColor}
          strokeWidth={1}
          fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, delay: l.i * 0.06, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}

      {/* Flow particles on active */}
      {isActive &&
        lanes.map((l) => (
          <motion.circle
            key={`flow-${l.i}`}
            r={2}
            fill={activeColor}
            initial={{ cx: topX, cy: topY + 6, opacity: 0 }}
            animate={{
              cx: [topX, l.x],
              cy: [topY + 6, rowY - 6],
              opacity: [0, 1, 1, 0],
            }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              delay: l.i * 0.2,
              ease: 'easeInOut',
            }}
          />
        ))}

      {/* 5 child buckets */}
      {lanes.map((l) => (
        <g key={`b-${l.i}`}>
          <rect
            x={l.x - 12}
            y={rowY - 6}
            width={24}
            height={14}
            rx={3}
            fill="rgb(var(--surface-900))"
            stroke={isActive ? activeColor : dimColor}
            strokeWidth={1}
          />
          <text
            x={l.x}
            y={rowY + 3}
            fontSize={7}
            fontFamily="JetBrains Mono, monospace"
            fontWeight={600}
            fill={isActive ? activeColor : dimColor}
            textAnchor="middle"
          >
            {l.label}
          </text>
        </g>
      ))}

      {/* label */}
      <text
        x={120}
        y={112}
        fontSize={8}
        fontFamily="JetBrains Mono, monospace"
        fill={mutedColor}
        textAnchor="middle"
      >
        5 compute buckets · 17 briefs
      </text>
    </VisualCanvas>
  );
}

/** 04 · Reviewer — a 270deg quality arc with a sweeping progress */
function Agent04Reviewer({ isActive, isDone }: VisualProps) {
  const activeColor = isActive ? 'rgb(var(--success-400))' : 'rgb(var(--surface-400))';
  const dimColor = 'rgb(var(--surface-300))';
  const mutedColor = 'rgb(var(--surface-400) / 0.85)';

  // 270deg arc, from 135deg (bottom-left) CCW to 405deg (bottom-right)
  const cx = 120;
  const cy = 60;
  const radius = 34;
  const startDeg = 135;
  const endDeg = 405;
  const toXY = (deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius];
  };
  const [sx, sy] = toXY(startDeg);
  const [ex, ey] = toXY(endDeg);
  const largeArc = 1;
  const arcPath = `M ${sx} ${sy} A ${radius} ${radius} 0 ${largeArc} 1 ${ex} ${ey}`;

  return (
    <VisualCanvas isActive={isActive} isDone={isDone}>
      {/* background arc */}
      <path d={arcPath} stroke={dimColor} strokeWidth={3} strokeLinecap="round" fill="none" />

      {/* progress arc — sweeps to 94% on active */}
      <motion.path
        d={arcPath}
        stroke={activeColor}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: isActive || isDone ? 0.94 : 0 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* 5 star dots below center */}
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.circle
          key={`s-${i}`}
          cx={cx - 24 + i * 12}
          cy={cy + 20}
          r={2.2}
          fill={i < 4 ? activeColor : dimColor}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, delay: 0.2 + i * 0.08 }}
        />
      ))}

      {/* center score */}
      <text
        x={cx}
        y={cy + 4}
        fontSize={22}
        fontFamily="FAIRE Octave, serif"
        fontWeight={500}
        fill={activeColor}
        textAnchor="middle"
        letterSpacing="-0.02em"
      >
        94
      </text>

      {/* label */}
      <text
        x={120}
        y={112}
        fontSize={8}
        fontFamily="JetBrains Mono, monospace"
        fill={mutedColor}
        textAnchor="middle"
      >
        quality score · +3 patterns learned
      </text>
    </VisualCanvas>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 2 — "Living Dashboard" visuals.
//
// Each agent becomes a tiny HTML/Tailwind UI widget that looks like a
// real product screenshot: code editor pane, citation card stack,
// parallel Gantt timeline, scorecard with histogram. More content-rich
// than the schematic line-art — users see *what the agent produces*.
// ─────────────────────────────────────────────────────────────────────

/** 01 · Reader — mini code-editor pane with highlighted line + cursor */
function Agent01ReaderLiving({ isActive, isDone }: VisualProps) {
  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-md border bg-surface-950/80 font-mono text-[8px] leading-[1.5] transition-opacity ${
        isActive ? 'border-success-500/40 opacity-100' : 'border-surface-700 opacity-90'
      } ${isDone ? 'opacity-95' : ''}`}
    >
      <div className="flex items-center justify-between border-b border-surface-800 px-1.5 py-0.5">
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-surface-600" />
          <span className="text-text-tertiary">readme.md</span>
        </span>
        <span className="text-[6px] tracking-wide text-text-muted">L14 · 1,284 FILES</span>
      </div>
      <div className="px-1 py-1">
        <div className="flex gap-1.5">
          <span className="w-3 text-right text-text-muted">12</span>
          <span className="text-text-tertiary"># Orbit CLI</span>
        </div>
        <div className="flex gap-1.5">
          <span className="w-3 text-right text-text-muted">13</span>
          <span className="text-text-muted">&nbsp;</span>
        </div>
        <div
          className={`-mx-1 flex gap-1.5 px-1 ${
            isActive || isDone ? 'bg-success-500/[0.14]' : ''
          }`}
        >
          <span className={`w-3 text-right ${isActive || isDone ? 'text-success-400' : 'text-text-muted'}`}>
            14
          </span>
          <span className={isActive || isDone ? 'text-text-primary' : 'text-text-tertiary'}>
            Ship to anywhere
            {isActive && (
              <span className="ml-0.5 inline-block h-2 w-[1px] -translate-y-[1px] bg-success-400 align-middle animate-cursor-blink" />
            )}
          </span>
        </div>
        <div className="flex gap-1.5">
          <span className="w-3 text-right text-text-muted">15</span>
          <span className="text-text-tertiary">in one command</span>
        </div>
        <div className="flex gap-1.5">
          <span className="w-3 text-right text-text-muted">16</span>
          <span className="text-text-muted">- zero config</span>
        </div>
      </div>
      <div
        className={`absolute bottom-1 right-1 rounded border px-1 py-[1px] text-[6px] font-semibold tracking-[0.14em] transition-opacity ${
          isActive || isDone
            ? 'border-success-500/40 bg-success-500/10 text-success-400 opacity-100'
            : 'border-surface-700 text-text-muted opacity-50'
        }`}
      >
        CITED
      </div>
    </div>
  );
}

/** 02 · Researcher — stack of 3 live citation cards */
function Agent02ResearcherLiving({ isActive, isDone }: VisualProps) {
  const cards = [
    { domain: 'github.com',  quote: 'ships in one binary',     num: 12, fresh: true  },
    { domain: 'ycombinator', quote: 'zero-config startup',     num: 11, fresh: false },
    { domain: 'stripe.com',  quote: 'developer-first DX',      num: 10, fresh: false },
  ] as const;

  return (
    <div className="relative h-full w-full overflow-hidden px-1 py-1 font-mono text-[7px]">
      <div className="space-y-[3px]">
        {cards.map((c, i) => (
          <motion.div
            key={c.domain}
            className={`flex items-center gap-1.5 rounded border px-1.5 py-[3px] ${
              c.fresh && (isActive || isDone)
                ? 'border-success-500/40 bg-success-500/[0.06]'
                : 'border-surface-700 bg-surface-900/60'
            }`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
          >
            <span
              className={`h-1.5 w-1.5 flex-none rounded-full ${
                c.fresh && (isActive || isDone) ? 'bg-success-400' : 'bg-text-muted'
              }`}
            />
            <span className="flex-none text-text-tertiary">{c.domain}</span>
            <span className="flex-1 truncate italic text-text-muted">&ldquo;{c.quote}&rdquo;</span>
            <span
              className={`flex-none rounded bg-surface-800 px-1 text-[6px] tabular-nums ${
                c.fresh && (isActive || isDone) ? 'text-success-400' : 'text-text-muted'
              }`}
            >
              [{c.num}]
            </span>
          </motion.div>
        ))}
      </div>
      <div className="absolute inset-x-1 bottom-0 flex justify-between font-mono text-[6px] tracking-wide text-text-muted">
        <span>14 SOURCES</span>
        <span>{isActive ? '· CRAWLING' : '12 CITATIONS'}</span>
      </div>
    </div>
  );
}

/** 03 · Strategist — 5-lane Gantt timeline with sweeping "now" line */
function Agent03StrategistLiving({ isActive, isDone }: VisualProps) {
  const lanes = [
    { id: 'TX', width: '38%', delay: 0,   done: true  },
    { id: 'IM', width: '56%', delay: 0.1, done: true  },
    { id: 'VD', width: '92%', delay: 0.2, done: false },
    { id: 'AU', width: '44%', delay: 0.3, done: true  },
    { id: '3D', width: '78%', delay: 0.4, done: false },
  ] as const;

  return (
    <div className="relative h-full w-full overflow-hidden px-1.5 py-1 font-mono text-[7px]">
      <div className="flex items-center justify-between pb-1">
        <span className="text-text-tertiary">RENDER WORKFLOWS</span>
        <span className="text-text-muted">5 TASKS</span>
      </div>
      <div className="space-y-[3px]">
        {lanes.map((l) => (
          <div key={l.id} className="flex items-center gap-1.5">
            <span className="w-[14px] text-[6px] text-text-muted">{l.id}</span>
            <div className="relative h-[4px] flex-1 overflow-hidden rounded-sm bg-surface-800/70">
              <motion.div
                className={`h-full rounded-sm ${
                  isActive || isDone
                    ? l.done
                      ? 'bg-success-500'
                      : 'bg-success-400/70'
                    : 'bg-surface-500'
                }`}
                initial={{ width: 0 }}
                animate={{ width: l.width }}
                transition={{ duration: 0.9, delay: l.delay, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        ))}
      </div>
      {isActive && (
        <motion.div
          className="pointer-events-none absolute top-[20px] bottom-[12px] w-[1px] bg-success-400"
          initial={{ left: '18%' }}
          animate={{ left: ['18%', '86%'] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
          style={{ boxShadow: '0 0 6px rgb(var(--success-500) / 0.8)' }}
        />
      )}
      <div className="absolute inset-x-1.5 bottom-0 flex justify-between text-[6px] text-text-muted">
        <span>17 ASSETS</span>
        <span>10:00 ETA</span>
      </div>
    </div>
  );
}

/** 04 · Reviewer — scorecard with big number, histogram, approved stamp */
function Agent04ReviewerLiving({ isActive, isDone }: VisualProps) {
  const bars = [12, 22, 38, 62, 90, 70, 34] as const;

  return (
    <div className="relative h-full w-full overflow-hidden px-2 py-1.5 font-mono text-[7px]">
      <div className="flex items-start justify-between">
        <div>
          <div
            className={`font-display leading-none tracking-[-0.03em] ${
              isActive || isDone ? 'text-text-primary' : 'text-text-tertiary'
            }`}
            style={{ fontSize: '28px' }}
          >
            94
          </div>
          <div className="mt-0.5 text-[6px] tracking-[0.14em] text-text-muted">
            QUALITY SCORE
          </div>
        </div>
        <div
          className={`rounded border px-1 py-[1px] text-[6px] font-semibold tracking-[0.14em] ${
            isActive || isDone
              ? 'border-success-500/40 bg-success-500/10 text-success-400'
              : 'border-surface-700 text-text-muted'
          }`}
        >
          {isActive || isDone ? 'APPROVED' : 'PENDING'}
        </div>
      </div>

      <div className="absolute inset-x-2 bottom-3 flex h-[18px] items-end gap-[2px]">
        {bars.map((h, i) => (
          <motion.div
            key={i}
            className={`flex-1 rounded-t-[1px] ${
              i === 4
                ? isActive || isDone
                  ? 'bg-success-400'
                  : 'bg-surface-400'
                : isActive || isDone
                ? 'bg-surface-600'
                : 'bg-surface-700'
            }`}
            initial={{ height: 0 }}
            animate={{ height: `${h}%` }}
            transition={{ duration: 0.6, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
      </div>

      <div className="absolute inset-x-2 bottom-0 flex justify-between text-[6px] text-text-muted">
        <span>ASSET 12/17</span>
        <span>+3 PATTERNS</span>
      </div>
    </div>
  );
}

type VisualVariant = 'schematic' | 'living';

function AgentVisual({
  index,
  isActive,
  isDone,
  variant,
}: { index: number; variant: VisualVariant } & VisualProps) {
  if (variant === 'living') {
    switch (index) {
      case 0:
        return <Agent01ReaderLiving isActive={isActive} isDone={isDone} />;
      case 1:
        return <Agent02ResearcherLiving isActive={isActive} isDone={isDone} />;
      case 2:
        return <Agent03StrategistLiving isActive={isActive} isDone={isDone} />;
      case 3:
        return <Agent04ReviewerLiving isActive={isActive} isDone={isDone} />;
      default:
        return null;
    }
  }
  switch (index) {
    case 0:
      return <Agent01Reader isActive={isActive} isDone={isDone} />;
    case 1:
      return <Agent02Researcher isActive={isActive} isDone={isDone} />;
    case 2:
      return <Agent03Strategist isActive={isActive} isDone={isDone} />;
    case 3:
      return <Agent04Reviewer isActive={isActive} isDone={isDone} />;
    default:
      return null;
  }
}

function StageVisual({
  activeIdx,
  variant,
}: {
  activeIdx: number;
  variant: VisualVariant;
}) {
  // Represents four "agent panels" as floating cards with connecting lines.
  return (
    <div className="relative aspect-[5/4] rounded-3xl border border-surface-800 bg-gradient-to-br from-surface-900/70 to-surface-950/90 p-8 backdrop-blur-sm">
      {/* connecting lines between nodes (SVG overlay) */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 500 400"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="flow" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgb(var(--success-500) / 0)" />
            <stop offset="50%" stopColor="rgb(var(--success-500) / 0.7)" />
            <stop offset="100%" stopColor="rgb(var(--success-500) / 0)" />
          </linearGradient>
        </defs>
        {/* grid */}
        {[...Array<number>(9)].map((_, i) => (
          <line
            key={`v-${i}`}
            x1={i * 56}
            x2={i * 56}
            y1={0}
            y2={400}
            stroke="rgb(var(--surface-400) / 0.07)"
            strokeWidth={1}
          />
        ))}
        {[...Array<number>(8)].map((_, i) => (
          <line
            key={`h-${i}`}
            y1={i * 56}
            y2={i * 56}
            x1={0}
            x2={500}
            stroke="rgb(var(--surface-400) / 0.07)"
            strokeWidth={1}
          />
        ))}
        {/* Path from 01 -> 02 -> 03 -> 04 — a zigzag polyline */}
        <motion.path
          d="M 110 90 L 250 90 L 250 210 L 400 210 L 400 330 L 110 330"
          fill="none"
          stroke="url(#flow)"
          strokeWidth={2}
          strokeDasharray="6 6"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: (activeIdx + 1) / 4 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>

      {/* Node cards */}
      <div className="relative grid h-full grid-cols-1 gap-4 sm:grid-cols-2 sm:grid-rows-2 sm:gap-6">
        {SCROLL_STAGES.map((s, i) => {
          const isActive = i === activeIdx;
          const isDone = i < activeIdx;
          return (
            <motion.div
              key={s.index}
              className={`relative flex flex-col gap-3 rounded-xl border p-4 backdrop-blur-sm transition-all ${
                isActive
                  ? 'border-success-500/60 bg-surface-900'
                  : isDone
                  ? 'border-surface-700 bg-surface-900/70'
                  : 'border-surface-800 bg-surface-900/30'
              }`}
              animate={
                isActive
                  ? { scale: 1.03, y: -2 }
                  : { scale: 1, y: 0 }
              }
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`font-mono text-[10px] font-semibold tracking-[0.16em] ${
                    isActive
                      ? 'text-success-400'
                      : isDone
                      ? 'text-text-tertiary'
                      : 'text-text-muted'
                  }`}
                >
                  AGENT {s.index}
                </span>
                {isDone && (
                  <CheckCircle size={14} weight="fill" className="text-success-500" />
                )}
                {isActive && (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inset-0 animate-ping rounded-full bg-success-500 opacity-60" />
                    <span className="relative h-2 w-2 rounded-full bg-success-500" />
                  </span>
                )}
              </div>

              {/* Agent-specific illustration — occupies the middle of the card */}
              <div className="min-h-0 flex-1 py-2">
                <AgentVisual
                  index={i}
                  isActive={isActive}
                  isDone={isDone}
                  variant={variant}
                />
              </div>

              <div>
                <div className={`text-heading-md ${isActive ? 'text-text-primary' : 'text-text-tertiary'}`}>
                  {s.title.split(' ').slice(0, 4).join(' ')}
                </div>
                <div className="mt-1 font-mono text-[10px] text-text-muted">
                  {s.mono}
                </div>
              </div>
              {isActive && (
                <motion.div
                  layoutId="stageAccent"
                  className="pointer-events-none absolute inset-0 rounded-xl"
                  style={{
                    boxShadow:
                      '0 0 0 1px rgb(var(--success-500) / 0.35), 0 30px 60px -20px rgb(var(--success-500) / 0.4)',
                  }}
                  transition={{ duration: 0.4 }}
                />
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
