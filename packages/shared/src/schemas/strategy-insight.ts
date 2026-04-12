import { z } from 'zod';

/**
 * Schema for the self-learning system's strategy insights.
 *
 * Mirrors the original hand-written interface in `types.ts:160-166`.
 * Produced by the cron-driven `aggregate-feedback-insights.ts` job
 * which groups completed projects by category and derives lessons
 * (e.g. "CLI tools: technical tone +35% approval"). Stored in the
 * `strategy_insights` table and surfaced to the strategist agent as
 * additional prompt context for new projects in the same category.
 */

export const StrategyInsightSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  insight: z.string(),
  confidence: z.number().min(0).max(1),
  sampleSize: z.number().int().nonnegative(),
  dataPoints: z.unknown().nullable(),
  // Phase 2: discriminator added so the strategist can query Layer 1
  // stat-based insights and Layer 3 edit-cluster insights separately.
  // Existing rows from before Phase 2 have NULL — the cron at
  // `apps/cron/src/aggregate-feedback-insights.ts` starts setting it
  // explicitly in Phase 7.
  insightType: z.string().nullable(),
  updatedAt: z.date(),
});
export type StrategyInsight = z.infer<typeof StrategyInsightSchema>;
