import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import gsap from 'gsap';
import {
  PIPELINE_PHASE_META,
  type ToolCallEntry,
} from './event-helpers.js';

interface AgentToolCallStreamProps {
  toolCalls: ToolCallEntry[];
  /** Whether the pipeline is still running — controls the trailing caret. */
  isStreaming: boolean;
  /** Cap the visible list to avoid unbounded scroll in long runs. */
  maxEntries?: number;
}

/**
 * A live terminal-style log of every tool call the agents make.
 *
 * This is the dashboard's answer to "show, don't tell" — watching
 * the research agent reach out to GitHub, HN, and the web in real
 * time is the half of the demo that makes the multi-agent system
 * feel alive. The ordering is append-only: newest entries slide in
 * from the bottom, older entries fade to a dimmer color as they age
 * out of the active window.
 *
 * Framer Motion drives the enter/exit animation. GSAP drives the
 * auto-scroll-to-bottom tween so the scrolling is smooth even when
 * ten events arrive in quick succession.
 */
export function AgentToolCallStream({
  toolCalls,
  isStreaming,
  maxEntries = 40,
}: AgentToolCallStreamProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visible = toolCalls.slice(-maxEntries);
  const shouldReduceMotion = useReducedMotion();

  // GSAP-powered auto-scroll to the bottom whenever a new entry
  // arrives. We use GSAP rather than `element.scrollTo({ behavior:
  // 'smooth' })` because the native smooth scroll does not queue
  // cleanly when multiple new entries arrive in the same frame —
  // GSAP's tween system coalesces them into a single animation.
  //
  // Under reduced-motion, we snap the scroll position directly so
  // the user still sees the newest entries without the 0.6s tween.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (shouldReduceMotion) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const ctx = gsap.context(() => {
      gsap.to(el, {
        scrollTop: el.scrollHeight,
        duration: 0.6,
        ease: 'power2.out',
      });
    });
    return () => {
      ctx.revert();
    };
  }, [visible.length, shouldReduceMotion]);

  return (
    <div className="card relative overflow-hidden">
      {/* Corner scan line — a vertical sweep that hints "this is live" */}
      {isStreaming && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 h-full overflow-hidden"
          aria-hidden="true"
        >
          <div className="animate-scan-line absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-accent-400/60 to-transparent" />
        </div>
      )}

      <div className="relative flex items-center justify-between">
        <h3 className="label">Agent Activity</h3>
        <div className="flex items-center gap-2">
          <span className="font-mono text-mono-sm text-text-muted">
            {toolCalls.length} {toolCalls.length === 1 ? 'call' : 'calls'}
          </span>
          {isStreaming && (
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-400" />
              </span>
              <span className="label text-accent-400">Live</span>
            </span>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative mt-4 h-48 space-y-1.5 overflow-y-auto pr-1"
      >
        {visible.length === 0 ? (
          <EmptyState isStreaming={isStreaming} />
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((entry, idx) => (
              <ToolCallLine
                key={entry.id}
                entry={entry}
                // The three most recent entries render at full color;
                // older entries fade toward the surface palette so
                // the eye is always drawn to the freshest activity.
                ageIndex={visible.length - 1 - idx}
              />
            ))}
          </AnimatePresence>
        )}

        {/* Blinking caret at the bottom of the log while streaming */}
        {isStreaming && visible.length > 0 && (
          <motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <span className="font-mono text-mono-sm text-text-muted">&gt;</span>
            <motion.span
              className="inline-block h-3 w-1.5 bg-accent-400"
              animate={shouldReduceMotion ? { opacity: 1 } : { opacity: [1, 0, 1] }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 1, repeat: Infinity, ease: 'linear' }
              }
            />
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ToolCallLine({
  entry,
  ageIndex,
}: {
  entry: ToolCallEntry;
  ageIndex: number;
}) {
  const phaseMeta = entry.phase ? PIPELINE_PHASE_META[entry.phase] : null;
  const isFresh = ageIndex < 3;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12, filter: 'blur(4px)' }}
      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
      transition={{
        type: 'spring',
        stiffness: 360,
        damping: 28,
        filter: { duration: 0.25 },
      }}
      className={`flex items-start gap-2 font-mono text-mono-sm leading-snug ${
        isFresh ? 'text-text-primary' : 'text-text-muted'
      }`}
    >
      <span
        className={`mt-0.5 select-none ${
          isFresh ? 'text-accent-400' : 'text-surface-700'
        }`}
      >
        &rarr;
      </span>
      <span className="flex-1 truncate">
        {phaseMeta && (
          <span
            className={`mr-1.5 rounded px-1 py-0.5 text-[9px] uppercase tracking-wider ${
              isFresh
                ? 'bg-accent-500/15 text-accent-300'
                : 'bg-surface-800/60 text-surface-600'
            }`}
          >
            {phaseMeta.shortLabel}
          </span>
        )}
        <span
          className={`font-semibold ${isFresh ? 'text-accent-200' : 'text-surface-500'}`}
        >
          {entry.toolName}
        </span>
        {entry.detail && (
          <span className="ml-2 truncate text-surface-500">
            {entry.detail}
          </span>
        )}
      </span>
    </motion.div>
  );
}

function EmptyState({ isStreaming }: { isStreaming: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex h-full items-center justify-center"
    >
      <div className="text-center">
        <div className="mx-auto mb-2.5 w-8 h-8 rounded-lg bg-surface-800/40 flex items-center justify-center">
          {isStreaming ? (
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-accent-400"
              animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
          ) : (
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
          )}
        </div>
        <p className="font-mono text-mono-sm text-text-muted">
          {isStreaming
            ? 'Waiting for the first tool call...'
            : 'No agent activity recorded'}
        </p>
      </div>
    </motion.div>
  );
}
