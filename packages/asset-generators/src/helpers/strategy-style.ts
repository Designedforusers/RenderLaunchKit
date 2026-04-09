import type { StrategyBrief } from '@launchkit/shared';

/**
 * Maps the strategist agent's `tone` enum to a hex accent color
 * used by the Remotion compositions and the dashboard asset cards.
 *
 * Three Phase 4 agents and the existing product-video agent all
 * needed the same lookup; centralising it here keeps the palette
 * coherent and prevents the four call sites from drifting on the
 * next tone tweak. The mapping itself is intentionally simple —
 * extending it (new tone, alternate palette per category, etc.)
 * happens here, not in every agent.
 */
export function accentColorForTone(tone: StrategyBrief['tone']): string {
  switch (tone) {
    case 'technical':
      return '#38bdf8';
    case 'casual':
      return '#f59e0b';
    case 'authoritative':
      return '#f97316';
    case 'enthusiastic':
    default:
      return '#10b981';
  }
}
