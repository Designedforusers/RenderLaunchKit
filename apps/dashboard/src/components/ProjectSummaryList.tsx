import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, LinkSimple } from '@phosphor-icons/react';
import type { ProjectSummary } from '../lib/api.js';
import { LaunchStatusBadge } from './LaunchStatusBadge.js';

interface ProjectSummaryListProps {
  projects: ProjectSummary[];
  loading: boolean;
}

// `motion.create(Link)` (added in framer-motion v11) wraps a foreign
// component so it accepts the full motion props surface. We use this
// instead of `motion.div` + child `<Link>` so the navigation hit area
// and the animated container are the same element — keeps the markup
// flat and the hover lift indistinguishable from a real card click.
const MotionLink = motion.create(Link);

export function ProjectSummaryList({
  projects,
  loading,
}: ProjectSummaryListProps) {
  if (loading) {
    return <ProjectListSkeleton />;
  }

  if (projects.length === 0) {
    return <ProjectListEmptyState />;
  }

  return (
    // Plain CSS grid wrapper — no motion on the grid container
    // itself. Explicit `grid-cols-1 md:grid-cols-2` guarantees
    // the two-column layout at every breakpoint from 768 px up.
    // Cards get their entrance animation via their own explicit
    // `initial`/`animate` props with an index-based stagger
    // delay, not via parent → child variants inheritance. The
    // simpler pattern avoids the framer-motion variants +
    // `layout` prop interaction that was silently suppressing
    // the entrance tween on initial mount.
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <AnimatePresence mode="popLayout">
        {projects.map((project, index) => (
          <MotionLink
            key={project.id}
            to={`/projects/${project.id}`}
            className="card-hover group block relative"
            // ── "Liquid emergence" entrance ──
            //
            // Three layered effects on a single spring, ~80 ms
            // stagger between cards:
            //
            //   1. Blur release — blur(8px) → blur(0). Cards
            //      come "into focus" rather than "into existence."
            //      The Rauno / Arc / Framer pattern.
            //   2. Scale bloom — 0.92 → 1. Subtle gain of
            //      presence, no bounce overshoot (damping 26).
            //   3. Opacity fade — 0 → 1 timed to the scale.
            //
            // Plus a one-shot accent-glow pulse via CSS
            // animation (see the `animate-card-glow` span below)
            // that fires ~400 ms after landing and fades over
            // 600 ms. One glow per card, never repeats.
            initial={{ opacity: 0, scale: 0.92, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{
              type: 'spring',
              stiffness: 200,
              damping: 26,
              mass: 1,
              delay: 0.15 + index * 0.08,
            }}
            exit={{
              opacity: 0,
              scale: 0.96,
              filter: 'blur(4px)',
              transition: { duration: 0.18 },
            }}
            whileHover={{
              y: -3,
              scale: 1.01,
              transition: { type: 'spring', stiffness: 400, damping: 24 },
            }}
            whileTap={{ scale: 0.995 }}
          >
            {/* One-shot accent glow that pulses as each card
                settles. Fires once via CSS `animation-fill-mode:
                forwards` and never replays — the glow fades to
                0 and the span becomes inert. The delay is
                staggered per card so the glow cascade follows
                the entrance cascade. */}
            <span
              className="pointer-events-none absolute inset-0 rounded-xl opacity-0 animate-card-glow"
              style={{
                boxShadow: '0 0 20px 2px var(--color-accent-500)',
                animationDelay: `${String(0.55 + index * 0.08)}s`,
              }}
            />
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-display text-heading-lg text-text-primary group-hover:text-accent-400 transition-colors">
                  {project.repoOwner}/{project.repoName}
                </h3>
                <p className="text-text-muted text-body-sm mt-1">
                  {new Date(project.createdAt).toLocaleDateString()}
                </p>
              </div>
              <LaunchStatusBadge status={project.status} />
            </div>

            <div className="flex items-center gap-4 mt-4">
              <div className="flex items-center gap-1.5 text-body-sm text-text-tertiary">
                <FileText weight="regular" size={16} />
                {project.completedAssets}/{project.assetCount} assets
              </div>

              {project.reviewScore && (
                <div className="flex items-center gap-1.5 text-body-sm">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      project.reviewScore >= 7
                        ? 'bg-accent-500'
                        : project.reviewScore >= 5
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    }`}
                  />
                  <span className="font-mono text-mono-sm text-text-secondary">
                    {project.reviewScore.toFixed(1)}
                  </span>
                </div>
              )}

              {project.webhookEnabled && (
                <div className="flex items-center gap-1.5 text-body-sm text-text-muted">
                  <LinkSimple weight="regular" size={14} />
                  webhook
                </div>
              )}
            </div>

            {/* Progress bar for in-progress projects — animated via
                framer-motion so the fill grows smoothly when the
                status flips, instead of the previous CSS-only
                transition that snapped between widths. */}
            {!['complete', 'failed', 'pending'].includes(project.status) && (
              <div className="mt-4">
                <div className="relative h-1 bg-surface-800 rounded-full overflow-hidden">
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-accent-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${getProgressPercent(project.status).toString()}%` }}
                    transition={{
                      type: 'spring',
                      stiffness: 80,
                      damping: 20,
                    }}
                  />
                  {/* Shimmer running across the filled segment so the
                      progress feels actively in-flight instead of
                      stuck. */}
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                  </div>
                </div>
              </div>
            )}
          </MotionLink>
        ))}
      </AnimatePresence>
    </div>
  );
}

function ProjectListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: 'spring',
            stiffness: 260,
            damping: 28,
            delay: i * 0.06,
          }}
          className="relative overflow-hidden rounded-xl border border-surface-800 bg-surface-900/60 p-6"
        >
          {/* Shimmer sweep across the entire card body */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-accent-500/5 to-transparent" />
          </div>
          <div className="relative">
            <div className="flex items-start justify-between mb-4">
              <div className="space-y-2">
                <div className="h-4 w-44 animate-pulse rounded-full bg-surface-800" />
                <div className="h-3 w-24 animate-pulse rounded-full bg-surface-800/70" />
              </div>
              <div className="h-5 w-16 animate-pulse rounded-full bg-surface-800/70" />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <div className="h-3 w-20 animate-pulse rounded-full bg-surface-800/80" />
              <div className="h-3 w-10 animate-pulse rounded-full bg-surface-800/60" />
            </div>
            <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-surface-800">
              <div className="h-full w-1/3 animate-shimmer-sweep rounded-full bg-accent-500/40" />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function ProjectListEmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-2xl border border-dashed border-surface-800 bg-surface-900/30 py-16 text-center"
    >
      {/* Soft animated grid backdrop so the empty card has presence
          instead of looking like a missing component. */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(148,163,184,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.4) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      <div className="relative">
        {/* Breathing concentric ring icon */}
        <motion.div
          className="mx-auto mb-6 relative h-16 w-16"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            delay: 0.1,
            type: 'spring',
            stiffness: 240,
            damping: 18,
          }}
        >
          <span className="absolute inset-0 rounded-full border border-accent-500/30 animate-breathe" />
          <span className="absolute inset-2 rounded-full border border-accent-500/40 animate-breathe [animation-delay:0.4s]" />
          <span className="absolute inset-4 rounded-full bg-accent-500/20" />
          <span className="absolute inset-[26px] rounded-full bg-accent-400" />
        </motion.div>

        <motion.p
          className="font-display text-display-md text-text-primary"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          No projects yet
        </motion.p>
        <motion.p
          className="text-body-md text-text-muted mt-2"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
        >
          Paste a GitHub repo URL above to launch your first kit
        </motion.p>
      </div>
    </motion.div>
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
  return map[status] ?? 0;
}
