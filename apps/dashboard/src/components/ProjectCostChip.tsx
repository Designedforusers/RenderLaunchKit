import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import type { ProjectCosts } from '../lib/api.js';

/**
 * "Generated for $X.XX" chip rendered near the top of the asset
 * gallery on the project detail page.
 *
 * Loads on mount from `GET /api/projects/:id/costs`, which
 * aggregates `asset_cost_events` by provider. The chip hides
 * itself entirely when:
 *
 *   - The request fails (the user does not need to see a
 *     cost-tracking error — generation still worked).
 *   - The total is zero (seed projects, pre-tracking historical
 *     projects, or projects whose every asset ran on a cached
 *     or placeholder path).
 *
 * A zero-total chip would read as "this cost nothing, which is
 * wrong and I don't know why" — silently hiding in that case is
 * the less-confusing outcome. Operators who need the zero value
 * can read it directly off the API.
 *
 * Formatted with `(cents / 100).toFixed(2)` — integer cents at
 * every layer, floating-point division only at display time.
 */

interface ProjectCostChipProps {
  projectId: string;
}

/**
 * Shared cent-to-dollar formatter. Kept local to this module
 * because it's the only file that renders a dollar amount today;
 * a future asset-card cost label reuses the same pattern.
 */
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ProjectCostChip({ projectId }: ProjectCostChipProps) {
  const [costs, setCosts] = useState<ProjectCosts | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await api.getProjectCosts(projectId);
        if (!cancelled) {
          setCosts(data);
        }
      } catch (err) {
        // Silent failure is the right call for a cost chip: the
        // user does not need to see a cost-tracking hiccup, and
        // the generation still succeeded regardless. Log for
        // triage and hide the chip.
        console.warn(
          '[ProjectCostChip] failed to load project costs:',
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Show a subtle skeleton while loading so the chip doesn't pop from nothing.
  if (!loaded) {
    return (
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-surface-800/60 bg-surface-900/40 px-3.5 py-1.5">
        <div className="h-3 w-24 animate-pulse rounded-full bg-surface-800/60" />
      </div>
    );
  }

  if (!costs || costs.totalCents === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="mb-4 inline-flex items-center gap-2 rounded-full border border-surface-800 bg-surface-900/60 px-3.5 py-1.5 font-mono text-mono-sm text-text-secondary"
      aria-label={`Total provider cost for this project: ${formatCents(costs.totalCents)}`}
    >
      <svg
        className="h-3.5 w-3.5 text-accent-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span className="label">Generated for</span>
      <span className="font-semibold text-text-primary">
        {formatCents(costs.totalCents)}
      </span>
    </motion.div>
  );
}
