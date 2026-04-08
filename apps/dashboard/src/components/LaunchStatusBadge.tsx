import { motion, AnimatePresence } from 'framer-motion';

// `as const satisfies` keeps the literal types for keys (so each lookup
// returns a definitely-defined value under `noUncheckedIndexedAccess`)
// while still type-checking the value shape.
//
// `dotColor` is a separate field instead of derived from `color` so we
// don't have to do string-replace gymnastics at render time. The
// `kind` discriminator drives the per-status motion treatment in the
// component below.
const STATUS_CONFIG = {
  pending: {
    color: 'text-surface-400',
    bg: 'bg-surface-400/10',
    dotColor: 'bg-surface-400',
    kind: 'idle',
  },
  analyzing: {
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
    dotColor: 'bg-blue-400',
    kind: 'active',
  },
  researching: {
    color: 'text-violet-400',
    bg: 'bg-violet-400/10',
    dotColor: 'bg-violet-400',
    kind: 'active',
  },
  strategizing: {
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
    dotColor: 'bg-amber-400',
    kind: 'active',
  },
  generating: {
    color: 'text-accent-400',
    bg: 'bg-accent-400/10',
    dotColor: 'bg-accent-400',
    kind: 'active',
  },
  reviewing: {
    color: 'text-pink-400',
    bg: 'bg-pink-400/10',
    dotColor: 'bg-pink-400',
    kind: 'active',
  },
  revising: {
    color: 'text-orange-400',
    bg: 'bg-orange-400/10',
    dotColor: 'bg-orange-400',
    kind: 'active',
  },
  complete: {
    color: 'text-accent-400',
    bg: 'bg-accent-400/10',
    dotColor: 'bg-accent-400',
    kind: 'complete',
  },
  failed: {
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    dotColor: 'bg-red-400',
    kind: 'failed',
  },
  queued: {
    color: 'text-surface-400',
    bg: 'bg-surface-400/10',
    dotColor: 'bg-surface-400',
    kind: 'idle',
  },
  approved: {
    color: 'text-accent-400',
    bg: 'bg-accent-400/10',
    dotColor: 'bg-accent-400',
    kind: 'complete',
  },
  rejected: {
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    dotColor: 'bg-red-400',
    kind: 'failed',
  },
  regenerating: {
    color: 'text-orange-400',
    bg: 'bg-orange-400/10',
    dotColor: 'bg-orange-400',
    kind: 'active',
  },
} as const satisfies Record<
  string,
  {
    color: string;
    bg: string;
    dotColor: string;
    kind: 'idle' | 'active' | 'complete' | 'failed';
    label?: string;
  }
>;

type StatusKey = keyof typeof STATUS_CONFIG;
type StatusKind = (typeof STATUS_CONFIG)[StatusKey]['kind'];

function isStatusKey(value: string): value is StatusKey {
  return value in STATUS_CONFIG;
}

interface LaunchStatusBadgeProps {
  status: string;
  className?: string;
}

export function LaunchStatusBadge({
  status,
  className = '',
}: LaunchStatusBadgeProps) {
  const config: (typeof STATUS_CONFIG)[StatusKey] = isStatusKey(status)
    ? STATUS_CONFIG[status]
    : STATUS_CONFIG.pending;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        // Re-keying on `status` makes AnimatePresence treat each
        // status flip as a fresh badge — the previous one exits, the
        // new one enters, the user sees an obvious transition rather
        // than a silent in-place text swap.
        key={status}
        initial={{ opacity: 0, scale: 0.85, y: -2 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: 2 }}
        transition={{ type: 'spring', stiffness: 520, damping: 28 }}
        className={`badge ${config.color} ${config.bg} ${className}`}
      >
        <StatusGlyph kind={config.kind} dotColor={config.dotColor} />
        {status}
      </motion.span>
    </AnimatePresence>
  );
}

interface StatusGlyphProps {
  kind: StatusKind;
  dotColor: string;
}

function StatusGlyph({ kind, dotColor }: StatusGlyphProps) {
  if (kind === 'active') {
    // Pulsing dot with a halo ring expanding behind it. Reads as
    // "actively working" without any text required.
    return (
      <span className="relative mr-1.5 flex h-1.5 w-1.5 items-center justify-center">
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${dotColor} animate-ping`}
        />
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotColor}`} />
      </span>
    );
  }

  if (kind === 'complete') {
    // Tiny check that draws itself once on mount, framed by a soft
    // ring tint. The pathLength tween reads as "the system finished
    // signing off on this asset" rather than a static icon.
    return (
      <motion.span
        className="mr-1.5 inline-flex h-3 w-3 items-center justify-center rounded-full bg-accent-500/15 text-accent-400"
        initial={{ scale: 0.4, rotate: -45 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 22 }}
      >
        <motion.svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          className="h-2 w-2"
        >
          <motion.path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.32, ease: 'easeOut', delay: 0.05 }}
          />
        </motion.svg>
      </motion.span>
    );
  }

  if (kind === 'failed') {
    // Subtle one-shot shake for failed/rejected so a status flip to
    // failure is impossible to miss without being annoying on
    // re-render. The motion plays once on mount.
    return (
      <motion.span
        className="mr-1.5 inline-flex h-3 w-3 items-center justify-center rounded-full bg-red-500/15 text-red-400"
        initial={{ x: 0 }}
        animate={{ x: [0, -2, 2, -2, 2, 0] }}
        transition={{ duration: 0.4, ease: 'easeInOut' }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          className="h-2 w-2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
        </svg>
      </motion.span>
    );
  }

  // idle / queued — flat dot with no motion.
  return <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${dotColor}`} />;
}
