import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  GithubLogo,
  ArrowRight,
  CheckCircle,
} from '@phosphor-icons/react';

import { PIPELINE_STAGES } from './data.js';

// ─────────────────────────────────────────────────────────────────────
// Section: Hero — serif display left, live pipeline run right
// ─────────────────────────────────────────────────────────────────────

export function Hero() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-12 sm:px-6 md:pb-28 md:pt-28">
      <div className="grid items-start gap-16 lg:grid-cols-12">
        {/* LEFT: serif headline column */}
        <div className="lg:col-span-6">
          {/* Eyebrow chip */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="inline-flex items-center gap-2 rounded-full border border-surface-800 bg-surface-900/60 px-3 py-1 backdrop-blur-sm"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-success-500 opacity-60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-success-500" />
            </span>
            <span className="text-label text-text-muted">
              RUNNING ON RENDER WORKFLOWS
            </span>
          </motion.div>

          {/* Serif display headline with staggered line reveal */}
          <motion.h1
            className="mt-6 font-display text-[clamp(2rem,7.5vw,5rem)] leading-[0.98] tracking-[-0.03em] text-text-primary"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
            }}
          >
            {['Your GitHub repo,', 'shipped as a full', 'go-to-market kit.'].map(
              (line, i) => (
                <motion.span
                  key={i}
                  className="block"
                  variants={{
                    hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
                    visible: {
                      opacity: 1,
                      y: 0,
                      filter: 'blur(0px)',
                      transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
                    },
                  }}
                >
                  {i === 2 ? (
                    <span className="relative inline-block">
                      <span className="relative z-10">go-to-market kit.</span>
                      {/* accent underline swipe */}
                      <motion.span
                        className="absolute inset-x-0 bottom-[0.12em] z-0 h-[0.14em] rounded-sm bg-accent-500/70"
                        initial={{ scaleX: 0, originX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ delay: 1.2, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                        style={{ transformOrigin: '0% 50%' }}
                      />
                    </span>
                  ) : (
                    line
                  )}
                </motion.span>
              )
            )}
          </motion.h1>

          <motion.p
            className="mt-8 max-w-xl text-body-lg text-text-secondary"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            Paste a repository URL. LaunchKit reads the code, researches the market,
            writes the strategy and generates every asset you need to launch — in
            parallel, in minutes, with real-time cost tracking. Not a ChatGPT wrapper.
          </motion.p>

          {/* Inline URL form (marketing, not wired) + secondary CTA */}
          <motion.div
            className="mt-10 flex flex-col gap-3 sm:max-w-lg"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.05, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                // Read whatever the user typed in the repo input and
                // forward it to `/app` as a query param so the real
                // `RepositoryUrlForm` on that page can pre-fill from
                // it. An empty / placeholder-only value just lands on
                // `/app` with no prefill, which matches what the old
                // fire-and-forget behavior did anyway.
                const form = e.currentTarget;
                const input = form.elements.namedItem(
                  'repo'
                ) as HTMLInputElement | null;
                const raw = input?.value.trim() ?? '';
                const prefill =
                  raw.length === 0 || raw === 'github.com/' ? '' : raw;
                window.location.href = prefill
                  ? `/app?repo=${encodeURIComponent(prefill)}`
                  : '/app';
              }}
              className="group relative flex flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900/80 p-1.5 backdrop-blur-sm transition-all focus-within:border-accent-500/60 focus-within:shadow-[0_0_0_4px_rgba(255,94,74,0.12)] sm:flex-row sm:items-center"
            >
              <div className="flex flex-1 items-center">
                <GithubLogo
                  size={18}
                  weight="fill"
                  className="ml-3 text-text-tertiary"
                />
                <label htmlFor="landing-repo-input" className="sr-only">
                  GitHub repository URL
                </label>
                <input
                  id="landing-repo-input"
                  name="repo"
                  type="text"
                  defaultValue="github.com/"
                  placeholder="github.com/your/repo"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-body-md text-text-primary placeholder-text-muted focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="group/btn flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2.5 text-body-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,94,74,0.4),0_10px_30px_-10px_rgba(255,94,74,0.5)] transition-all hover:bg-accent-400 hover:shadow-[0_0_0_1px_rgba(255,94,74,0.55),0_16px_40px_-10px_rgba(255,94,74,0.65)] sm:w-auto"
              >
                Launch it
                <ArrowRight
                  size={14}
                  weight="bold"
                  className="transition-transform group-hover/btn:translate-x-0.5"
                />
              </button>
            </form>

            <div className="flex items-center gap-4 text-body-xs text-text-muted">
              <span className="flex items-center gap-1.5">
                <CheckCircle size={13} weight="fill" className="text-accent-500" />
                No credit card
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle size={13} weight="fill" className="text-accent-500" />
                Real-time cost tracking
              </span>
              <span className="hidden items-center gap-1.5 sm:flex">
                <CheckCircle size={13} weight="fill" className="text-accent-500" />
                Open source
              </span>
            </div>
          </motion.div>
        </div>

        {/* RIGHT: live pipeline panel */}
        <motion.div
          className="lg:col-span-6"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          <LiveRunPanel reducedMotion={shouldReduceMotion ?? false} />
        </motion.div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-component: LiveRunPanel — the hero's unique, memorable moment.
