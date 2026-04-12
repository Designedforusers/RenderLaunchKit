import { eq, sql } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  GitHubWebhookPayloadSchema,
  parseJsonbColumn,
  RepoAnalysisSchema,
  StrategyBriefSchema,
  type AssetType,
  type FilterWebhookJobData,
  type TrendUsedSnapshot,
} from '@launchkit/shared';
import { evaluateCommitMarketability } from '../agents/commit-marketability-agent.js';
import { database as db } from '../lib/database.js';
import { checkCommitDuplication } from '../lib/duplication-guard.js';
import { findRelevantTrendsForCommit } from '../lib/trend-matcher.js';
import { triggerWorkflowGeneration } from '../lib/trigger-workflow-generation.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';
import {
  generateVoyageEmbedding,
  VoyageEmbeddingError,
} from '../lib/voyage-embeddings.js';
import { env } from '../env.js';

/**
 * Phase 6 — Commit marketing run pipeline.
 *
 * Replaces the legacy `process-webhook-regeneration.ts`. When a GitHub
 * webhook fires for a project that has already shipped a launch kit:
 *
 *   1. Voyage-embed the commit context (message + changed file paths
 *      from the GitHub payload) and persist to
 *      `webhook_events.diff_embedding`.
 *   2. Run the duplication guard against the last 7 days of
 *      `commit_marketing_runs` for the same project. Strict reject on
 *      cosine similarity ≥ 0.85 — the webhook event row stays for
 *      audit but no commit_marketing_runs row is created.
 *   3. Find the top 5 relevant trends for the project's category via
 *      the `trend-matcher.ts` helper.
 *   4. Call the `commit-marketability-agent` with the trends in scope.
 *      The agent decides whether the commit is worth regenerating
 *      content for.
 *   5. CREATE the `commit_marketing_runs` row with status='pending'.
 *   6. Re-version + queue per-asset regeneration (preserves the legacy
 *      behaviour exactly: same idempotency key shape, same generation
 *      job payload).
 *   7. Update the `commit_marketing_runs` row with status='generating',
 *      the trends snapshot, and the asset id list.
 *   8. Update project status, webhook event flags, post progress.
 *
 * Pure orchestration — every helper is independently testable; this
 * file is procedural by design.
 */

// ── Constants ─────────────────────────────────────────────────────

const TREND_MATCHER_LIMIT = 5;
const DIFF_PATH_CAP = 30;

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Compose the diff context text the duplication guard + trend matcher
 * embed. Reads `commit_message + changed file paths` from the GitHub
 * push payload, or `release name + body` for release events.
 *
 * Caps the file path list at 30 entries to keep the embedding input
 * bounded — large changesets contribute their first 30 paths and the
 * rest are dropped. The 30-cap is conservative enough that the embed
 * never exceeds Voyage's input limit.
 */
function composeCommitContextText(
  payload: schema.GitHubWebhookPayload,
  fallbackMessage: string
): string {
  // Push event: message + changed file paths
  if (payload.head_commit) {
    const message = payload.head_commit.message;
    const allFiles = [
      ...(payload.head_commit.added ?? []),
      ...(payload.head_commit.modified ?? []),
      ...(payload.head_commit.removed ?? []),
    ];
    const cappedFiles = allFiles.slice(0, DIFF_PATH_CAP);
    if (cappedFiles.length === 0) {
      return message;
    }
    return `${message}\n\nFiles:\n${cappedFiles.map((p) => `- ${p}`).join('\n')}`;
  }

  // Release event: name + body
  if (payload.release) {
    const name = payload.release.name ?? payload.release.tag_name ?? 'Release';
    const body = payload.release.body ?? '';
    return `${name}\n\n${body}`.trim();
  }

  // Fall back to the persisted commit message
  return fallbackMessage;
}

/**
 * Compute and persist the diff embedding for a webhook event. Soft-fails
 * to `null` when Voyage isn't configured — the rest of the processor
 * still runs but skips the duplication guard branch.
 */
