import { eq, desc, and, or, isNull, ne } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import type { StrategyInsight } from '@launchkit/shared';
import { database as db } from './database.js';

/**
 * Workflows-side `getInsightsForCategory` and
 * `getEditPatternsForCategory` — the subset of
 * `apps/worker/src/tools/project-insight-memory.ts` that asset tasks
 * actually need.
 *
 * The worker's full module also exports `findSimilarProjects` and
 * `storeProjectEmbedding`, both of which require the Voyage client.
 * Neither is called from the asset-generation path (they're used by
 * the analyze → research → strategize chain before fan-out), so the
 * workflows service does not need Voyage at all. Keeping just these
 * accessors here avoids dragging Voyage into the workflows env
 * surface.
 *
 * Both helpers return an empty array on any DB failure — matches the
 * worker's "degrade gracefully, log the underlying error" pattern for
 * insight reads. Both are also kept in lockstep with the worker copy:
 * the rationale, the filter shape, and the docstring above each
 * function are deliberately identical so the deliberate-copy
 * convention is unambiguous.
 */
export async function getInsightsForCategory(
  category: string
): Promise<StrategyInsight[]> {
  try {
    const insights = await db.query.strategyInsights.findMany({
      where: and(
        eq(schema.strategyInsights.category, category),
        or(
          isNull(schema.strategyInsights.insightType),
          ne(schema.strategyInsights.insightType, 'edit_pattern')
        )
      ),
      orderBy: [desc(schema.strategyInsights.confidence)],
      limit: 10,
    });

    return insights.map((i) => ({
      id: i.id,
      category: i.category,
      insight: i.insight,
      confidence: i.confidence,
      sampleSize: i.sampleSize,
      dataPoints: i.dataPoints,
      insightType: i.insightType,
      updatedAt: i.updatedAt,
    }));
  } catch (err) {
    console.error('[Workflows:Insights] Error getting insights:', err);
    return [];
  }
}

/**
 * Layer 3 edit-pattern insights for a given project category. The
 * Phase 7 cron writes one `strategy_insights` row per cluster of
 * semantically-similar user edits with `insight_type='edit_pattern'`;
 * this helper returns ONLY those rows so the writer agent can render
 * them in a dedicated prompt block instead of mixing them with
 * stat-based strategic insights.
 */
export async function getEditPatternsForCategory(
  category: string
): Promise<StrategyInsight[]> {
  try {
    const insights = await db.query.strategyInsights.findMany({
      where: and(
        eq(schema.strategyInsights.category, category),
        eq(schema.strategyInsights.insightType, 'edit_pattern')
      ),
      orderBy: [desc(schema.strategyInsights.confidence)],
      limit: 10,
    });

    return insights.map((i) => ({
      id: i.id,
      category: i.category,
      insight: i.insight,
      confidence: i.confidence,
      sampleSize: i.sampleSize,
      dataPoints: i.dataPoints,
      insightType: i.insightType,
      updatedAt: i.updatedAt,
    }));
  } catch (err) {
    console.error('[Workflows:Insights] Error getting edit patterns:', err);
    return [];
  }
}
