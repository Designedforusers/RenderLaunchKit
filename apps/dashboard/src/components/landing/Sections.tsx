import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RocketLaunch,
  GithubLogo,
  ArrowRight,
  Plus,
  CurrencyDollarSimple,
  Clock,
  Stack,
  ShareNetwork,
} from '@phosphor-icons/react';

import { DIFFERENTIATORS, STACK_LOGOS, FAQ_ITEMS } from './data.js';

// ─────────────────────────────────────────────────────────────────────
// Section: Differentiators — 3 column "why it's different from ChatGPT"
// ─────────────────────────────────────────────────────────────────────

export function Differentiators() {
  return (
    <section id="why" className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <div className="flex items-center justify-center gap-2 text-label text-text-muted">
          <span className="h-px w-6 bg-accent-500" />
          WHY IT&rsquo;S DIFFERENT
          <span className="h-px w-6 bg-accent-500" />
        </div>
        <h2 className="mt-4 font-display text-display-lg leading-[1.02] tracking-[-0.02em] text-text-primary">
          Not a ChatGPT wrapper.
          <br />
          An actual engineering pipeline.
        </h2>
      </div>

      <div className="mt-16 grid gap-4 md:grid-cols-3">
        {DIFFERENTIATORS.map((d, i) => {
          const Icon = d.icon;
          return (
            <motion.div
              key={d.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{
                duration: 0.6,
                delay: i * 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="group relative overflow-hidden rounded-2xl border border-surface-800 bg-gradient-to-b from-surface-900/70 to-surface-950/90 p-8 backdrop-blur-sm transition-all hover:border-surface-700"
            >
              <div className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400">
                <Icon size={20} weight="fill" />
                <span className="absolute inset-0 rounded-lg border border-accent-500/30" />
              </div>
              <h3 className="mt-6 text-heading-xl text-text-primary">
                {d.title}
              </h3>
              <p className="mt-3 text-body-md text-text-secondary">{d.body}</p>
              {/* faint grain corner */}
              <div className="absolute right-6 top-6 font-mono text-[9px] tracking-[0.2em] text-text-muted">
                0{i + 1}
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Stats — big display numbers on a blueprint panel
// ─────────────────────────────────────────────────────────────────────

export function StatsSection() {
  const stats = [
    { value: '$1.54',  label: 'MEDIAN KIT COST',     icon: CurrencyDollarSimple },
    { value: '6m 42s', label: 'MEDIAN KIT TIME',     icon: Clock },
    { value: '17',     label: 'ASSETS PER KIT',      icon: Stack },
    { value: '5',      label: 'PARALLEL CHILD TASKS', icon: ShareNetwork },
  ] as const;

  return (
    <section className="relative z-10 mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-20">
      <div
        className="relative overflow-hidden rounded-3xl border border-surface-800 bg-gradient-to-br from-surface-900/80 via-surface-950/90 to-surface-900/80 p-12 backdrop-blur-sm"
      >
        {/* blueprint lines */}
        <div
          className="absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(139,123,168,0.4) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(139,123,168,0.4) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
          }}
        />
        <div
          className="absolute -left-20 top-1/2 h-[500px] w-[500px] -translate-y-1/2 rounded-full bg-accent-500/[0.08] blur-[160px]"
        />

        <div className="relative grid grid-cols-2 gap-8 md:grid-cols-4 md:gap-10">
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.6,
                  delay: i * 0.08,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="relative"
              >
                <div className="flex items-start justify-between">
                  <div className="font-display text-[clamp(2.4rem,5vw,3.5rem)] leading-none tracking-[-0.03em] text-text-primary">
                    {s.value}
                  </div>
                  <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-accent-500/25 bg-accent-500/[0.06] text-accent-400">
                    <Icon size={16} weight="fill" />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-text-muted">
                  <span className="h-px w-4 bg-accent-500" />
                  {s.label}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Tech stack strip
// ─────────────────────────────────────────────────────────────────────

export function TechStackStrip() {
  return (
    <section className="relative z-10 mx-auto max-w-7xl px-4 py-14 sm:px-6 md:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 text-label text-text-muted">
          <span className="h-px w-6 bg-accent-500/40" />
          POWERED BY A REAL STACK
          <span className="h-px w-6 bg-accent-500/40" />
        </div>
        <h2 className="mt-4 font-display text-display-md leading-[1.08] tracking-[-0.02em] text-text-primary">
          No toy APIs. The actual providers we call.
        </h2>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-surface-800 bg-surface-800/60 md:grid-cols-4 lg:grid-cols-8"
      >
        {STACK_LOGOS.map((logo) => (
          <div
            key={logo.name}
            className="group relative flex h-28 flex-col items-center justify-center gap-3 bg-surface-950/90 px-4 py-5 backdrop-blur-sm transition-all hover:bg-surface-900"
          >
            {/* hover glow */}
            <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <span
                className="absolute inset-0"
                style={{
                  background:
                    'radial-gradient(circle at 50% 40%, rgba(255,94,74,0.14), transparent 70%)',
                }}
              />
              <span className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-accent-500/60 to-transparent" />
            </span>

            <img
              src={logo.src}
              alt={`${logo.name} logo`}
              width={logo.width}
              height={logo.height}
              loading="lazy"
              decoding="async"
              className={`relative h-7 w-auto max-w-[120px] object-contain transition-all duration-300 group-hover:scale-110 ${
                logo.mono
                  ? 'opacity-70 brightness-0 invert group-hover:opacity-100'
                  : 'opacity-80 group-hover:opacity-100'
              }`}
            />
            <div className="relative text-center">
              <div className="font-mono text-[10px] font-semibold tracking-[0.14em] text-text-primary">
                {logo.name}
              </div>
              <div className="font-mono text-[9px] tracking-[0.14em] text-text-muted">
                {logo.sub}
              </div>
            </div>
          </div>
        ))}
      </motion.div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: FAQ — accordion
// ─────────────────────────────────────────────────────────────────────

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="relative z-10 mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-28">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 text-label text-text-muted">
          <span className="h-px w-6 bg-accent-500" />
          QUESTIONS
          <span className="h-px w-6 bg-accent-500" />
        </div>
        <h2 className="mt-4 font-display text-display-lg leading-[1.02] tracking-[-0.02em] text-text-primary">
          Objections, pre-answered.
        </h2>
      </div>

      <div className="mt-14 divide-y divide-surface-800 border-y border-surface-800">
        {FAQ_ITEMS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-6 py-6 text-left transition-colors hover:text-text-primary"
              >
                <span className="flex items-center gap-4">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-accent-400">
                    0{i + 1}
                  </span>
                  <span className="text-heading-lg text-text-primary">
                    {item.q}
                  </span>
                </span>
                <motion.span
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="flex-none text-text-tertiary"
                >
                  <Plus size={18} weight="bold" />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="pb-8 pl-10 pr-14 text-body-md text-text-secondary">
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Final CTA + oversized wordmark + footer
// ─────────────────────────────────────────────────────────────────────

export function FinalCTA() {
  return (
    <section className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-32">
      <div className="relative overflow-hidden rounded-2xl border border-surface-800 bg-gradient-to-br from-surface-900/90 via-surface-950 to-surface-900/80 p-8 text-center backdrop-blur-sm sm:rounded-3xl md:p-16">
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(255,94,74,0.4) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,94,74,0.4) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }}
        />
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500/[0.12] blur-[180px]" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent-500/30 bg-accent-500/5 px-3 py-1 font-mono text-[10px] tracking-[0.16em] text-accent-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent-500 opacity-60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-accent-500" />
            </span>
            READY WHEN YOU ARE
          </div>
          <h2 className="mt-6 font-display text-[clamp(1.8rem,7vw,5.5rem)] leading-[0.98] tracking-[-0.03em] text-text-primary">
            Ship the repo.
            <br />
            <span className="text-accent-400">Skip the scramble.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-body-lg text-text-secondary">
            Every launch is the same ritual: screenshots, blog post, tweet
            thread, hero image, voiceover. Paste a URL. Let the agents handle
            the ritual.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4 md:mt-10">
            <Link
              to="/app"
              className="group flex items-center gap-2 rounded-xl bg-accent-500 px-6 py-3.5 text-body-md font-semibold text-white shadow-[0_0_0_1px_rgba(255,94,74,0.45),0_20px_50px_-10px_rgba(255,94,74,0.55)] transition-all hover:bg-accent-400 hover:shadow-[0_0_0_1px_rgba(255,94,74,0.55),0_24px_60px_-10px_rgba(255,94,74,0.7)]"
            >
              Launch your first repo
              <ArrowRight
                size={16}
                weight="bold"
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <a
              href="https://github.com/Designedforusers/RenderLaunchKit"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-2 rounded-xl border border-surface-700 bg-surface-900/70 px-6 py-3.5 text-body-md font-semibold text-text-primary backdrop-blur-sm transition-all hover:border-surface-600 hover:bg-surface-900"
            >
              <GithubLogo size={16} weight="fill" />
              View source
            </a>
          </div>
        </div>
      </div>

      {/* Oversized wordmark — the GlossGenius move */}
      <div className="mt-24 select-none text-center">
        <motion.div
          initial={{ opacity: 0, letterSpacing: '-0.01em' }}
          whileInView={{ opacity: 1, letterSpacing: '-0.06em' }}
          viewport={{ once: true, margin: '-20%' }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
          className="font-display text-[clamp(5rem,18vw,14rem)] leading-none text-text-primary/[0.08]"
        >
          LAUNCHKIT
        </motion.div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-surface-800/70 bg-surface-950/60 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-accent-500">
            <RocketLaunch weight="fill" size={13} className="text-white" />
          </div>
          <span className="font-mono text-[11px] tracking-[0.18em] text-text-tertiary">
            LAUNCHKIT · © {new Date().getFullYear()}
          </span>
        </div>
        <div className="flex items-center gap-6 font-mono text-[11px] tracking-[0.16em] text-text-muted">
          <a href="#pipeline" className="transition-colors hover:text-text-primary">PIPELINE</a>
          <a href="#assets" className="transition-colors hover:text-text-primary">ASSETS</a>
          <a href="#faq" className="transition-colors hover:text-text-primary">FAQ</a>
          <a href="https://github.com/Designedforusers/RenderLaunchKit" target="_blank" rel="noreferrer" className="transition-colors hover:text-text-primary">
            GITHUB
          </a>
        </div>
      </div>
    </footer>
  );
}