async function computeAndStoreDiffEmbedding(
  webhookEventId: string,
  contextText: string
): Promise<number[] | null> {
  if (!env.VOYAGE_API_KEY) {
    console.warn(
      '[process-commit-marketing-run] VOYAGE_API_KEY not set — skipping diff embedding'
    );
    return null;
  }

  let embedding: number[];
  try {
    embedding = await generateVoyageEmbedding(contextText, {
      inputType: 'document',
    });
  } catch (err) {
    if (err instanceof VoyageEmbeddingError) {
      // Voyage is configured but failed (rate limit, network, etc.).
      // Log loudly so the operator notices, but still let the rest of
      // the processor run — the duplication guard becomes a no-op for
      // this commit and the marketability agent still fires.
      console.error(
        '[process-commit-marketing-run] Voyage diff embed failed:',
        err.message
      );
      return null;
    }
    throw err;
  }

  const vectorStr = `[${embedding.join(',')}]`;
  await db.execute(sql`
    UPDATE webhook_events
    SET diff_embedding = ${vectorStr}::vector
    WHERE id = ${webhookEventId}
  `);

  return embedding;
}

/**
 * Build the asset-side `generationInstructions` string for the
 * regeneration job, mirroring the legacy `buildWebhookGenerationInstructions`
 * helper. Adds a "Why it matters" line that carries the marketability
 * agent's reasoning so the writer agent can reference the commit's
 * significance in its output.
 */
function buildRegenerationInstructions(
  assetType: AssetType,
  existingGenerationInstructions: string | undefined,
  eventType: string,
  commitMessage: string,
  reasoning: string
): string {
  const prefix =
    eventType === 'release'
      ? 'Refresh this asset for the new release.'
      : 'Refresh this asset to reflect the latest product update.';

  return [
    prefix,
    existingGenerationInstructions ?? `Generate a ${assetType} for this product.`,
    `GitHub event: ${eventType}.`,
    `Commit summary: ${commitMessage}.`,
    `Why it matters: ${reasoning}.`,
  ].join(' ');
}

// ── Main entry point ──────────────────────────────────────────────

