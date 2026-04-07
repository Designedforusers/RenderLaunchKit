const STATUS_CONFIG: Record<string, { color: string; bg: string; label?: string; animate?: boolean }> = {
  pending: { color: 'text-surface-400', bg: 'bg-surface-400/10' },
  analyzing: { color: 'text-blue-400', bg: 'bg-blue-400/10', animate: true },
  researching: { color: 'text-violet-400', bg: 'bg-violet-400/10', animate: true },
  strategizing: { color: 'text-amber-400', bg: 'bg-amber-400/10', animate: true },
  generating: { color: 'text-accent-400', bg: 'bg-accent-400/10', animate: true },
  reviewing: { color: 'text-pink-400', bg: 'bg-pink-400/10', animate: true },
  revising: { color: 'text-orange-400', bg: 'bg-orange-400/10', animate: true },
  complete: { color: 'text-accent-400', bg: 'bg-accent-400/10' },
  failed: { color: 'text-red-400', bg: 'bg-red-400/10' },
  queued: { color: 'text-surface-400', bg: 'bg-surface-400/10' },
  approved: { color: 'text-accent-400', bg: 'bg-accent-400/10' },
  rejected: { color: 'text-red-400', bg: 'bg-red-400/10' },
  regenerating: { color: 'text-orange-400', bg: 'bg-orange-400/10', animate: true },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  return (
    <span
      className={`badge ${config.color} ${config.bg} ${className}`}
    >
      {config.animate && (
        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${config.color.replace('text-', 'bg-')} animate-pulse-dot`} />
      )}
      {config.label || status}
    </span>
  );
}
