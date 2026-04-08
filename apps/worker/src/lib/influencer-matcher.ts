import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  AudienceBreakdownSchema,
  InfluencerPlatformsSchema,
  type AudienceBreakdown,
  type InfluencerPlatforms,
} from '@launchkit/shared';
import { generateVoyageEmbedding, VoyageEmbeddingError } from './voyage-embeddings.js';
import { database as db } from './database.js';

/**
 * Phase 5 — Influencer matcher.
 *
 * Pure helper that takes a commit/project context, embeds it through
 * Voyage, and runs a pgvector cosine-similarity query against
 * `dev_influencers.topic_embedding` filtered by category overlap.
 *
 * Mirrors the canonical pgvector pattern in
 * `apps/worker/src/tools/project-insight-memory.ts:35-77` line-for-line:
 * raw SQL via Drizzle's `sql` template, vector cast through a
 * `[v1,v2,...]::vector` literal, `<=>` cosine-distance ORDER BY,
 * `1 - distance` similarity in the SELECT, Zod row validation at the
 * boundary so the `db.execute(sql)` `unknown[]` rows never leak typed
 * properties through an `any`-style cast.
 *
 * The matcher is a pure function — it does not insert anything, does
 * not call agents, does not make HTTP requests beyond the Voyage embed
 * call. Phase 6's commit-marketing-run processor calls this helper to
 * pick the top-N influencers for a commit; tests can drive it directly
 * with a fixed input vector.
 */

// ── Boundary-validation schema for the raw SQL row ────────────────
//
// `db.execute(sql`...`)` returns `unknown[]` rows because the query is
// hand-written and bypasses Drizzle's typed query builder. We Zod-parse
// every row before mapping to the typed return shape — same approach
// as `SimilarProjectRowSchema` at
// `apps/worker/src/tools/project-insight-memory.ts:16-22`.

const MatchedInfluencerRowSchema = z.object({
  id: z.string().uuid(),
  handle: z.string().min(1),
  platforms: z.unknown(),
  categories: z.array(z.string()),
  bio: z.string().nullable(),
  recent_topics: z.unknown(),
  audience_size: z.number().int().nonnegative(),
  audience_breakdown: z.unknown(),
  similarity: z.coerce.number(),
});

export interface MatchedInfluencer {
  id: string;
  handle: string;
  platforms: InfluencerPlatforms;
  categories: string[];
  bio: string | null;
  recentTopics: string[];
  audienceSize: number;
  audienceBreakdown: AudienceBreakdown | null;
  /** Cosine similarity in [0, 1]. Higher = better match. */
  similarity: number;
}

export interface FindInfluencersInput {
  /** Project category — must match one of the `categories` array values seeded on `dev_influencers`. */
  category: string;
  /**
   * Free-text describing the commit + repo focus the matcher is
   * embedding. Concatenation of category, repo description, and recent
   * commit messages is the typical shape — see Phase 6's
   * `process-commit-marketing-run.ts` for the canonical input.
   */
  contextText: string;
  /** Max rows to return. Default 10, max 50. */
  limit?: number;
  /**
   * Minimum `audience_size` filter — useful when the caller wants a
   * tier-1-only pass before falling back to all influencers. Defaults
   * to 0 (no filter).
   */
  minAudienceSize?: number;
}

/**
 * Find the top-N dev influencers whose `topic_embedding` is most
 * similar to the given context, filtered by category overlap.
 *
 * Returns rows ordered by cosine distance ascending (== similarity
 * descending). Caller is responsible for any further ranking (e.g.
 * weighting by audience size).
 *
 * Voyage configuration errors propagate via `VoyageEmbeddingError`
 * rather than being swallowed — same posture as `findSimilarProjects`
 * in `project-insight-memory.ts:67-76`. A silent empty result would
 * mask a missing API key in production.
 */
export async function findInfluencersForCommit(
  input: FindInfluencersInput
): Promise<MatchedInfluencer[]> {
  const limit = Math.min(Math.max(1, input.limit ?? 10), 50);
  const minAudienceSize = Math.max(0, input.minAudienceSize ?? 0);

  let embedding: number[];
  try {
    embedding = await generateVoyageEmbedding(input.contextText, {
      inputType: 'query',
    });
  } catch (err) {
    if (err instanceof VoyageEmbeddingError) throw err;
    console.error('[InfluencerMatcher] Voyage embed failed:', err);
    return [];
  }

  const vectorStr = `[${embedding.join(',')}]`;

  // The `categories && ARRAY[$param]::text[]` filter is the pgvector +
  // postgres-array overlap operator: a row passes when its `categories`
  // text[] shares at least one element with the input array. The
  // single-element input is the common case; passing multiple lets
  // Phase 6 widen the net for broad commits ("library" + "framework").
  //
  // `${input.category}` is parameterised by Drizzle's `sql` template
  // tag — it becomes a $n bind variable, NOT inlined SQL — so the
  // value is safe regardless of how `input.category` was constructed
  // upstream. The CLAUDE.md "parameterized queries only" invariant
  // forbids `sql.raw` for user-influenced strings; using the template
  // bind is the right pattern.
  const results = await db.execute(sql`
    SELECT
      id,
      handle,
      platforms,
      categories,
      bio,
      recent_topics,
      audience_size,
      audience_breakdown,
      1 - (topic_embedding <=> ${vectorStr}::vector) as similarity
    FROM dev_influencers
    WHERE topic_embedding IS NOT NULL
      AND audience_size >= ${minAudienceSize}
      AND categories && ARRAY[${input.category}]::text[]
    ORDER BY topic_embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);

  return results.rows.map((row): MatchedInfluencer => {
    const parsed = MatchedInfluencerRowSchema.parse(row);

    // The jsonb columns come back as `unknown` from the raw SQL path —
    // re-validate them through their canonical schemas before handing
    // typed shapes to the caller. A stale row with a wrong jsonb shape
    // surfaces as a Zod error here, not a downstream `undefined`.
    const platforms = InfluencerPlatformsSchema.parse(parsed.platforms);
    const audienceBreakdown =
      parsed.audience_breakdown === null
        ? null
        : AudienceBreakdownSchema.parse(parsed.audience_breakdown);
    const recentTopics = z
      .array(z.string())
      .nullable()
      .parse(parsed.recent_topics) ?? [];

    return {
      id: parsed.id,
      handle: parsed.handle,
      platforms,
      categories: parsed.categories,
      bio: parsed.bio,
      recentTopics,
      audienceSize: parsed.audience_size,
      audienceBreakdown,
      similarity: parsed.similarity,
    };
  });
}
