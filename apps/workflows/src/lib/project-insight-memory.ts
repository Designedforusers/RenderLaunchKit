import { eq, desc } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import type { StrategyInsight } from '@launchkit/shared';
import { database as db } from './database.js';

/**
 * Workflows-side `getInsightsForCategory` — the subset of
 * `apps/worker/src/tools/project-insight-memory.ts` that asset tasks
 * actually need.
 *
 * The worker's full module also exports `findSimilarProjects` and
 * `storeProjectEmbedding`, both of which require the Voyage client.
 * Neither is called from the asset-generation path (they're used by
 * the analyze → research → strategize chain before fan-out), so the
 * workflows service does not need Voyage at all. Keeping just this one
 * helper here avoids dragging Voyage into the workflows env surface.
 *
 * Returns an empty array on any DB failure — matches the worker's
 * "degrade gracefully, log the underlying error" pattern for insight
 * reads.
 */
export async function getInsightsForCategory(
  category: string
): Promise<StrategyInsight[]> {
  try {
    const insights = await db.query.strategyInsights.findMany({
      where: eq(schema.strategyInsights.category, category),
      orderBy: [desc(schema.strategyInsights.confidence)],
      limit: 10,
    });

    return insights.map((i) => ({
      id: i.id,
      category: i.category,
      insight: i.insight,
      confidence: i.confidence,
      sampleSize: i.sampleSize,
      insightType: i.insightType,
    }));
  } catch (err) {
    console.error('[Workflows:Insights] Error getting insights:', err);
    return [];
  }
}
