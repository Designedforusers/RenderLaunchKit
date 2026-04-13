import { motion, useReducedMotion } from 'framer-motion';

export function InProgressBody({ tintText }: { tintText: string }) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="relative overflow-hidden py-8 flex flex-col items-center justify-center text-surface-500 min-h-[140px]">
      {/* Shimmer sweep backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      </div>
      <motion.div
        className={`relative mb-3 ${tintText}`}
        animate={shouldReduceMotion ? { rotate: 0 } : { rotate: 360 }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : { duration: 1.4, repeat: Infinity, ease: 'linear' }
        }
      >
        <svg className="h-8 w-8" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </motion.div>
      <motion.p
        className="text-sm"
        initial={{ opacity: 0.6 }}
        animate={shouldReduceMotion ? { opacity: 1 } : { opacity: [0.6, 1, 0.6] }}
        transition={
          shouldReduceMotion
            ? { duration: 0 }
            : { duration: 2, repeat: Infinity, ease: 'easeInOut' }
        }
      >
        Generating...
      </motion.p>
    </div>
  );
}

export function FailedAssetBody({
  onRegenerate,
  regenerating,
}: {
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="py-8 flex flex-col items-center gap-3"
    >
      <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
        <svg
          className="h-5 w-5 text-red-400/80"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-body-sm text-red-300/80 font-medium">
          Generation failed
        </p>
        {onRegenerate ? (
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="mt-2 rounded-lg bg-accent-500/15 px-4 py-1.5 text-body-xs font-medium text-accent-400 transition-all hover:bg-accent-500/25 disabled:opacity-50"
          >
            {regenerating ? 'Regenerating...' : 'Regenerate'}
          </button>
        ) : (
          <p className="text-body-xs text-text-muted mt-1">
            Try regenerating this asset
          </p>
        )}
      </div>
    </motion.div>
  );
}
