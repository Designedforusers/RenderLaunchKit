import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  AnimatePresence,
} from 'framer-motion';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  RocketLaunch,
  GithubLogo,
  ArrowRight,
  ArrowUpRight,
  Sparkle,
  Article,
  Image as PhImage,
  VideoCamera,
  MicrophoneStage,
  CubeFocus,
  CheckCircle,
  Lightning,
  MagnifyingGlass,
  Brain,
  CaretDown,
  Plus,
  Waveform,
  CurrencyDollarSimple,
  Clock,
  Stack,
  ShareNetwork,
} from '@phosphor-icons/react';

gsap.registerPlugin(ScrollTrigger);

// ─────────────────────────────────────────────────────────────────────
// Data — kept at module scope so every section reads from one source.
// ─────────────────────────────────────────────────────────────────────

type PipelineStage = {
  readonly icon: typeof GithubLogo;
  readonly label: string;
  readonly detail: string;
};

const PIPELINE_STAGES: readonly PipelineStage[] = [
  { icon: GithubLogo,      label: 'CLONING REPOSITORY',     detail: 'github.com/acme/orbit-cli' },
  { icon: MagnifyingGlass, label: 'ANALYZING CODEBASE',     detail: '1,284 files · TypeScript + Rust' },
  { icon: Brain,           label: 'RUNNING RESEARCH AGENT', detail: '14 searches · 3 competitors · 12 citations' },
  { icon: Sparkle,         label: 'BUILDING STRATEGY',      detail: 'Positioning · ICP · 17 asset briefs' },
  { icon: Lightning,       label: 'GENERATING IN PARALLEL', detail: 'text · image · video · audio · 3D' },
  { icon: CheckCircle,     label: 'KIT READY',              detail: '17 assets · $1.54 · 6m 42s' },
] as const;

type AssetKind = 'written' | 'image' | 'video' | 'audio' | 'scene';

type AssetCard = {
  readonly kind: AssetKind;
  readonly icon: typeof Article;
  readonly eyebrow: string;
  readonly title: string;
  readonly copy: string;
  readonly tint: string; // tailwind class suffix, e.g. 'emerald'
};

const CARD_WRITTEN: AssetCard = {
  kind: 'written',
  icon: Article,
  eyebrow: 'WRITTEN',
  title: 'Launch posts, cold emails, changelog notes',
  copy: 'Grounded in your README, not hallucinated. Every draft cites the file it read from.',
  tint: 'emerald',
};
const CARD_IMAGE: AssetCard = {
  kind: 'image',
  icon: PhImage,
  eyebrow: 'IMAGE',
  title: 'On-brand hero art, OG cards, social thumbnails',
  copy: 'fal.ai diffusion, tuned per project. Four variations per brief — pick or regenerate in one click.',
  tint: 'sky',
};
const CARD_VIDEO: AssetCard = {
  kind: 'video',
  icon: VideoCamera,
  eyebrow: 'VIDEO',
  title: 'Vertical launch reels, product teasers',
  copy: 'Remotion compositions with timed captions, BGM and the voiceover your brand already has.',
  tint: 'rose',
};
const CARD_AUDIO: AssetCard = {
  kind: 'audio',
  icon: MicrophoneStage,
  eyebrow: 'VOICE',
  title: 'Narration, podcast intros, ad reads',
  copy: 'ElevenLabs voices, cached per-project, drift-free across every asset in the kit.',
  tint: 'amber',
};
const CARD_SCENE: AssetCard = {
  kind: 'scene',
  icon: CubeFocus,
  eyebrow: '3D SCENE',
  title: 'World Labs environments for product walkthroughs',
  copy: 'Walk the user through your product inside a generated spatial scene — GLB exports included.',
  tint: 'violet',
};

type ScrollStage = {
  readonly index: string;
  readonly title: string;
  readonly body: string;
  readonly mono: string;
};

