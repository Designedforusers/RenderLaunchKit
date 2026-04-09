import { motion } from 'framer-motion';

interface LaunchStrategyCardProps {
  strategy: {
    positioning: string;
    tone: string;
    keyMessages: string[];
    selectedChannels: Array<{
      channel: string;
      priority: number;
      reasoning: string;
    }>;
    skipAssets: Array<{
      type: string;
      reasoning: string;
    }>;
  };
}

const TONE_COLORS: Record<string, string> = {
  technical: 'text-blue-400 bg-blue-400/10',
  casual: 'text-amber-400 bg-amber-400/10',
  enthusiastic: 'text-pink-400 bg-pink-400/10',
  authoritative: 'text-violet-400 bg-violet-400/10',
};

// Reusable child variant for staggered content reveal. Defining it
// once at module scope (instead of inline per-element) keeps the
// timing consistent across the whole card.
const childVariant = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 280, damping: 26 },
  },
};

export function LaunchStrategyCard({ strategy }: LaunchStrategyCardProps) {
  const sortedChannels = [...strategy.selectedChannels].sort(
    (a, b) => a.priority - b.priority
  );

  return (
    <motion.div
      className="card relative overflow-hidden"
      initial={{ opacity: 0, y: 20, scale: 0.98, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      transition={{
        duration: 0.6,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {/* Soft accent halo behind the card to flag it as the strategic
          spine of the project. The blur sits behind the children so
          it doesn't bleed into the text. */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-accent-500/10 blur-3xl" />

      <motion.div
        className="relative"
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: { staggerChildren: 0.08, delayChildren: 0.15 },
          },
        }}
      >
        <motion.div
          className="flex items-center justify-between mb-6"
          variants={childVariant}
        >
          <h3 className="label">
            Launch Strategy
          </h3>
          <motion.span
            className={`badge ${TONE_COLORS[strategy.tone] ?? 'text-surface-400 bg-surface-400/10'}`}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              delay: 0.45,
              type: 'spring',
              stiffness: 420,
              damping: 22,
            }}
          >
            {strategy.tone}
          </motion.span>
        </motion.div>

        {/* Positioning */}
        <motion.div className="mb-6" variants={childVariant}>
          <p className="font-display text-display-md text-text-primary">
            &ldquo;{strategy.positioning}&rdquo;
          </p>
        </motion.div>

        {/* Key Messages */}
        <motion.div className="mb-6" variants={childVariant}>
          <h4 className="label mb-3">
            Key Messages
          </h4>
          <motion.ul
            className="space-y-2"
            variants={{
              visible: {
                transition: { staggerChildren: 0.06, delayChildren: 0.05 },
              },
            }}
          >
            {strategy.keyMessages.map((msg, i) => (
              <motion.li
                key={i}
                className="flex items-start gap-2"
                variants={{
                  hidden: { opacity: 0, x: -16 },
                  visible: {
                    opacity: 1,
                    x: 0,
                    transition: {
                      type: 'spring',
                      stiffness: 320,
                      damping: 26,
                    },
                  },
                }}
              >
                <span className="text-accent-500 mt-0.5 font-mono text-mono-sm">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-body-md text-text-secondary">{msg}</span>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Channels */}
        <motion.div className="mb-6" variants={childVariant}>
          <h4 className="label mb-3">
            Target Channels
          </h4>
          <motion.div
            className="flex flex-wrap gap-2"
            variants={{
              visible: {
                transition: { staggerChildren: 0.05 },
              },
            }}
          >
            {sortedChannels.map((ch) => (
              <motion.div
                key={ch.channel}
                className="group relative"
                title={ch.reasoning}
                variants={{
                  hidden: { opacity: 0, scale: 0.8, y: 8 },
                  visible: {
                    opacity: 1,
                    scale: 1,
                    y: 0,
                    transition: {
                      type: 'spring',
                      stiffness: 360,
                      damping: 24,
                    },
                  },
                }}
                whileHover={{ y: -2, scale: 1.04 }}
              >
                <span className="badge bg-surface-800 text-surface-300 border border-surface-700">
                  <span className="text-accent-500 mr-1 font-mono text-[0.625rem] font-semibold">
                    #{ch.priority}
                  </span>
                  {ch.channel.replace(/_/g, ' ')}
                </span>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        {/* Skipped Assets */}
        {strategy.skipAssets.length > 0 && (
          <motion.div variants={childVariant}>
            <h4 className="label mb-3">
              Skipped Assets
            </h4>
            <div className="space-y-1.5">
              {strategy.skipAssets.map((skip, i) => (
                <motion.div
                  key={skip.type}
                  className="flex items-start gap-2 text-body-sm"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.05 }}
                >
                  <span className="text-text-muted">~</span>
                  <span className="text-text-muted">
                    <span className="text-text-tertiary">
                      {skip.type.replace(/_/g, ' ')}
                    </span>
                    {' — '}
                    {skip.reasoning}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
