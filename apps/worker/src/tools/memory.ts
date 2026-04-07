import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { eq, sql, desc } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import { generateEmbedding, createProjectEmbeddingText } from '../lib/embeddings.js';
import type { StrategyInsight } from '@launchkit/shared';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const db = drizzle(pool, { schema });

/**
 * Find similar past projects using pgvector cosine similarity.
 */
export async function findSimilarProjects(
  description: string,
  limit: number = 3
): Promise<Array<{
  id: string;
  repoName: string;
  strategy: any;
  reviewScore: number | null;
  similarity: number;
}>> {
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

    return (results.rows as any[]).map((row) => ({
      id: row.id,
      repoName: row.repo_name,
      strategy: row.strategy,
      reviewScore: row.review_score,
      similarity: row.similarity,
    }));
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
