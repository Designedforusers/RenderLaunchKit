import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '@launchkit/shared';
import {
  groupBy,
  mean,
  RepoAnalysisSchema,
  StrategyBriefSchema,
} from '@launchkit/shared';
import { database } from './database.js';

/**
 * Aggregate learning insights from user feedback on generated assets.
 * This is the self-learning system — it analyzes what works and what doesn't
 * across all projects, grouped by category.
 */
export async function aggregateFeedbackInsights(): Promise<void> {
  console.log(
    '[Cron:AggregateFeedbackInsights] Aggregating learnings from user feedback...'
  );

  // Get all complete projects with user feedback on assets
  const completedProjects = await database.query.projects.findMany({
    where: eq(schema.projects.status, 'complete'),
    with: {
      assets: true,
    },
  });

  const projectsWithFeedback = completedProjects.filter((p) =>
    p.assets.some((a) => a.userApproved !== null)
  );

  if (projectsWithFeedback.length === 0) {
    console.log(
      '[Cron:AggregateFeedbackInsights] No projects with user feedback found'
    );
    return;
  }

  // Group by project category. The cron is intentionally tolerant
  // of malformed `repo_analysis` rows — older projects from before
  // the schema validation pass may have shapes the current schema
  // does not accept, and the right behaviour for an aggregation job
  // is to skip those projects rather than fail the entire run. We
  // use `safeParse` for the same reason in the strategy lookup below.
  const byCategory = groupBy(projectsWithFeedback, (p) => {
    const parsed = RepoAnalysisSchema.safeParse(p.repoAnalysis);
    return parsed.success ? parsed.data.category : 'unknown';
  });

  let insightCount = 0;

  for (const [category, categoryProjects] of Object.entries(byCategory)) {
    const allAssets = categoryProjects.flatMap((p) => p.assets);
    const assetsWithFeedback = allAssets.filter((a) => a.userApproved !== null);

    if (assetsWithFeedback.length < 2) continue;

    // Insight 1: Approval rate by asset type
    const byType = groupBy(assetsWithFeedback, (a) => a.type);

    for (const [assetType, typeAssets] of Object.entries(byType)) {
      if (typeAssets.length < 2) continue;

      const approvalRate =
        typeAssets.filter((a) => a.userApproved).length / typeAssets.length;
      const avgScore = mean(
        typeAssets.map((a) => a.qualityScore).filter((s): s is number => s !== null)
      );

      // Generate insight for low approval types
      if (approvalRate < 0.4) {
        await upsertInsight({
          category,
          insight: `Users reject ${assetType} assets ${Math.round((1 - approvalRate) * 100)}% of the time for ${category} projects. Consider skipping or adjusting approach.`,
          confidence: Math.min(typeAssets.length / 10, 1),
          sampleSize: typeAssets.length,
        });
        insightCount++;
      }

      // Generate insight for high-performing types
      if (approvalRate > 0.8 && avgScore > 7.5) {
        await upsertInsight({
          category,
          insight: `${assetType} assets perform exceptionally well for ${category} projects (${Math.round(approvalRate * 100)}% approval, avg score ${avgScore.toFixed(1)}).`,
          confidence: Math.min(typeAssets.length / 10, 1),
          sampleSize: typeAssets.length,
        });
        insightCount++;
      }
    }

    // Insight 2: Tone analysis. Same tolerant-parse pattern as
    // above — skip projects whose `strategy` jsonb does not match
    // the current schema rather than failing the whole aggregation.
    const toneScores: Record<string, number[]> = {};
    for (const project of categoryProjects) {
      const parsed = StrategyBriefSchema.safeParse(project.strategy);
      if (!parsed.success) continue;
      const tone = parsed.data.tone;
      if (project.reviewScore) {
        toneScores[tone] ??= [];
        toneScores[tone].push(project.reviewScore);
      }
    }

    const toneEntries = Object.entries(toneScores).filter(([, scores]) => scores.length >= 2);
    if (toneEntries.length >= 2) {
      const bestTone = toneEntries.reduce((best, [tone, scores]) => {
        const avg = mean(scores);
        return avg > best.avg ? { tone, avg } : best;
      }, { tone: '', avg: 0 });

      await upsertInsight({
        category,
        insight: `For ${category} projects, "${bestTone.tone}" tone performs best with an average score of ${bestTone.avg.toFixed(1)}/10.`,
        confidence: Math.min(toneEntries.reduce((sum, [, s]) => sum + s.length, 0) / 20, 1),
        sampleSize: toneEntries.reduce((sum, [, s]) => sum + s.length, 0),
      });
      insightCount++;
    }

    // Insight 3: User edit patterns
    const editedAssets = assetsWithFeedback.filter((a) => a.userEdited);
    if (editedAssets.length >= 2) {
      const editRate = editedAssets.length / assetsWithFeedback.length;
      const editedTypes = groupBy(editedAssets, (a) => a.type);
      const mostEditedType = Object.entries(editedTypes).sort(
        ([, a], [, b]) => b.length - a.length
      )[0];

      if (mostEditedType && editRate > 0.3) {
        await upsertInsight({
          category,
          insight: `Users frequently edit ${mostEditedType[0]} assets for ${category} projects (${Math.round(editRate * 100)}% edit rate). Consider adjusting generation approach.`,
          confidence: Math.min(assetsWithFeedback.length / 15, 1),
          sampleSize: assetsWithFeedback.length,
        });
        insightCount++;
      }
    }
  }

  // ── Phase 7: new aggregations ──
  //
  // Layer 1 #1 + #2 + Layer 3 all read from the new
  // `asset_feedback_events` table (or `commit_marketing_runs` for the
  // trend velocity pass). Each is independent — a failure in one
  // doesn't kill the others. The legacy aggregations above continue
  // to ship insights from the boolean `userApproved` data path.

  let layer1ApprovalCount = 0;
  let layer1TrendCount = 0;
  let layer3EditCount = 0;

  try {
    const recentEvents = await loadRecentFeedbackEvents();
    if (recentEvents.length > 0) {
      layer1ApprovalCount = await aggregateApprovalRateByType(recentEvents);
    }
  } catch (err) {
    console.warn(
      '[Cron:AggregateFeedbackInsights] Layer 1 approval-rate-by-type failed —',
      err instanceof Error ? err.message : String(err)
    );
  }

  try {
    layer1TrendCount = await aggregateTrendVelocityVsSuccess();
  } catch (err) {
    console.warn(
      '[Cron:AggregateFeedbackInsights] Layer 1 trend-velocity failed —',
      err instanceof Error ? err.message : String(err)
    );
  }

  try {
    layer3EditCount = await clusterEditFeedback();
  } catch (err) {
    console.warn(
      '[Cron:AggregateFeedbackInsights] Layer 3 edit clustering failed —',
      err instanceof Error ? err.message : String(err)
    );
  }

  console.log(
    `[Cron:AggregateFeedbackInsights] Generated/updated ${insightCount} legacy insights from ${projectsWithFeedback.length} projects, plus ${String(layer1ApprovalCount)} approval-rate-by-type, ${String(layer1TrendCount)} trend-velocity, ${String(layer3EditCount)} edit-pattern insights.`
  );
}