const SCROLL_STAGES: readonly ScrollStage[] = [
  {
    index: '01',
    title: 'Reads your repo like a human',
    body: 'An Agent SDK worker clones the repo, walks the tree, and actually reads README.md, package.json, docs, and the top-level source files. No RAG guessing.',
    mono: 'analyze-project-repository.ts',
  },
  {
    index: '02',
    title: 'Researches the market around it',
    body: 'A second agent runs Claude native web search, Exa deep search, pulls competitor positioning, and writes a structured brief with real citations you can audit.',
    mono: 'launch-research-agent.ts',
  },
  {
    index: '03',
    title: 'Strategizes — then fans out',
    body: 'The strategist writes 17 asset briefs, then Render Workflows spins up five compute-bucketed child tasks so a 20-second blog post never waits for a 10-minute video render.',
    mono: 'build-project-launch-strategy.ts',
  },
  {
    index: '04',
    title: 'Reviews its own output, then learns',
    body: 'A creative director agent scores every asset, auto-approves or re-queues. Your edits get embedded and clustered — next run, the prompts already know your taste.',
    mono: 'creative-director-agent.ts',
  },
] as const;

type FaqItem = {
  readonly q: string;
  readonly a: string;
};

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: 'Is this just a ChatGPT wrapper?',
    a: 'No. LaunchKit is a multi-agent pipeline running on Render Workflows with five compute-profiled child tasks, a pgvector feedback loop, and real provider calls to fal.ai, ElevenLabs and World Labs alongside Claude. Every generation records real cost.',
  },
  {
    q: 'What does a full kit actually cost?',
    a: 'A full kit — 17 assets across text, image, video and audio — typically runs $1–6 in provider cost depending on which models and asset types you enable. The dashboard shows the real cost on every project card. No subscription, no markup.',
  },
  {
    q: 'Can I regenerate a single asset without re-running everything?',
    a: 'Yes. Every asset row has its own status machine. Click Regenerate on a single card and only that one goes back through the pipeline — the rest of the kit stays intact.',
  },
  {
    q: 'Does LaunchKit learn from my edits?',
    a: 'Your approve / reject / edit actions write to asset_feedback_events, get embedded with Voyage, and cluster via pgvector. The next kit you generate sees those edit patterns as context — the model actually learns your voice.',
  },
  {
    q: 'How does it handle long runs without timeouts?',
    a: 'Render Workflows. The parent task fans out to six child tasks via run chaining, each sized to the work: starter dynos for text, pro dynos for video renders and 3D. A 10-minute Remotion render never blocks a 20-second blog post.',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────
// Section: Blueprint backdrop — subtle grid + vignette behind the page
// ─────────────────────────────────────────────────────────────────────

function BlueprintBackdrop() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    >
      {/* Faint grid — a blueprint/schematic texture. 1px lines at very low
          opacity. Repeats forever at 56px, fades at the edges via mask. */}
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(139,123,168,0.08) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(139,123,168,0.08) 1px, transparent 1px)
          `,
          backgroundSize: '56px 56px',
          maskImage:
            'radial-gradient(ellipse at 50% 20%, black 40%, transparent 85%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at 50% 20%, black 40%, transparent 85%)',
        }}
      />
      {/* Accent halo — a very soft emerald glow behind the hero */}
      <div className="absolute left-1/2 top-[-240px] h-[720px] w-[1100px] -translate-x-1/2 rounded-full bg-accent-500/[0.08] blur-[160px]" />
      {/* Grain — a 1px noise overlay for that "printed" feel */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Sticky nav
// ─────────────────────────────────────────────────────────────────────

function Nav() {
  const { scrollY } = useScroll();
  const bgOpacity = useTransform(scrollY, [0, 80], [0, 0.85]);
  const borderOpacity = useTransform(scrollY, [0, 80], [0, 1]);

  return (
    <motion.nav
      className="sticky top-0 z-50 w-full backdrop-blur-xl"
      style={{
        backgroundColor: useTransform(
          bgOpacity,
          (o) => `rgba(2,6,23,${o.toFixed(3)})`
        ),
        borderBottom: useTransform(
          borderOpacity,
          (o) => `1px solid rgba(30,41,59,${o.toFixed(3)})`
        ),
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/" className="group flex items-center gap-3">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500">
            <RocketLaunch weight="fill" size={18} className="text-white" />
            <span className="absolute inset-0 -z-10 rounded-lg bg-accent-500/40 blur-md" />
          </div>
          <span className="font-display text-heading-lg text-text-primary">
            LaunchKit
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <a href="#pipeline" className="text-body-sm text-text-tertiary transition-colors hover:text-text-primary">
            Pipeline
          </a>
          <a href="#assets" className="text-body-sm text-text-tertiary transition-colors hover:text-text-primary">
            Assets
          </a>
          <a href="#why" className="text-body-sm text-text-tertiary transition-colors hover:text-text-primary">
            Why it works
          </a>
          <a href="#faq" className="text-body-sm text-text-tertiary transition-colors hover:text-text-primary">
            FAQ
          </a>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/Designedforusers/RenderLaunchKit"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-lg border border-surface-800 bg-surface-900/70 px-3 py-1.5 text-body-xs text-text-tertiary transition-colors hover:border-surface-700 hover:text-text-primary md:flex"
          >
            <GithubLogo size={14} weight="fill" />
            <span>Star on GitHub</span>
          </a>
          <Link
            to="/app"
            className="hidden items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-1.5 text-body-xs font-semibold text-white shadow-sm transition-all hover:bg-accent-400 md:flex"
          >
            <Lightning size={14} weight="fill" />
            <span>Generate</span>
          </Link>
        </div>
      </div>
    </motion.nav>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Hero — serif display left, live pipeline run right
// ─────────────────────────────────────────────────────────────────────

function Hero() {
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

// ─────────────────────────────────────────────────────────────────────
// Section: Asset marquee — infinite scroll of asset-type chips.
// The "what comes out" answer, before you scroll to the proof.
// ─────────────────────────────────────────────────────────────────────

function AssetMarquee() {
  const marqueeItems = [
    'Launch blog post',
    'Twitter/X thread',
    'Cold email sequence',
    'Hero image',
    'Open Graph cards',
    '30s vertical reel',
    'Voiceover narration',
    'Landing page copy',
    'Product Hunt launch',
    'Changelog post',
    '3D walkthrough',
    'Podcast intro',
    'HN Show HN post',
    'LinkedIn carousel',
    'Press release',
    'Feature announcement',
  ];

  // Two copies back-to-back so the CSS animation scrolls seamlessly.
  return (
    <section className="relative z-10 border-y border-surface-800/70 bg-surface-950/60 py-8 backdrop-blur-sm">
      <div
        className="relative flex overflow-hidden"
        style={{
          maskImage:
            'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
        }}
      >
        <div className="flex shrink-0 animate-[marquee_48s_linear_infinite] gap-6 pr-6">
          {marqueeItems.map((item, i) => (
            <MarqueeChip key={`a-${i}`} label={item} />
          ))}
        </div>
        <div className="flex shrink-0 animate-[marquee_48s_linear_infinite] gap-6 pr-6" aria-hidden="true">
          {marqueeItems.map((item, i) => (
            <MarqueeChip key={`b-${i}`} label={item} />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-100%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[marquee_48s_linear_infinite\\] { animation: none !important; }
        }
      `}</style>
    </section>
  );
}