export async function processCommitMarketingRun(
  data: FilterWebhookJobData
): Promise<void> {
  const { projectId, webhookEventId } = data;

  // Step 1: Load the project + webhook event. Same shape as the legacy
  // processor.
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    with: { assets: true },
  });

  const webhookEvent = await db.query.webhookEvents.findFirst({
    where: eq(schema.webhookEvents.id, webhookEventId),
  });

  if (!project || !project.repoAnalysis || !project.research || !project.strategy) {
    throw new Error(`Project ${projectId} is not ready for webhook filtering`);
  }
  if (!webhookEvent) {
    throw new Error(`Webhook event ${webhookEventId} not found`);
  }

  // Step 2: Guard — project must have at least one asset.
  const availableAssets = project.assets.map((asset) => asset.type);
  if (availableAssets.length === 0) {
    await db
      .update(schema.webhookEvents)
      .set({
        isMarketable: false,
        filterReasoning:
          'No existing assets are available to regenerate for this project.',
      })
      .where(eq(schema.webhookEvents.id, webhookEvent.id));
    return;
  }

  // Step 3: Parse the persisted jsonb columns through their canonical
  // schemas. Same boundary-validation discipline as the legacy
  // processor — a stale row with a wrong shape fails fast with a
  // structured Zod error naming the field.
  //
  // `research` used to be parsed here as well so the processor could
  // bundle it into the BullMQ generation payload. Phase 10 moved
  // generation to Render Workflows; the workflow tasks re-read the
  // jsonb columns from the DB at run time via `parseJsonbColumn`, so
  // the processor no longer needs to parse or ship `research` itself.
  const repoAnalysis = parseJsonbColumn(
    RepoAnalysisSchema,
    project.repoAnalysis,
    'project.repo_analysis'
  );
  const strategy = parseJsonbColumn(
    StrategyBriefSchema,
    project.strategy,
    'project.strategy'
  );
  const githubPayload = parseJsonbColumn(
    GitHubWebhookPayloadSchema,
    webhookEvent.payload,
    'webhook_events.payload'
  );

  const commitMessage = webhookEvent.commitMessage ?? 'No commit message provided';

  // Step 4: Compose the commit context text and compute its diff
  // embedding. Persists to `webhook_events.diff_embedding` so the
  // duplication guard can find this commit on future runs. Soft-fails
  // to null when Voyage is unavailable — the rest of the processor
  // still runs.
  const contextText = composeCommitContextText(githubPayload, commitMessage);
  const diffEmbedding = await computeAndStoreDiffEmbedding(
    webhookEvent.id,
    contextText
  );

  // Step 5: Duplication guard. Strict reject on similarity ≥ 0.85 to
  // a commit_marketing_runs row in the last 7 days for the same
  // project. The webhook event row stays for audit; no
  // commit_marketing_runs row is created.
  if (diffEmbedding !== null) {
    const dupCheck = await checkCommitDuplication({
      projectId,
      diffEmbedding,
    });
    if (dupCheck.duplicate) {
      const reason = `Duplicate of commit ${dupCheck.similar.commitSha} from ${String(dupCheck.similar.daysAgo)} days ago (similarity ${dupCheck.similar.similarity.toFixed(2)}).`;
      await db
        .update(schema.webhookEvents)
        .set({ isMarketable: false, filterReasoning: reason })
        .where(eq(schema.webhookEvents.id, webhookEvent.id));
      await projectProgressPublisher.statusUpdate(projectId, 'complete', reason);
      return;
    }
  }

  // Step 6: Find the top trends for the project's category. The
  // matcher re-throws `VoyageEmbeddingError` so a missing API key
  // surfaces loudly to the developer; the processor catches it here
  // and falls through to an empty trends array so a transient Voyage
  // failure does not crash the entire commit-marketing-run pipeline.
  // Same posture as the diff-embedding step at lines 142-168.
  let matchedTrends: Awaited<ReturnType<typeof findRelevantTrendsForCommit>> = [];
  try {
    matchedTrends = await findRelevantTrendsForCommit({
      category: repoAnalysis.category,
      contextText,
      limit: TREND_MATCHER_LIMIT,
    });
  } catch (err) {
    console.warn(
      '[process-commit-marketing-run] trend matcher failed —',
      err instanceof Error ? err.message : String(err)
    );
  }

  // Step 7: Marketability decision. The renamed agent now accepts the
  // matched trends as an optional input.
  const decision = await evaluateCommitMarketability({
    eventType: webhookEvent.eventType,
    commitMessage,
    commitSha: webhookEvent.commitSha,
    repoAnalysis,
    strategy,
    availableAssets,
    relevantTrends: matchedTrends.map((t) => ({
      topic: t.topic,
      headline: t.headline,
      velocityScore: t.velocityScore,
    })),
  });

  await db
    .update(schema.webhookEvents)
    .set({
      isMarketable: decision.isMarketable,
      filterReasoning: decision.reasoning,
    })
    .where(eq(schema.webhookEvents.id, webhookEvent.id));

  if (!decision.isMarketable || decision.assetTypes.length === 0) {
    await projectProgressPublisher.statusUpdate(
      projectId,
      'complete',
      `Skipped regeneration for webhook event: ${decision.reasoning}`
    );
    return;
  }

  // Step 8: CREATE the commit_marketing_runs row with status='pending'.
  const trendsUsed: TrendUsedSnapshot[] = matchedTrends.map((t) => ({
    trendSignalId: t.id,
    topic: t.topic,
    source: t.source,
    velocityScore: t.velocityScore,
    relevanceScore: t.similarity,
  }));

  // The `commit_marketing_runs.commit_sha` column is NOT NULL but
  // `webhook_events.commit_sha` is nullable — the webhook route
  // populates it from `event.after` for push events and
  // `event.release.tag_name` for releases, so it should never be
  // null in practice. The defensive surrogate uses `webhook_event_id`
  // as a stable non-empty fallback. An empty string would survive
  // the insert (no DB constraint) but would later poison the
  // duplication guard's row schema parse.
  const persistedCommitSha = webhookEvent.commitSha ?? `evt_${webhookEvent.id}`;

  const [commitRun] = await db
    .insert(schema.commitMarketingRuns)
    .values({
      projectId,
      webhookEventId: webhookEvent.id,
      commitSha: persistedCommitSha,
      commitMessage,
      trendsUsed,
      status: 'pending',
    })
    .returning({ id: schema.commitMarketingRuns.id });

  if (!commitRun) {
    throw new Error(
      `[process-commit-marketing-run] commit_marketing_runs insert returned no row for project ${projectId}`
    );
  }

  // Step 9: Asset regeneration fan-out. Flip every asset the
  // commit-marketability decision picked back to `status='queued'`,
  // then trigger a workflow run; the parent task picks them up on
  // its next iteration and dispatches via the five child tasks.
  //
  // Previously this processor pulled `getInsightsForCategory(...)`
  // here to bundle `pastInsights` into the BullMQ payload. The
  // workflow tasks re-read insights from the DB inside
  // `dispatchAsset`, so the lookup is no longer needed on this path.
  const assetsToRegenerate = project.assets.filter((asset) =>
    decision.assetTypes.includes(asset.type)
  );

  if (assetsToRegenerate.length === 0) {
    // The marketability decision passed but the available-assets filter
    // produced an empty list (e.g. the agent picked types that don't
    // exist on this project). Mark the run failed and bail.
    await db
      .update(schema.commitMarketingRuns)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(schema.commitMarketingRuns.id, commitRun.id));
    await db
      .update(schema.webhookEvents)
      .set({
        isMarketable: false,
        filterReasoning:
          'The event was relevant, but there were no matching assets to refresh.',
      })
      .where(eq(schema.webhookEvents.id, webhookEvent.id));
    return;
  }

  // Rewrite each asset's metadata with the fresh commit-aware
  // generation instructions and flip the row back to `queued`. The
  // workflow parent task picks up every queued asset on the project
  // on its next run and dispatches each one through the right child
  // task.
  //
  // Two columns carry context across the re-queue handoff:
  //
  //   `metadata.generationInstructions` — the "original brief" for the
  //     asset, rewritten here to include the commit context so the
  //     next agent run has the full story (purpose + latest change).
  //     Kept on metadata because the legacy BullMQ path did the same,
  //     and the workflow path's `dispatchAsset` already falls through
  //     to the metadata field for first-pass generations.
  //
  //   `revisionInstructions` — the agent-facing "here's what to
  //     change" overlay. Written here with the commit sha + message
  //     as revision context; `dispatchAsset` reads this column on
  //     re-dispatch and passes it through to the writer /
  //     marketing-visual / product-video agents as the explicit
  //     revision prompt.
  //
  // `reviewNotes` is explicitly cleared on this path: a webhook-driven
  // refresh is not creative-director feedback, and leaving a stale
  // review note attached would confuse the dashboard. A fresh review
  // runs after this regeneration completes and writes a new note then.
  let requeuedCount = 0;
  for (const asset of assetsToRegenerate) {
    const assetMetadata = (asset.metadata as Record<string, unknown> | null) ?? {};
    const existingGenerationInstructions =
      typeof assetMetadata['generationInstructions'] === 'string'
        ? assetMetadata['generationInstructions']
        : undefined;

    const freshGenerationInstructions = buildRegenerationInstructions(
      asset.type,
      existingGenerationInstructions,
      webhookEvent.eventType,
      commitMessage,
      decision.reasoning
    );

    const nextMetadata: Record<string, unknown> = {
      ...assetMetadata,
      generationInstructions: freshGenerationInstructions,
    };

    const commitRevisionContext = `Refresh this asset for commit ${webhookEvent.commitSha ?? 'unknown'}: ${commitMessage}`;

    await db
      .update(schema.assets)
      .set({
        status: 'queued',
        userApproved: null,
        reviewNotes: null,
        revisionInstructions: commitRevisionContext,
        qualityScore: null,
        renderedVideoUrl: null,
        renderedVideoKey: null,
        metadata: nextMetadata,
        version: asset.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, asset.id));
    requeuedCount += 1;
  }

  // Single workflow run covers every just-re-queued asset — the
  // parent task reads `status='queued'` and fans out to the five
  // compute-profile child tasks via run chaining. No per-asset
  // enqueue loop needed anymore.
  if (requeuedCount > 0) {
    await triggerWorkflowGeneration(projectId);
  }

  // Step 10: Finalize the commit_marketing_runs row with the
  // asset id list, and update project / webhook flags.
  await db
    .update(schema.commitMarketingRuns)
    .set({
      status: 'generating',
      assetIds: assetsToRegenerate.map((a) => a.id),
      updatedAt: new Date(),
    })
    .where(eq(schema.commitMarketingRuns.id, commitRun.id));

  await db
    .update(schema.projects)
    .set({
      status: 'generating',
      lastCommitSha: webhookEvent.commitSha ?? project.lastCommitSha,
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  await db
    .update(schema.webhookEvents)
    .set({ triggeredGeneration: true })
    .where(eq(schema.webhookEvents.id, webhookEvent.id));

  await projectProgressPublisher.statusUpdate(
    projectId,
    'generating',
    `Webhook-triggered refresh queued for ${String(assetsToRegenerate.length)} assets.`
  );
}