async function upsertInsight(data: {
  category: string;
  insight: string;
  confidence: number;
  sampleSize: number;
  // Phase 7: optional insight type so the dashboard can distinguish
  // approval-rate, tone, edit-frequency, edit-pattern, trend-velocity,
  // and approval-rate-by-type rows. Pre-Phase-7 rows have NULL here
  // and the dashboard treats them as legacy "general" insights.
  insightType?: string;
}): Promise<void> {
  // Check if a similar insight already exists
  const existing = await database.query.strategyInsights.findFirst({
    where: eq(schema.strategyInsights.category, data.category),
  });

  if (existing && existing.insight.includes(data.insight.split(' ').slice(0, 5).join(' '))) {
    // Update existing insight
    await database
      .update(schema.strategyInsights)
      .set({
        insight: data.insight,
        confidence: data.confidence,
        sampleSize: data.sampleSize,
        ...(data.insightType !== undefined ? { insightType: data.insightType } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.strategyInsights.id, existing.id));
  } else {
    // Insert new insight
    await database.insert(schema.strategyInsights).values({
      category: data.category,
      insight: data.insight,
      confidence: data.confidence,
      sampleSize: data.sampleSize,
      ...(data.insightType !== undefined ? { insightType: data.insightType } : {}),
    });
  }
}

// ── Phase 7: Layer 1 + Layer 3 extensions ─────────────────────────
//
// The original `aggregateFeedbackInsights` function above reads from
// `projects.assets.userApproved` (the boolean Phase 0 already had).
// Phase 7's new aggregations read from the richer `asset_feedback_events`
// event log (the producer ships in this same PR via the user-action
// route extensions in `apps/web/src/routes/asset-api-routes.ts`).
//
// The two data sources are intentionally complementary:
//
//   - The boolean (`assets.userApproved`) tells us "is this asset
//     approved RIGHT NOW" — used by the existing aggregations.
//   - The event log (`asset_feedback_events`) tells us "what actions
//     did the user take over time" — used by the new aggregations
//     for time-windowed analysis and (Layer 3) semantic clustering
//     of edit text.
//
// Both ship insights via `upsertInsight` with distinct `insightType`
// values so the dashboard can render them separately.

const FEEDBACK_WINDOW_DAYS = 30;
const LAYER3_MIN_CLUSTER_SIZE = 3;
const LAYER3_NEIGHBOR_COUNT = 3;

// Boundary-validation schema for the raw SQL JOIN row used by both
// Layer 1 (asset_type × category × approval_rate) and the Layer 3
// neighbor query.
const FeedbackJoinRowSchema = z.object({
  feedback_id: z.string().uuid(),
  asset_id: z.string().uuid(),
  asset_type: z.string().min(1),
  action: z.string().min(1),
  edit_text: z.string().nullable(),
  category: z.string().min(1),
});

// Layer 3 cluster row — adds a similarity-derived neighbor pivot.
const ClusterNeighborRowSchema = z.object({
  feedback_id: z.string().uuid(),
  neighbor_id: z.string().uuid(),
  similarity: z.coerce.number(),
});

interface FeedbackJoinRow {
  feedbackId: string;
  assetId: string;
  assetType: string;
  action: string;
  editText: string | null;
  category: string;
}

/**
 * Phase 7 Layer 1 #1: asset_type × category × approval_rate.
 *
 * Reads `asset_feedback_events` from the last N days, joins to
 * `assets` for the type and to `projects.repo_analysis` for the
 * category. Groups by `(asset_type, category)`, computes the rate
 * of `'approved'` actions over `'approved' + 'rejected'`, and
 * surfaces notable cells via `upsertInsight` with
 * `insight_type='approval_rate_by_type'`.
 */
async function aggregateApprovalRateByType(
  events: ReadonlyArray<FeedbackJoinRow>
): Promise<number> {
  let inserted = 0;

  // Group by (asset_type, category). Pivotal — only approved/rejected
  // events count toward the rate; edits and regenerations are
  // separate signals tracked in their own aggregations.
  const decisionEvents = events.filter(
    (e) => e.action === 'approved' || e.action === 'rejected'
  );
  const cellByKey = groupBy(
    decisionEvents,
    (e) => `${e.assetType}::${e.category}`
  );

  for (const [key, cellEvents] of Object.entries(cellByKey)) {
    if (cellEvents.length < 5) continue;

    const split = key.split('::');
    const assetType = split[0];
    const category = split[1];
    if (!assetType || !category) continue;

    const approved = cellEvents.filter((e) => e.action === 'approved').length;
    const approvalRate = approved / cellEvents.length;

    if (approvalRate < 0.4) {
      await upsertInsight({
        category,
        insight: `Layer 1 (${FEEDBACK_WINDOW_DAYS}d): users approve ${assetType} only ${Math.round(approvalRate * 100)}% of the time for ${category} projects (${String(cellEvents.length)} decisions). Consider revisiting the prompt or skipping this asset type.`,
        confidence: Math.min(cellEvents.length / 20, 1),
        sampleSize: cellEvents.length,
        insightType: 'approval_rate_by_type',
      });
      inserted++;
    } else if (approvalRate > 0.85) {
      await upsertInsight({
        category,
        insight: `Layer 1 (${FEEDBACK_WINDOW_DAYS}d): ${assetType} approval rate is ${Math.round(approvalRate * 100)}% for ${category} projects (${String(cellEvents.length)} decisions). Strong positive signal — keep current approach.`,
        confidence: Math.min(cellEvents.length / 20, 1),
        sampleSize: cellEvents.length,
        insightType: 'approval_rate_by_type',
      });
      inserted++;
    }
  }

  return inserted;
}

/**
 * Phase 7 Layer 1 #2: trend_velocity × asset_success.
 *
 * For each commit_marketing_runs row, compute the average velocity
 * of its `trends_used` jsonb snapshot AND the average quality score
 * of its referenced assets. Bucket runs into "high velocity" (>0.6)
 * vs "low velocity" and surface a per-category insight if the gap
 * in average asset quality is notable (>1.0 score points).
 */
async function aggregateTrendVelocityVsSuccess(): Promise<number> {
  // Read commit_marketing_runs joined to projects for category lookup.
  // Drizzle's typed query builder doesn't have a clean `JOIN ... ON`
  // for the asset_ids array unnest, so we use raw SQL with parameter
  // bindings. NO `sql.raw`.
  const since = new Date(
    Date.now() - FEEDBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  const RunRowSchema = z.object({
    project_id: z.string().uuid(),
    category: z.string().min(1),
    trends_used: z.unknown().nullable(),
    asset_quality_avg: z.coerce.number().nullable(),
  });

  const results = await database.execute(sql`
    SELECT
      cmr.project_id,
      p.repo_analysis ->> 'category' AS category,
      cmr.trends_used,
      (
        SELECT AVG(a.quality_score)::float8
        FROM assets a
        WHERE a.id = ANY(cmr.asset_ids)
          AND a.quality_score IS NOT NULL
      ) AS asset_quality_avg
    FROM commit_marketing_runs cmr
    JOIN projects p ON p.id = cmr.project_id
    WHERE cmr.created_at >= ${since}
      AND cmr.trends_used IS NOT NULL
      AND p.repo_analysis ->> 'category' IS NOT NULL
  `);

  const TrendSnapshotSchema = z.object({
    velocityScore: z.number(),
  });

  interface RunBucket {
    category: string;
    avgVelocity: number;
    qualityScore: number;
  }
  const buckets: RunBucket[] = [];

  for (const row of results.rows) {
    const parsed = RunRowSchema.safeParse(row);
    if (!parsed.success) continue;
    if (parsed.data.asset_quality_avg === null) continue;

    const trendsParsed = z
      .array(TrendSnapshotSchema)
      .safeParse(parsed.data.trends_used);
    if (!trendsParsed.success || trendsParsed.data.length === 0) continue;

    const avgVelocity = mean(trendsParsed.data.map((t) => t.velocityScore));

    buckets.push({
      category: parsed.data.category,
      avgVelocity,
      qualityScore: parsed.data.asset_quality_avg,
    });
  }

  // Group by category, then split into high/low velocity buckets.
  const byCategory = groupBy(buckets, (b) => b.category);
  let inserted = 0;

  for (const [category, categoryBuckets] of Object.entries(byCategory)) {
    if (categoryBuckets.length < 4) continue;

    const high = categoryBuckets.filter((b) => b.avgVelocity > 0.6);
    const low = categoryBuckets.filter((b) => b.avgVelocity <= 0.6);

    if (high.length < 2 || low.length < 2) continue;

    const highAvg = mean(high.map((b) => b.qualityScore));
    const lowAvg = mean(low.map((b) => b.qualityScore));
    const gap = highAvg - lowAvg;

    if (Math.abs(gap) >= 1.0) {
      const direction = gap > 0 ? 'higher' : 'lower';
      await upsertInsight({
        category,
        insight: `Layer 1 (${FEEDBACK_WINDOW_DAYS}d): commits marketed against high-velocity trends score ${gap.toFixed(1)} points ${direction} than low-velocity commits for ${category} projects (high avg ${highAvg.toFixed(1)}/10, low avg ${lowAvg.toFixed(1)}/10 across ${String(categoryBuckets.length)} runs).`,
        confidence: Math.min(categoryBuckets.length / 15, 1),
        sampleSize: categoryBuckets.length,
        insightType: 'trend_velocity',
      });
      inserted++;
    }
  }

  return inserted;
}

/**
 * Phase 7 Layer 3: semantic edit clustering via pgvector cosine
 * similarity over `asset_feedback_events.edit_embedding`.
 *
 * For each `(asset_type, category)` cell:
 *   1. Read the rows where `action='edited'` AND `edit_embedding IS
 *      NOT NULL` from the last N days.
 *   2. For each row, find its top-K nearest neighbors via the `<=>`
 *      operator. Group rows that share ≥2 mutual neighbors into a
 *      cluster (lightweight DBSCAN-style approach without the full
 *      library dependency).
 *   3. For clusters of ≥3 members, write a strategy_insights row
 *     with insight_type='edit_pattern' using the cluster's
 *     representative edit_text (the longest edit, as a proxy for
 *     "the most informative example") as the insight content.
 *
 * The per-cluster human-readable summary via Claude is documented as
 * a clean ~30-min follow-up — the cron service intentionally does not
 * carry an `ANTHROPIC_API_KEY` (per `apps/cron/src/env.ts:26-31`), so
 * adding a Claude call would require a render.yaml change. The
 * representative edit text is informative enough as a placeholder
 * and the upgrade path is documented in CLAUDE.md.
 */
async function clusterEditFeedback(): Promise<number> {
  // Read all feedback rows with embeddings from the last N days,
  // joined to assets for the type and projects for the category.
  // The raw SQL is parameterised — every value goes through the
  // template tag, no sql.raw.
  const sinceDays = FEEDBACK_WINDOW_DAYS;
  const allRows = await database.execute(sql`
    SELECT
      afe.id AS feedback_id,
      afe.asset_id,
      a.type AS asset_type,
      afe.action,
      afe.edit_text,
      p.repo_analysis ->> 'category' AS category
    FROM asset_feedback_events afe
    JOIN assets a ON a.id = afe.asset_id
    JOIN projects p ON p.id = a.project_id
    WHERE afe.action = 'edited'
      AND afe.edit_embedding IS NOT NULL
      AND afe.created_at >= now() - make_interval(days => ${sinceDays})
      AND p.repo_analysis ->> 'category' IS NOT NULL
  `);

  const validRows: FeedbackJoinRow[] = [];
  for (const row of allRows.rows) {
    const parsed = FeedbackJoinRowSchema.safeParse(row);
    if (!parsed.success) continue;
    validRows.push({
      feedbackId: parsed.data.feedback_id,
      assetId: parsed.data.asset_id,
      assetType: parsed.data.asset_type,
      action: parsed.data.action,
      editText: parsed.data.edit_text,
      category: parsed.data.category,
    });
  }

  // Group by (asset_type, category) cell — clustering is per-cell.
  const cellByKey = groupBy(
    validRows,
    (r) => `${r.assetType}::${r.category}`
  );

  let inserted = 0;

  for (const [key, cellRows] of Object.entries(cellByKey)) {
    if (cellRows.length < LAYER3_MIN_CLUSTER_SIZE) continue;

    const split = key.split('::');
    const assetType = split[0];
    const category = split[1];
    if (!assetType || !category) continue;

    // For each row in the cell, find its top-K nearest neighbors
    // via pgvector cosine distance. Restricting the neighbor pool
    // to the same cell keeps cross-cell noise out of the clusters.
    const cellIds = cellRows.map((r) => r.feedbackId);
    const neighborResults = await database.execute(sql`
      WITH cell AS (
        SELECT id, edit_embedding
        FROM asset_feedback_events
        WHERE id = ANY(${cellIds}::uuid[])
      )
      SELECT
        a.id AS feedback_id,
        b.id AS neighbor_id,
        1 - (a.edit_embedding <=> b.edit_embedding) AS similarity
      FROM cell a
      CROSS JOIN cell b
      WHERE a.id <> b.id
        AND 1 - (a.edit_embedding <=> b.edit_embedding) >= 0.7
      ORDER BY a.id, similarity DESC
    `);

    // Build adjacency list: feedbackId → set of neighborIds.
    const neighborhood = new Map<string, Set<string>>();
    for (const row of neighborResults.rows) {
      const parsed = ClusterNeighborRowSchema.safeParse(row);
      if (!parsed.success) continue;

      const existing = neighborhood.get(parsed.data.feedback_id);
      if (existing) {
        if (existing.size < LAYER3_NEIGHBOR_COUNT) {
          existing.add(parsed.data.neighbor_id);
        }
      } else {
        neighborhood.set(
          parsed.data.feedback_id,
          new Set([parsed.data.neighbor_id])
        );
      }
    }

    // Cluster via union-find over the shared-neighbor relation. Two
    // rows belong to the same cluster if they either (a) share ≥2
    // mutual top-K neighbors, or (b) one is a direct neighbor of the
    // other. The relation is symmetric AND transitive — pair (A, B)
    // and pair (B, C) put A, B, and C in the same cluster even when
    // (A, C) does not directly share enough neighbors.
    //
    // Lightweight alternative to importing a full clustering library.
    // The previous implementation iterated cellIds in order, picked
    // each unvisited row as a "seed" and pulled in only its direct
    // neighbors — that produced wrong cluster membership when the
    // best matching pair happened to be visited by an earlier seed.
    // The union-find pass below is order-independent and correct.
    const parent = new Map<string, string>();
    for (const id of cellIds) {
      parent.set(id, id);
    }

    function find(x: string): string {
      let current = x;
      // Walk to the root.
      let next = parent.get(current);
      while (next !== undefined && next !== current) {
        current = next;
        next = parent.get(current);
      }
      // Path compression: re-point every node on the walk to the
      // root so future find() calls are O(1).
      let walker = x;
      let walkerNext = parent.get(walker);
      while (walkerNext !== undefined && walkerNext !== current) {
        parent.set(walker, current);
        walker = walkerNext;
        walkerNext = parent.get(walker);
      }
      return current;
    }

    function union(a: string, b: string): void {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) {
        parent.set(rootA, rootB);
      }
    }

    // O(N²) pair scan — fine because each cell has at most a few
    // hundred rows (the per-cell `(asset_type, category)` filter
    // bounds the size). The neighborhood map already capped the
    // top-K, so the inner shared-neighbor count is constant time.
    for (let i = 0; i < cellIds.length; i++) {
      const a = cellIds[i];
      if (a === undefined) continue;
      const aNeighbors = neighborhood.get(a) ?? new Set<string>();

      for (let j = i + 1; j < cellIds.length; j++) {
        const b = cellIds[j];
        if (b === undefined) continue;
        const bNeighbors = neighborhood.get(b) ?? new Set<string>();

        // Direct neighbor (either direction) joins the cluster
        // unconditionally — the SQL already filtered to similarity
        // ≥ 0.7 so a direct neighbor is meaningful.
        if (aNeighbors.has(b) || bNeighbors.has(a)) {
          union(a, b);
          continue;
        }

        // Otherwise require ≥2 shared mutual top-K neighbors.
        let shared = 0;
        for (const n of aNeighbors) {
          if (bNeighbors.has(n)) shared++;
        }
        if (shared >= 2) {
          union(a, b);
        }
      }
    }

    // Group by root.
    const clustersByRoot = new Map<string, string[]>();
    for (const id of cellIds) {
      const root = find(id);
      const existing = clustersByRoot.get(root);
      if (existing) {
        existing.push(id);
      } else {
        clustersByRoot.set(root, [id]);
      }
    }

    const clusters: string[][] = [];
    for (const cluster of clustersByRoot.values()) {
      if (cluster.length >= LAYER3_MIN_CLUSTER_SIZE) {
        clusters.push(cluster);
      }
    }

    // Emit one insight per cluster. The representative edit_text is
    // the longest edit in the cluster — as a proxy for "the most
    // informative example." A future PR replaces this with a Claude-
    // generated one-sentence summary (see CLAUDE.md forward-compat
    // note for the upgrade path).
    for (const cluster of clusters) {
      const clusterRows = cellRows.filter((r) =>
        cluster.includes(r.feedbackId)
      );
      const representative = clusterRows
        .map((r) => r.editText)
        .filter((t): t is string => t !== null && t.length > 0)
        .sort((a, b) => b.length - a.length)[0];

      if (!representative) continue;

      const truncated =
        representative.length > 240
          ? `${representative.slice(0, 237)}...`
          : representative;

      await upsertInsight({
        category,
        insight: `Layer 3 edit pattern (${assetType}, ${String(cluster.length)} similar edits): "${truncated}"`,
        confidence: Math.min(cluster.length / 8, 1),
        sampleSize: cluster.length,
        insightType: 'edit_pattern',
      });
      inserted++;
    }
  }

  return inserted;
}

/**
 * Read every `asset_feedback_events` row from the last N days joined
 * to its asset and project category. Returned shape is a flat list
 * the new aggregators iterate over multiple times.
 *
 * The raw SQL is parameterised through the `sql` template tag — no
 * `sql.raw`. Rows are Zod-validated at the boundary so a malformed
 * row never leaks typed properties into the aggregation logic.
 */
async function loadRecentFeedbackEvents(): Promise<FeedbackJoinRow[]> {
  const sinceDays = FEEDBACK_WINDOW_DAYS;
  const results = await database.execute(sql`
    SELECT
      afe.id AS feedback_id,
      afe.asset_id,
      a.type AS asset_type,
      afe.action,
      afe.edit_text,
      p.repo_analysis ->> 'category' AS category
    FROM asset_feedback_events afe
    JOIN assets a ON a.id = afe.asset_id
    JOIN projects p ON p.id = a.project_id
    WHERE afe.created_at >= now() - make_interval(days => ${sinceDays})
      AND p.repo_analysis ->> 'category' IS NOT NULL
  `);

  const out: FeedbackJoinRow[] = [];
  for (const row of results.rows) {
    const parsed = FeedbackJoinRowSchema.safeParse(row);
    if (!parsed.success) continue;
    out.push({
      feedbackId: parsed.data.feedback_id,
      assetId: parsed.data.asset_id,
      assetType: parsed.data.asset_type,
      action: parsed.data.action,
      editText: parsed.data.edit_text,
      category: parsed.data.category,
    });
  }
  return out;
}