function MarqueeChip({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-surface-800 bg-surface-900/60 px-4 py-2">
      <Plus size={12} weight="bold" className="text-accent-500" />
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Scrollytelling pipeline. GSAP ScrollTrigger pins a stage and
// the left copy column swaps between SCROLL_STAGES as the user scrolls.
// ─────────────────────────────────────────────────────────────────────

function PipelineScene() {
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
// all on a 240×120 viewBox so they line up across the 2×2 grid.
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

/** 04 · Reviewer — a 270° quality arc with a sweeping progress */
function Agent04Reviewer({ isActive, isDone }: VisualProps) {
  const activeColor = isActive ? 'rgb(var(--success-400))' : 'rgb(var(--surface-400))';
  const dimColor = 'rgb(var(--surface-300))';
  const mutedColor = 'rgb(var(--surface-400) / 0.85)';

  // 270° arc, from 135° (bottom-left) CCW to 405° (bottom-right)
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

/** Dispatch to the right agent visual by index. */
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
        {/* Path from 01 → 02 → 03 → 04 — a zigzag polyline */}
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


// Section: Bento assets — the 5 asset types with per-kind mini previews.
// ─────────────────────────────────────────────────────────────────────

function BentoAssets() {
  return (
    <section id="assets" className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <div className="flex items-center justify-center gap-2 text-label text-text-muted">
          <span className="h-px w-6 bg-accent-500" />
          WHAT COMES OUT
          <span className="h-px w-6 bg-accent-500" />
        </div>
        <h2 className="mt-4 font-display text-display-lg leading-[1.02] tracking-[-0.02em] text-text-primary">
          Every format you need for launch day.
        </h2>
        <p className="mt-4 text-body-lg text-text-secondary">
          Five generators, one kit. Each asset is reviewed by a creative-director
          agent before it lands on your dashboard — and you can regenerate any
          single one without re-running the whole pipeline.
        </p>
      </div>

      <div className="mt-16 grid gap-4 md:grid-cols-6 md:grid-rows-2">
        <BentoCard card={CARD_WRITTEN} className="md:col-span-3 md:row-span-1">
          <WrittenPreview />
        </BentoCard>
        <BentoCard card={CARD_IMAGE} className="md:col-span-3 md:row-span-1">
          <ImagePreview />
        </BentoCard>
        <BentoCard card={CARD_VIDEO} className="md:col-span-2 md:row-span-1">
          <VideoPreview />
        </BentoCard>
        <BentoCard card={CARD_AUDIO} className="md:col-span-2 md:row-span-1">
          <AudioPreview />
        </BentoCard>
        <BentoCard card={CARD_SCENE} className="md:col-span-2 md:row-span-1">
          <ScenePreview />
        </BentoCard>
      </div>
    </section>
  );
}

function BentoCard({
  card,
  children,
  className = '',
}: {
  card: AssetCard;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = card.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -4 }}
      className={`group relative overflow-hidden rounded-2xl border border-surface-800 bg-gradient-to-b from-surface-900/90 to-surface-950/80 p-6 backdrop-blur-sm transition-all hover:border-surface-700 hover:shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] ${className}`}
    >
      {/* hover-only accent border */}
      <span
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          boxShadow:
            '0 0 0 1px rgba(255,94,74,0.25), 0 30px 70px -20px rgba(255,94,74,0.25)',
        }}
      />
      <div className="relative flex h-full flex-col">
        {/* Preview area (top) */}
        <div className="mb-5 min-h-[132px] flex-1">{children}</div>

        {/* Meta (bottom) */}
        <div className="space-y-2 border-t border-surface-800/80 pt-5">
          <div className="flex items-center gap-2">
            <Icon size={14} weight="fill" className="text-accent-500" />
            <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-accent-400">
              {card.eyebrow}
            </span>
          </div>
          <h3 className="text-heading-md text-text-primary">{card.title}</h3>
          <p className="text-body-sm text-text-secondary">{card.copy}</p>
        </div>

        <ArrowUpRight
          size={16}
          weight="bold"
          className="absolute right-0 top-0 text-text-muted transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-400"
        />
      </div>
    </motion.div>
  );
}

