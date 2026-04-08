import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { generateVoyageEmbedding, VoyageEmbeddingError } from './voyage-embeddings.js';
import { database as db } from './database.js';

/**
 * Phase 6 — Trend matcher.
 *
 * Pure helper that takes a commit/project context, embeds it through
 * Voyage, and runs a pgvector cosine-similarity query against
 * `trend_signals.embedding` filtered by category and a recency window.
 *
 * Mirrors `apps/worker/src/lib/influencer-matcher.ts` line-for-line:
 * raw SQL via Drizzle's `sql` template (every value parameterised,
 * no `sql.raw`), `<=>` cosine-distance ORDER BY, `1 - distance`
 * similarity in the SELECT, Zod row validation at the boundary so
 * the `db.execute(sql)` `unknown[]` rows never leak typed properties
 * through an `any`-style cast.
 *
 * Used by Phase 6's `process-commit-marketing-run.ts` processor to
 * pick the top-N trends to feed into the commit-marketability agent
 * (the agent decides whether the commit aligns with what the dev
 * community is currently talking about).
 */

// ── Boundary-validation schema for the raw SQL row ────────────────
//
// `db.execute(sql`...`)` returns `unknown[]` rows because the query is
// hand-written and bypasses Drizzle's typed query builder. We Zod-parse
// every row before mapping to the typed return shape — same approach
// as `MatchedInfluencerRowSchema` at
// `apps/worker/src/lib/influencer-matcher.ts:42-52`.

const MatchedTrendRowSchema = z.object({
  id: z.string().uuid(),
  topic: z.string().min(1),
  headline: z.string().min(1),
  url: z.string().nullable(),
  source: z.string().min(1),
  velocity_score: z.coerce.number(),
  similarity: z.coerce.number(),
  ingested_at: z.coerce.date(),
});

export interface MatchedTrend {
  id: string;
  topic: string;
  headline: string;
  url: string | null;
  source: string;
  velocityScore: number;
  /** Cosine similarity in [0, 1]. Higher = better match. */
  similarity: number;
  ingestedAt: Date;
}

export interface FindTrendsInput {
  /** Project category — used to filter `trend_signals.category`. */
  category: string;
  /**
   * Free-text describing the commit context the matcher is embedding.
   * Typical shape: commit message + repo description + recent
   * commit-touched topics. The new processor builds this string and
   * hands it in.
   */
  contextText: string;
  /** Max rows to return. Default 5, max 20. */
  limit?: number;
  /**
   * Recency window in days. Only trends ingested within the last N
   * days are returned — older trends decay in relevance fast in the
   * dev community. Default 7.
   */
  sinceDays?: number;
}

/**
 * Find the top-N trending topics most similar to the given commit
 * context, filtered by project category and a recency window.
 *
 * Returns rows ordered by cosine distance ascending (== similarity
 * descending). Caller is responsible for any further ranking (e.g.
 * weighting by velocity score).
 *
 * Voyage configuration errors propagate via `VoyageEmbeddingError`
 * rather than being swallowed — same posture as `findInfluencersForCommit`
 * in `influencer-matcher.ts:96-108` and `findSimilarProjects` in
 * `project-insight-memory.ts:67-76`. A silent empty result would mask
 * a missing API key in production.
 */
export async function findRelevantTrendsForCommit(
  input: FindTrendsInput
): Promise<MatchedTrend[]> {
  const limit = Math.min(Math.max(1, input.limit ?? 5), 20);
  const sinceDays = Math.max(1, input.sinceDays ?? 7);

  let embedding: number[];
  try {
    embedding = await generateVoyageEmbedding(input.contextText, {
      inputType: 'query',
    });
  } catch (err) {
    if (err instanceof VoyageEmbeddingError) throw err;
    console.error('[TrendMatcher] Voyage embed failed:', err);
    return [];
  }

  const vectorStr = `[${embedding.join(',')}]`;

  // Every value is parameterised through Drizzle's `sql` template tag.
  // The recency window uses `make_interval(days => $n)` rather than the
  // `($n || ' days')::interval` string-concat form because Postgres has
  // no implicit `integer || text` operator — concatenating a number bind
  // to a string literal would raise `operator does not exist: integer
  // || unknown` at runtime. `make_interval` takes a typed `int` argument
  // directly, so `sinceDays` flows through as a standard $n bind with
  // no casting gymnastics. No `sql.raw`, no manual quote escaping, no
  // injection surface.
  const results = await db.execute(sql`
    SELECT
      id,
      topic,
      headline,
      url,
      source,
      velocity_score,
      ingested_at,
      1 - (embedding <=> ${vectorStr}::vector) as similarity
    FROM trend_signals
    WHERE embedding IS NOT NULL
      AND category = ${input.category}
      AND ingested_at >= now() - make_interval(days => ${sinceDays})
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);

  return results.rows.map((row): MatchedTrend => {
    const parsed = MatchedTrendRowSchema.parse(row);
    return {
      id: parsed.id,
      topic: parsed.topic,
      headline: parsed.headline,
      url: parsed.url,
      source: parsed.source,
      velocityScore: parsed.velocity_score,
      similarity: parsed.similarity,
      ingestedAt: parsed.ingested_at,
    };
  });
}
