import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

/**
 * Sidebar pulse dot for the job history rows. Animated per-status so
 * a glance at the list communicates pipeline health without reading
 * any text. Extracted to its own component so the motion variants
 * stay scoped and the parent row stays readable.
 */
export function JobStatusDot({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <span className="relative flex h-2 w-2 items-center justify-center flex-shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-60 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
      </span>
    );
  }
  if (status === 'completed') {
    return <span className="h-2 w-2 rounded-full bg-success-500 flex-shrink-0" />;
  }
  if (status === 'failed') {
    return <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />;
  }
  return <span className="h-2 w-2 rounded-full bg-surface-600 flex-shrink-0" />;
}

/**
 * Single key/value row in the repo analysis card. Extracted so the
 * stagger animation stays consistent across every row and a future
 * row addition doesn't forget to wrap itself in a motion variant.
 */
export function RepoAnalysisRow({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: -6 },
        visible: { opacity: 1, x: 0 },
      }}
      className="flex justify-between items-center group"
    >
      <span className="label group-hover:text-text-tertiary transition-colors">
        {label}
      </span>
      <span className="text-text-secondary font-mono text-mono-sm">{value}</span>
    </motion.div>
  );
}

/**
 * Animated detail-view skeleton. Mirrors the real layout of the
 * project page (header strip + pipeline strip + 2-col grid) so the
 * jump to the loaded view doesn't reflow the document, only fades in.
 * Each block uses framer-motion for a stagger entrance and tailwind's
 * `animate-shimmer-sweep` for the diagonal sheen effect.
 */
export function ProjectDetailSkeleton() {
  const blocks = [
    { className: 'h-7 w-72', delay: 0 },
    { className: 'h-4 w-48', delay: 0.04 },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="space-y-3 mb-8">
        {blocks.map((b, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: b.delay, duration: 0.4 }}
            className="relative h-7 overflow-hidden rounded-md bg-surface-900"
            style={{ width: undefined }}
          >
            <div className={`relative h-full ${b.className} bg-surface-800/80`} />
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-accent-500/10 to-transparent" />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Pipeline strip skeleton — six pill placeholders */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.4 }}
        className="relative mb-6 flex gap-3 overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/60 p-5"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex-1 space-y-2">
            <div className="h-2 w-full animate-pulse rounded-full bg-surface-800" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-surface-800/60" />
          </div>
        ))}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-accent-500/8 to-transparent" />
        </div>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {[0, 1].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.06, duration: 0.4 }}
              className="relative h-56 overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/60"
            >
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-accent-500/8 to-transparent" />
              </div>
              <div className="relative space-y-3 p-6">
                <div className="h-3 w-32 animate-pulse rounded-full bg-surface-800" />
                <div className="h-2 w-full animate-pulse rounded-full bg-surface-800/80" />
                <div className="h-2 w-5/6 animate-pulse rounded-full bg-surface-800/80" />
                <div className="h-2 w-2/3 animate-pulse rounded-full bg-surface-800/80" />
              </div>
            </motion.div>
          ))}
        </div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.4 }}
          className="relative h-56 overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/60"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-y-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-accent-500/8 to-transparent" />
          </div>
          <div className="relative space-y-3 p-6">
            <div className="h-3 w-24 animate-pulse rounded-full bg-surface-800" />
            <div className="h-2 w-full animate-pulse rounded-full bg-surface-800/80" />
            <div className="h-2 w-3/4 animate-pulse rounded-full bg-surface-800/80" />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/**
 * Motion-aware error card for the detail view. Replaces the previous
 * flat red `<p>` so a missing project / failed fetch reads as a
 * proper UI state rather than a debug message.
 */
export function ProjectDetailErrorCard({ message }: { message: string }) {
  return (
    <div className="max-w-6xl mx-auto px-6 py-24 flex justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-red-500/15 bg-surface-900/60 p-10 text-center"
      >
        <motion.div
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400/80"
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            delay: 0.1,
            type: 'spring',
            stiffness: 400,
            damping: 22,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-6 w-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </motion.div>
        <motion.p
          className="text-heading-md text-text-primary"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {message}
        </motion.p>
        <motion.p
          className="text-body-sm text-text-muted mt-2"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.26 }}
        >
          This project may have been removed or the URL is incorrect.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34 }}
        >
          <Link
            to="/app"
            className="btn-secondary mt-7 inline-flex items-center gap-2 text-body-sm"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Back to projects
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