function WrittenPreview() {
  return (
    <div className="relative h-full rounded-lg border border-surface-800 bg-surface-950/70 p-4 font-mono text-[11px] leading-relaxed text-text-secondary">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-surface-700" />
        <span className="h-1.5 w-1.5 rounded-full bg-surface-700" />
        <span className="h-1.5 w-1.5 rounded-full bg-surface-700" />
        <span className="ml-2 text-[9px] uppercase tracking-[0.14em] text-text-muted">
          launch-post.md
        </span>
      </div>
      <p className="text-text-primary"># Orbit CLI 1.0 — ship to anywhere in one command</p>
      <p className="mt-2 text-text-tertiary">
        We built Orbit because every modern project ends up with the same
        ritual: seven configs, three CI files, two secrets&nbsp;files…
      </p>
      <p className="mt-2 text-text-muted">
        <span className="text-success-400">[cited]</span> README.md:14 ·
        package.json:22
      </p>
      <div className="absolute inset-x-4 bottom-3 h-6 bg-gradient-to-t from-surface-950 to-transparent" />
    </div>
  );
}

function ImagePreview() {
  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-surface-800 bg-surface-950/70">
      {/* Abstract gradient "generated hero" */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgba(255,94,74,0.55), transparent 50%), radial-gradient(circle at 70% 70%, rgba(255,183,77,0.45), transparent 55%), linear-gradient(135deg, #120818, #1a1028)',
        }}
      />
      {/* faux frame grid */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      {/* corner label */}
      <div className="absolute left-3 top-3 rounded border border-white/10 bg-surface-950/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/70 backdrop-blur-sm">
        1200 × 630 · og.png
      </div>
      {/* variation chips */}
      <div className="absolute bottom-3 left-3 flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-5 rounded-full ${
              i === 0 ? 'bg-accent-400' : 'bg-white/20'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function VideoPreview() {
  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-surface-800 bg-surface-950/70">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 60% 40%, rgba(255,94,74,0.35), transparent 60%), linear-gradient(180deg, #10081a, #08040f)',
        }}
      />
      {/* play button */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
          <span
            className="ml-0.5 block h-0 w-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-surface-950"
            aria-hidden="true"
          />
          <span className="absolute -inset-2 rounded-full border border-white/30" />
        </div>
      </div>
      {/* scrubber */}
      <div className="absolute inset-x-3 bottom-3">
        <div className="relative h-1 overflow-hidden rounded-full bg-white/10">
          <div className="absolute inset-y-0 left-0 w-[38%] bg-accent-400" />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[9px] text-text-muted">
          <span>00:11</span>
          <span>00:30 · vertical 9:16</span>
        </div>
      </div>
    </div>
  );
}

