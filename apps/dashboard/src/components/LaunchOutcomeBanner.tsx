import { motion, AnimatePresence } from 'framer-motion';

interface LaunchOutcomeBannerProps {
  status: string;
  reviewScore: number | null;
}

/**
 * One-shot celebration / failure banner that appears when the
 * pipeline has finished. The component renders nothing for any
 * status that isn't `complete` or `failed`, so the parent can mount
 * it unconditionally and let AnimatePresence handle the entry / exit.
 *
 * For successful runs we draw a "LAUNCH READY" pill, an animated
 * score reveal, and a confetti burst. For failed runs we draw a
 * matching red banner with a clear failure indicator. Both share the
 * same shape so the layout doesn't reflow when the status flips.
 */
export function LaunchOutcomeBanner({
  status,
  reviewScore,
}: LaunchOutcomeBannerProps) {
  const isComplete = status === 'complete';
  const isFailed = status === 'failed';

  return (
    <AnimatePresence mode="wait">
      {isComplete && (
        <CelebrationBanner key="complete" reviewScore={reviewScore} />
      )}
      {isFailed && <FailureBanner key="failed" />}
    </AnimatePresence>
  );
}

function CelebrationBanner({ reviewScore }: { reviewScore: number | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 240, damping: 22 }}
      className="relative overflow-hidden rounded-2xl border border-accent-500/40 bg-gradient-to-br from-accent-500/15 via-accent-500/5 to-transparent px-6 py-5 mb-6"
    >
      {/* Confetti particles. Each one travels along its own path
          using a CSS-variable seeded translate, with a small spin
          and fade for an organic feel. */}
      <ConfettiBurst />

      <div className="relative flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          {/* Animated check medal */}
          <motion.div
            className="relative flex h-12 w-12 items-center justify-center rounded-full bg-accent-500 text-white"
            initial={{ scale: 0.4, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              delay: 0.05,
              type: 'spring',
              stiffness: 360,
              damping: 18,
            }}
          >
            {/* Pulsing halo */}
            <motion.span
              className="absolute inset-0 rounded-full bg-accent-500/40"
              animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2.2, repeat: Infinity }}
            />
            <motion.svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              className="relative h-6 w-6"
            >
              <motion.path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{
                  delay: 0.2,
                  duration: 0.4,
                  ease: 'easeOut',
                }}
              />
            </motion.svg>
          </motion.div>

          <div>
            <motion.p
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-300/80"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
            >
              Launch Ready
            </motion.p>
            <motion.p
              className="text-lg font-semibold text-surface-100 mt-0.5"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.26 }}
            >
              Your go-to-market kit is live
            </motion.p>
          </div>
        </div>

        {reviewScore !== null && (
          <motion.div
            className="text-right"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: 0.32,
              type: 'spring',
              stiffness: 320,
              damping: 22,
            }}
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-accent-300/70">
              Reviewer
            </p>
            <p className="font-mono text-2xl font-bold text-accent-300">
              {reviewScore.toFixed(1)}
              <span className="text-accent-500/60 text-base">/10</span>
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function FailureBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0, x: [0, -8, 8, -6, 6, 0] }}
      exit={{ opacity: 0, y: -16 }}
      transition={{
        type: 'spring',
        stiffness: 240,
        damping: 22,
        x: { duration: 0.5, ease: 'easeOut', delay: 0.15 },
      }}
      className="relative overflow-hidden rounded-2xl border border-red-500/40 bg-gradient-to-br from-red-500/15 via-red-500/5 to-transparent px-6 py-5 mb-6"
    >
      <div className="relative flex items-center gap-4">
        <motion.div
          className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20 text-red-300"
          initial={{ scale: 0.5, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 360, damping: 20 }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-6 w-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </motion.div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-red-300/80">
            Launch Failed
          </p>
          <p className="text-base text-surface-200 mt-0.5">
            One of the pipeline stages couldn&rsquo;t complete. Check the job
            history below for details.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Confetti particles. We render a fixed array (12 dots) and use
 * framer-motion to fan them out and fade them away. Each particle
 * uses a deterministic angle so the burst feels intentional rather
 * than random — same shape every time, no Math.random tweens that
 * would break SSR/hydration if this ever moves to Next.
 */
function ConfettiBurst() {
  // Pre-computed cardinal angles + radii for the burst.
  const particles = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    const radius = 80 + (i % 3) * 18;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.6;
    const colors = ['bg-accent-300', 'bg-accent-400', 'bg-emerald-300', 'bg-teal-300'];
    return {
      id: i,
      x,
      y,
      color: colors[i % colors.length] ?? 'bg-accent-400',
      rotate: i * 30,
    };
  });

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-8 top-1/2 -translate-y-1/2">
        {particles.map((p) => (
          <motion.span
            key={p.id}
            className={`absolute h-1.5 w-1.5 rounded-sm ${p.color}`}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
            animate={{
              x: p.x,
              y: p.y,
              opacity: [0, 1, 1, 0],
              scale: [0, 1, 1, 0.6],
              rotate: p.rotate,
            }}
            transition={{
              duration: 1.2,
              ease: [0.16, 1, 0.3, 1],
              delay: 0.15,
              times: [0, 0.2, 0.7, 1],
            }}
          />
        ))}
      </div>
    </div>
  );
}
