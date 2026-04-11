import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { database as db } from './database.js';

/**
 * Phase 6 — Per-commit duplication guard.
 *
 * Pure helper that asks "have we already marketed something
 * semantically equivalent to this commit in the last N days?" against
 * the persisted `commit_marketing_runs` history. The caller already
 * has the new commit's diff embedding (computed by the processor) and
 * passes it in directly — this helper does NOT call Voyage.
 *
 * Joins `commit_marketing_runs cmr` to `webhook_events we` ON
 * `we.id = cmr.webhook_event_id`. Filters by project + recency
 * window + non-null `we.diff_embedding`. Computes cosine similarity
 * via the `<=>` pgvector operator and returns the top match. If the
 * top match's similarity is ≥ threshold, the new commit is a
 * duplicate.
 *
 * Returns a discriminated union so the caller cannot accidentally
 * read `result.similar` without first narrowing on `result.duplicate`.
 *
 * The threshold defaults to 0.85 — strict enough that two distinct
 * features in the same files won't false-match, lenient enough to
 * catch the canonical "same commit fired twice" and "same feature
 * shipped over two days" cases.
 *
 * Same parameterised SQL idiom as `apps/worker/src/lib/trend-matcher.ts`
 * and `apps/worker/src/tools/project-insight-memory.ts`: raw SQL via
 * Drizzle's `sql` template tag, vector cast through a `[v1,v2,...]::vector`
 * literal, `<=>` cosine-distance ORDER BY, `1 - distance` similarity in
 * the SELECT, Zod row validation at the boundary so the `db.execute(sql)`
 * `unknown[]` rows never leak typed properties through an `any`-style
 * cast. NO `sql.raw`.
 */

// ── Boundary-validation schema for the raw SQL row ────────────────
//
// `db.execute(sql`...`)` returns `unknown[]` rows because the query
// is hand-written and bypasses Drizzle's typed query builder. We
// Zod-parse every row before reading any field — same approach as
// `MatchedTrendRowSchema` in `trend-matcher.ts`.

const SimilarRunRowSchema = z.object({
  commit_marketing_run_id: z.string().uuid(),
  webhook_event_id: z.string().uuid(),
  // The `commit_marketing_runs.commit_sha` column is `varchar(40) NOT
  // NULL` but has no DB-level minimum-length constraint, so a row
  // could legitimately carry an empty string from a degenerate
  // historical write. Accept any string here so the guard never
  // crashes on a malformed row — the processor's surrogate-id
  // fallback prevents empty strings from being written going forward.
  commit_sha: z.string(),
  commit_message: z.string().nullable(),
  similarity: z.coerce.number(),
  created_at: z.coerce.date(),
});

export interface CheckDuplicationInput {
  /** Scope the check to one project — duplicates across projects do not count. */
  projectId: string;
  /**
   * The new commit's diff embedding (already computed by the caller).
   * The processor builds this from the commit message + changed file
   * paths via Voyage and persists it to `webhook_events.diff_embedding`
   * BEFORE calling this helper.
   */
  diffEmbedding: number[];
  /**
   * Cosine similarity threshold above which the new commit is a
   * duplicate. Default 0.85.
   */
  threshold?: number;
  /**
   * Recency window in days to check. Default 7. Commits older than
   * this are not considered duplicates regardless of similarity —
   * "we already marketed this last month" is not the same problem as
   * "we already marketed this 2 days ago."
   */
  sinceDays?: number;
}

export type DuplicationResult =
  | { duplicate: false }
  | {
      duplicate: true;
      similar: {
        commitMarketingRunId: string;
        webhookEventId: string;
        commitSha: string;
        commitMessage: string | null;
        similarity: number;
        daysAgo: number;
      };
    };

export async function checkCommitDuplication(
  input: CheckDuplicationInput
): Promise<DuplicationResult> {
  const threshold = input.threshold ?? 0.85;
  const sinceDays = Math.max(1, input.sinceDays ?? 7);
  const vectorStr = `[${input.diffEmbedding.join(',')}]`;

  // Single query: top-1 most similar commit_marketing_runs row in the
  // project's recent history. The threshold check happens in JS
  // because Postgres `<=>` returns distance not similarity, and the
  // caller wants the row data even when it's just below the threshold
  // (for logging) — so we always fetch the top row and decide in JS.
  //
  // `make_interval(days => ${sinceDays})` is the type-safe idiom for
  // building an interval from an integer bind parameter. The more
  // common `(N || ' days')::interval` form requires an explicit
  // integer→text cast since PostgreSQL 8.3 removed the implicit cast,
  // so `make_interval` (available since 9.4) is the cleaner choice
  // and keeps `sinceDays` parameterised rather than string-embedded.
  //
  // Every bind below — `${vectorStr}`, `${input.projectId}`,
  // `${sinceDays}` — flows through Drizzle's `sql` template tag as a
  // `$n` placeholder, never as inlined SQL. The CLAUDE.md
  // "parameterized queries only" invariant forbids `sql.raw` for any
  // external-influenced string; the template bind is the right
  // pattern.
  const results = await db.execute(sql`
    SELECT
      cmr.id as commit_marketing_run_id,
      cmr.webhook_event_id,
      cmr.commit_sha,
      cmr.commit_message,
      cmr.created_at,
      1 - (we.diff_embedding <=> ${vectorStr}::vector) as similarity
    FROM commit_marketing_runs cmr
    JOIN webhook_events we ON we.id = cmr.webhook_event_id
    WHERE cmr.project_id = ${input.projectId}
      AND we.diff_embedding IS NOT NULL
      AND cmr.created_at >= now() - make_interval(days => ${sinceDays})
    ORDER BY we.diff_embedding <=> ${vectorStr}::vector
    LIMIT 1
  `);

  const [firstRow] = results.rows;
  if (!firstRow) {
    return { duplicate: false };
  }

  const parsed = SimilarRunRowSchema.parse(firstRow);
  if (parsed.similarity < threshold) {
    return { duplicate: false };
  }

  const daysAgo = Math.floor(
    (Date.now() - parsed.created_at.getTime()) / (24 * 60 * 60 * 1000)
  );

  return {
    duplicate: true,
    similar: {
      commitMarketingRunId: parsed.commit_marketing_run_id,
      webhookEventId: parsed.webhook_event_id,
      commitSha: parsed.commit_sha,
      commitMessage: parsed.commit_message,
      similarity: parsed.similarity,
      daysAgo,
    },
  };
}