function AudioPreview() {
  // SVG waveform — static, deterministic. Taller in the middle, tapering out.
  const bars = useMemo(() => {
    return Array.from({ length: 48 }, (_, i) => {
      const t = (i - 24) / 24;
      const h = Math.round((1 - t * t) * 34 + 4 + (i % 3) * 3);
      return { i, h };
    });
  }, []);

  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-surface-800 bg-surface-950/70 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
          <Waveform size={12} weight="bold" className="text-accent-400" />
          voiceover · eleven
        </div>
        <span className="font-mono text-[10px] text-text-tertiary">00:42</span>
      </div>

      <div className="mt-4 flex h-16 items-center gap-[3px]">
        {bars.map(({ i, h }) => (
          <span
            key={i}
            className={`block w-[3px] rounded-sm ${
              i < 18 ? 'bg-accent-400' : 'bg-text-muted/40'
            }`}
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between font-mono text-[9px] text-text-muted">
        <span>cache hit · $0.00</span>
        <span>44.1khz · mp3</span>
      </div>
    </div>
  );
}

function ScenePreview() {
  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-surface-800 bg-surface-950/70">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 80%, rgba(255,94,74,0.35), transparent 60%), linear-gradient(180deg, #0e0818, #08040f)',
        }}
      />
      {/* wireframe isometric cube */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 200 160"
        aria-hidden="true"
      >
        <g
          fill="none"
          stroke="rgba(139,123,168,0.55)"
          strokeWidth={0.8}
          strokeLinecap="round"
        >
          {/* floor grid */}
          {[...Array<number>(8)].map((_, i) => (
            <line
              key={`fl-${i}`}
              x1={30 + i * 20}
              y1={100}
              x2={30 + i * 20 - 30}
              y2={150}
              stroke="rgba(139,123,168,0.2)"
            />
          ))}
          {[...Array<number>(5)].map((_, i) => (
            <line
              key={`fk-${i}`}
              x1={10}
              y1={100 + i * 12}
              x2={180}
              y2={100 + i * 12}
              stroke="rgba(139,123,168,0.2)"
            />
          ))}
          {/* cube — isometric */}
          <polygon points="100,40 140,60 140,100 100,80" fill="rgba(255,94,74,0.18)" />
          <polygon points="100,40 60,60 60,100 100,80" fill="rgba(255,94,74,0.1)" />
          <polygon points="60,60 100,40 140,60 100,80" fill="rgba(255,94,74,0.28)" />
          <polyline points="100,80 100,120 60,100" />
          <polyline points="100,120 140,100" />
        </g>
      </svg>
      <div className="absolute left-3 top-3 rounded border border-white/10 bg-surface-950/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/70 backdrop-blur-sm">
        scene.glb · world labs
      </div>
      <div className="absolute bottom-3 right-3 font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
        drag to orbit
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Differentiators — 3 column "why it's different from ChatGPT"
// ─────────────────────────────────────────────────────────────────────

const DIFFERENTIATORS = [
  {
    icon: Brain,
    title: 'Grounded in your repo — not hallucinated',
    body: 'Every agent reads the actual file system and cites it. No more "you mentioned a feature that doesn\'t exist" moments.',
  },
  {
    icon: Lightning,
    title: 'Parallel fanout, not sequential prompts',
    body: 'Render Workflows spins up five compute-profiled child tasks. A 10-minute video render never blocks a 20-second post.',
  },
  {
    icon: Sparkle,
    title: 'Learns your voice from your edits',
    body: 'Your edits get embedded, clustered by pgvector, and surfaced as context on the next run. The model gets more you, over time.',
  },
] as const;

function Differentiators() {
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

function StatsSection() {
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

type StackLogo = {
  readonly src: string;
  readonly name: string;
  readonly sub: string;
  /** Monochrome SVGs get the brightness-0/invert filter so the mark renders
   * white on dark. Raster (webp) logos keep their native brand colour. */
  readonly mono: boolean;
  /** Intrinsic dimensions so the browser reserves the correct CLS slot
   * on first paint before the asset resolves. Tailwind `h-7 w-auto` still
   * controls the visual size; these are purely the layout reservation. */
  readonly width: number;
  readonly height: number;
};

const STACK_LOGOS: readonly StackLogo[] = [
  { src: '/logos/render.svg',     name: 'RENDER',     sub: 'WORKFLOWS',  mono: true,  width: 120, height: 28 },
  { src: '/logos/claude.svg',     name: 'CLAUDE',     sub: 'AGENT SDK',  mono: true,  width: 120, height: 28 },
  { src: '/logos/fal.webp',       name: 'FAL.AI',     sub: 'DIFFUSION',  mono: false, width: 120, height: 28 },
  { src: '/logos/elevenlabs.svg', name: 'ELEVENLABS', sub: 'VOICE',      mono: true,  width: 120, height: 28 },
  { src: '/logos/worldlabs.svg',  name: 'WORLD LABS', sub: '3D SCENES',  mono: true,  width: 120, height: 28 },
  { src: '/logos/remotion.webp',  name: 'REMOTION',   sub: 'VIDEO',      mono: false, width: 120, height: 28 },
  { src: '/logos/exa.webp',       name: 'EXA',        sub: 'DEEP SEARCH',mono: false, width: 120, height: 28 },
  { src: '/logos/postgresql.svg', name: 'POSTGRES',   sub: 'PGVECTOR',   mono: true,  width: 120, height: 28 },
] as const;

function TechStackStrip() {
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

function FAQ() {
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

function FinalCTA() {
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

function Footer() {
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

// ─────────────────────────────────────────────────────────────────────
// Top-level export
// ─────────────────────────────────────────────────────────────────────

export function LandingPage() {
  return (
    <div className="relative min-h-screen bg-surface-950 text-text-primary">
      <BlueprintBackdrop />
      <Nav />
      <Hero />
      <AssetMarquee />
      <PipelineScene />
      <BentoAssets />
      <Differentiators />
      <StatsSection />
      <TechStackStrip />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
