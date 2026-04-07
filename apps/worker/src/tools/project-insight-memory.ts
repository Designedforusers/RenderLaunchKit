import { eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@launchkit/shared';
import {
  generateEmbedding,
  createProjectEmbeddingText,
} from '../lib/project-embedding-service.js';
import type { StrategyInsight } from '@launchkit/shared';
import { database as db } from '../lib/database.js';

// Result row schema for the raw `db.execute(sql...)` similarity query.
// `db.execute` returns `unknown[]` rows because the SQL is hand-written
// rather than going through Drizzle's typed query builder, so we
// validate at the boundary instead of casting to `any`.
const SimilarProjectRowSchema = z.object({
  id: z.string(),
  repo_name: z.string(),
  strategy: z.unknown(),
  review_score: z.number().nullable(),
  similarity: z.coerce.number(),
});

export interface SimilarProject {
  id: string;
  repoName: string;
  strategy: unknown;
  reviewScore: number | null;
  similarity: number;
}

/**
 * Find similar past projects using pgvector cosine similarity.
 */
export async function findSimilarProjects(
  description: string,
  limit: number = 3
): Promise<SimilarProject[]> {
  try {
    const embedding = await generateEmbedding(description);
    const vectorStr = `[${embedding.join(',')}]`;

    const results = await db.execute(sql`
      SELECT
        id,
        repo_name,
        strategy,
        review_score,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM projects
      WHERE embedding IS NOT NULL
        AND status = 'complete'
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return results.rows.map((row): SimilarProject => {
      const parsed = SimilarProjectRowSchema.parse(row);
      return {
        id: parsed.id,
        repoName: parsed.repo_name,
        strategy: parsed.strategy,
        reviewScore: parsed.review_score,
        similarity: parsed.similarity,
      };
    });
  } catch (err) {
    console.error('[Memory] Error finding similar projects:', err);
    return [];
  }
}

/**
 * Get strategy insights for a given project category.
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
    }));
  } catch (err) {
    console.error('[Memory] Error getting insights:', err);
    return [];
  }
}

/**
 * Store project embedding after analysis.
 */
export async function storeProjectEmbedding(
  projectId: string,
  data: {
    repoName: string;
    description: string;
    language: string;
    techStack: string[];
    category: string;
    topics: string[];
  }
): Promise<void> {
  try {
    const text = createProjectEmbeddingText(data);
    const embedding = await generateEmbedding(text);
    const vectorStr = `[${embedding.join(',')}]`;

    await db.execute(sql`
      UPDATE projects
      SET embedding = ${vectorStr}::vector
      WHERE id = ${projectId}
    `);
  } catch (err) {
    console.error('[Memory] Error storing embedding:', err);
  }
}