// A dark "terminal card" that cycles through pipeline stages, with a
// mono caption, pulsing aurora on the active stage, and an accent
// scan-line sweep. Loops forever (or static if reduced-motion).
// ─────────────────────────────────────────────────────────────────────

function LiveRunPanel({ reducedMotion }: { reducedMotion: boolean }) {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      setActiveIdx(PIPELINE_STAGES.length - 1);
      return;
    }
    const interval = setInterval(() => {
      setActiveIdx((i) => (i + 1) % PIPELINE_STAGES.length);
    }, 1900);
    return () => clearInterval(interval);
  }, [reducedMotion]);

  return (
    <div className="relative">
      {/* Card with blueprint annotations floating around it */}
      <div className="relative rounded-2xl border border-surface-800 bg-gradient-to-b from-surface-900/90 to-surface-950/95 p-5 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        {/* card chrome — window controls + status */}
        <div className="flex items-center justify-between border-b border-surface-800 pb-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-surface-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-surface-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-surface-700" />
          </div>
          <div className="flex items-center gap-2 font-mono text-mono-sm text-text-muted">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-success-500 opacity-75" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-success-500" />
            </span>
            <span>run.launchkit · live</span>
          </div>
          <span className="font-mono text-mono-sm text-text-muted">
            {String(activeIdx + 1).padStart(2, '0')}/{String(PIPELINE_STAGES.length).padStart(2, '0')}
          </span>
        </div>

        {/* Stages */}
        <div className="mt-4 space-y-1.5">
          {PIPELINE_STAGES.map((stage, i) => {
            const isActive = i === activeIdx;
            const isDone = i < activeIdx;
            const Icon = stage.icon;
            return (
              <motion.div
                key={stage.label}
                layout
                className={`relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  isActive
                    ? 'border-success-500/40 bg-success-500/[0.06]'
                    : isDone
                    ? 'border-surface-800 bg-surface-900/40'
                    : 'border-surface-800/60 bg-transparent'
                }`}
              >
                {/* Aurora halo for active */}
                {isActive && !reducedMotion && (
                  <motion.span
                    layoutId="activeGlow"
                    className="pointer-events-none absolute inset-0 rounded-lg"
                    style={{
                      boxShadow:
                        '0 0 0 1px rgba(255,94,74,0.22), 0 20px 50px -20px rgba(255,94,74,0.45)',
                    }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}

                {/* Icon */}
                <div
                  className={`relative flex h-8 w-8 flex-none items-center justify-center rounded-md border ${
                    isActive
                      ? 'border-success-500/50 bg-success-500/10 text-success-400'
                      : isDone
                      ? 'border-surface-800 bg-surface-900 text-success-500'
                      : 'border-surface-800 bg-surface-950 text-text-muted'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle size={16} weight="fill" />
                  ) : (
                    <Icon size={16} weight={isActive ? 'fill' : 'regular'} />
                  )}
                  {isActive && !reducedMotion && (
                    <span className="absolute inset-0 rounded-md border border-success-500/40 animate-aurora-outer" />
                  )}
                </div>

                {/* Label + detail */}
                <div className="min-w-0 flex-1">
                  <div
                    className={`font-mono text-[10px] font-semibold tracking-[0.14em] ${
                      isActive
                        ? 'text-success-400'
                        : isDone
                        ? 'text-text-tertiary'
                        : 'text-text-muted'
                    }`}
                  >
                    {stage.label}
                  </div>
                  <div
                    className={`mt-0.5 truncate font-mono text-mono-sm ${
                      isActive ? 'text-text-primary' : 'text-text-muted'
                    }`}
                  >
                    {stage.detail}
                    {isActive && !reducedMotion && (
                      <span className="ml-0.5 inline-block h-3 w-[1px] translate-y-0.5 bg-success-400 animate-cursor-blink" />
                    )}
                  </div>
                </div>

                {/* progress spinner on active */}
                {isActive && !reducedMotion && (
                  <div className="relative h-4 w-4 flex-none">
                    <span className="absolute inset-0 rounded-full border border-surface-800" />
                    <span className="absolute inset-0 rounded-full border border-success-500 border-r-transparent animate-[spin_1s_linear_infinite]" />
                  </div>
                )}
                {isDone && (
                  <CheckCircle size={14} weight="fill" className="flex-none text-success-500" />
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Scan line overlay on the active stage */}
        {!reducedMotion && (
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
            aria-hidden="true"
          >
            <div
              className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-success-500/50 to-transparent animate-scan-line"
              style={{ top: '0%' }}
            />
          </div>
        )}

        {/* Footer meta — feels like a status bar */}
        <div className="mt-5 flex items-center justify-between border-t border-surface-800 pt-4 font-mono text-[10px] tracking-[0.14em] text-text-muted">
          <span>RENDER.WORKFLOWS · 5 CHILD TASKS</span>
          <span className="text-success-400">$1.54 SPENT</span>
        </div>
      </div>

    </div>
  );
}
