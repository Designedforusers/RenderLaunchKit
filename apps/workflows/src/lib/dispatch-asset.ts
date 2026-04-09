import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  parseJsonbColumn,
  RepoAnalysisSchema,
  ResearchResultSchema,
  StrategyBriefSchema,
} from '@launchkit/shared';
import type { AssetType } from '@launchkit/shared';
import { CostTracker, runWithCostTracker } from '@launchkit/asset-generators';
import { database as db } from './database.js';
import { projectProgressPublisher } from './project-progress-publisher.js';
import { assetGenerators } from './asset-generators-instance.js';
import { getInsightsForCategory } from './project-insight-memory.js';
import { persistCostEvents } from './persist-cost-events.js';

/**
 * Core dispatch function for a single asset generation.
 *
 * Entered from every child task in `apps/workflows/src/tasks/` after
 * the task's Zod input parse. Responsible for loading project
 * context from the DB, routing to the right agent in
 * `assetGenerators`, persisting the generated content, and
 * publishing progress events.
 *
 * Design notes:
 *
 *   1. **Context is re-read from the DB at run time.** Each task
 *      takes only `{ projectId, assetId }` and re-reads `repoAnalysis`,
 *      `research`, `strategy`, and `strategy_insights` rows. Keeps
 *      task inputs tiny, avoids drift between enqueue-time and
 *      run-time payloads, and makes retries naturally idempotent.
 *
 *   2. **Per-task scope validation.** The caller passes
 *      `allowedTypes` — the subset of asset types the calling task
 *      is allowed to handle. If the asset's actual type is outside
 *      that subset, we throw before doing any work. This is the
 *      safety net against a routing bug in `generateAllAssetsForProject`
 *      accidentally landing a 10-minute video render on a starter
 *      instance sized for a 20-second blog post.
 *
 *   3. **Dashboard parity.** Every update to the `assets` row and
 *      every `projectProgressPublisher` call matches the shape the
 *      web service's SSE subscription already consumes — the
 *      dashboard does not need to change to support this path.
 */

export interface DispatchAssetInput {
  projectId: string;
  assetId: string;
  allowedTypes: readonly AssetType[];
}

/**
 * Runs the agent for a single asset and persists the result.
 *
 * Throws if:
 *   - The asset row is not found (bad caller).
 *   - The project row is not found or is missing required context
 *     (bad caller or DB corruption).
 *   - The asset's type is outside the caller's `allowedTypes` (routing
 *     bug in the parent task).
 *   - The underlying agent throws (upstream API failure, schema
 *     mismatch, timeout). On agent failures we also mark the asset as
 *     `failed` in the DB and emit an error progress event before
 *     re-throwing, so the workflow run's failure telemetry matches
 *     the asset's terminal state.
 */
export async function dispatchAsset(input: DispatchAssetInput): Promise<void> {
  const { projectId, assetId, allowedTypes } = input;

  // ── Load the asset row (for type, metadata, generation instructions)
  const asset = await db.query.assets.findFirst({
    where: eq(schema.assets.id, assetId),
  });
  if (!asset) {
    throw new Error(`dispatchAsset: asset ${assetId} not found`);
  }
  if (asset.projectId !== projectId) {
    throw new Error(
      `dispatchAsset: asset ${assetId} belongs to project ${asset.projectId}, not ${projectId}`
    );
  }

  // Scope guard — protects against a routing bug in the parent task
  // landing an expensive asset type on an undersized instance.
  if (!allowedTypes.includes(asset.type)) {
    throw new Error(
      `dispatchAsset: asset ${assetId} has type "${asset.type}" which is not in the allowed set [${allowedTypes.join(', ')}] for this task`
    );
  }

  // ── Load the project row for repoAnalysis, research, strategy, repoName
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });
  if (
    !project ||
    !project.strategy ||
    !project.repoAnalysis ||
    !project.research
  ) {
    throw new Error(
      `dispatchAsset: project ${projectId} not ready for generation (missing strategy / repo analysis / research)`
    );
  }

  const repoAnalysis = parseJsonbColumn(
    RepoAnalysisSchema,
    project.repoAnalysis,
    'project.repo_analysis'
  );
  const research = parseJsonbColumn(
    ResearchResultSchema,
    project.research,
    'project.research'
  );
  const strategy = parseJsonbColumn(
    StrategyBriefSchema,
    project.strategy,
    'project.strategy'
  );

  const pastInsights = await getInsightsForCategory(repoAnalysis.category);

  // Pull generation instructions off the asset metadata. The
  // strategist persists this on each asset row at the end of its
  // phase; revision paths (creative review, commit marketing, user
  // regen) update it in place before flipping the asset back to
  // `queued` for the workflow parent task to re-dispatch.
  const assetMetadata = (asset.metadata as Record<string, unknown> | null) ?? {};
  const generationInstructions =
    (typeof assetMetadata['generationInstructions'] === 'string'
      ? assetMetadata['generationInstructions']
      : null) ??
    (typeof assetMetadata['brief'] === 'string'
      ? assetMetadata['brief']
      : null) ??
    `Generate a ${asset.type} for this product`;

  // Revision instructions live in a dedicated `revision_instructions`
  // column on the asset row, populated by the three re-queue paths
  // before the asset is flipped back to `queued`:
  //
  //   1. Creative review rejection in `apps/worker/src/processors/
  //      review-generated-assets.ts` — writes the reviewer's issues +
  //      explicit revision instructions.
  //   2. Commit-marketing refresh in `apps/worker/src/processors/
  //      process-commit-marketing-run.ts` — writes the commit sha +
  //      message as revision context for a webhook-driven refresh.
  //   3. User-driven regenerate in `apps/web/src/routes/
  //      asset-api-routes.ts` — writes the `body.instructions` the
  //      caller passed to POST /api/assets/:id/regenerate.
  //
  // First-pass generations leave the column null and no revision
  // overlay is passed to the agents.
  //
  // Why this is separate from `asset.reviewNotes`: `reviewNotes` is
  // the human-readable feedback string the dashboard renders under
  // "Review feedback" — display-only. Writing the agent-facing
  // revision prompt to the same column was the semantic overlap
  // PR #33's code-reviewer flagged: a commit-driven refresh is not
  // review feedback, and bleeding prompt fragments into the UI is
  // the wrong abstraction.
  const revisionInstructions =
    asset.revisionInstructions !== null && asset.revisionInstructions.length > 0
      ? asset.revisionInstructions
      : undefined;

  // ── Mark the asset as generating and publish a progress update
  await db
    .update(schema.assets)
    .set({ status: 'generating', updatedAt: new Date() })
    .where(eq(schema.assets.id, assetId));

  await projectProgressPublisher.statusUpdate(
    projectId,
    'generating',
    `Generating ${asset.type}`
  );

  // ── Cost tracking scope ──
  //
  // Every upstream API call inside the agent routing switch records
  // its cost into the tracker via `recordCost(...)` which reads the
  // tracker from `AsyncLocalStorage`. The tracker is created here
  // (one per asset generation) and flushed to `asset_cost_events`
  // below via `persistCostEvents` — on BOTH the success and error
  // paths, because upstream calls that succeeded before a later
  // failure still cost us money and the operator should see them.
  //
  // The persist helper is strictly non-blocking: a DB error inside
  // `persistCostEvents` logs and returns without throwing, so a
  // successful asset generation never fails because of a cost write
  // hiccup. The error path's persist call is additionally wrapped in
  // its own try/catch so even a hypothetical throw from the helper
  // cannot mask the original agent error.
  const costTracker = new CostTracker();
  const assetType = asset.type;

  try {
    let content: string | null = null;
    let mediaUrl: string | null = null;
    let metadata: Record<string, unknown> = {};

    await runWithCostTracker(costTracker, async () => {
      if (assetType === 'og_image' || assetType === 'social_card') {
        const result = await assetGenerators.generateMarketingImageAsset({
          repoAnalysis,
          research,
          strategy,
          assetType,
          generationInstructions,
        });
        mediaUrl = result.url;
        metadata = {
          ...result.metadata,
          prompt: result.prompt,
          style: result.style,
        };
      } else if (assetType === 'product_video') {
        const result = await assetGenerators.generateProductVideoAsset({
          repoName: project.repoName,
          repoAnalysis,
          research,
          strategy,
          generationInstructions,
        });
        mediaUrl = result.videoUrl;
        metadata = {
          ...result.metadata,
          thumbnailUrl: result.thumbnailUrl,
          storyboard: result.storyboard,
        };
      } else if (assetType === 'video_storyboard') {
        const result = await assetGenerators.generateVideoStoryboardAsset({
          repoName: project.repoName,
          repoAnalysis,
          research,
          strategy,
          generationInstructions,
        });
        content = JSON.stringify(result.storyboard, null, 2);
        metadata = {
          ...result.metadata,
          thumbnailUrl: result.thumbnailUrl,
          storyboard: result.storyboard,
        };
      } else if (assetType === 'voice_commercial') {
        const result = await assetGenerators.generateVoiceCommercialAsset({
          assetId,
          repoName: project.repoName,
          repoAnalysis,
          research,
          strategy,
          pastInsights,
          generationInstructions,
          ...(revisionInstructions !== undefined
            ? { revisionInstructions }
            : {}),
        });
        content = result.script;
        mediaUrl = `/api/assets/${assetId}/audio.mp3`;
        metadata = result.metadata;
      } else if (assetType === 'podcast_script') {
        const result = await assetGenerators.generatePodcastScriptAsset({
          assetId,
          repoName: project.repoName,
          repoAnalysis,
          research,
          strategy,
          pastInsights,
          generationInstructions,
          ...(revisionInstructions !== undefined
            ? { revisionInstructions }
            : {}),
        });
        content = result.script;
        mediaUrl = `/api/assets/${assetId}/audio.mp3`;
        metadata = result.metadata;
      } else if (assetType === 'world_scene') {
        const result = await assetGenerators.generateWorldSceneAsset({
          repoName: project.repoName,
          repoAnalysis,
          research,
          strategy,
          generationInstructions,
        });
        content = result.prompt;
        mediaUrl = result.marbleUrl;
        metadata = result.metadata;
      } else {
        // All nine text asset types route through the writer agent.
        const result = await assetGenerators.generateWrittenAsset({
          repoAnalysis,
          research,
          strategy,
          pastInsights,
          assetType,
          generationInstructions,
          ...(revisionInstructions !== undefined
            ? { revisionInstructions }
            : {}),
        });
        content = result.content;
        metadata = result.metadata;
      }
    });

    // ── Persist the generated content and flip status to reviewing
    await db
      .update(schema.assets)
      .set({
        content,
        mediaUrl,
        metadata: {
          ...metadata,
          generationInstructions,
        },
        status: 'reviewing',
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, assetId));

    // Flush the recorded cost events to `asset_cost_events` and
    // update the denormalized summary on the asset row. The helper
    // is non-throwing by design — a failure here logs and continues
    // without rolling back the generation success above.
    await persistCostEvents({
      assetId,
      projectId,
      events: costTracker.getEvents(),
      totalCents: costTracker.totalCents(),
    });

    await projectProgressPublisher.assetReady(projectId, assetId, assetType);

    console.log(
      `[Workflows:Dispatch] ${assetType} complete for project ${projectId}`
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Persist any partial cost events captured before the failure —
    // upstream calls that succeeded before the agent threw still
    // cost us money and the operator should see them on the
    // dashboard. The extra try/catch is a belt-and-braces guard
    // against a hypothetical throw from `persistCostEvents`; the
    // helper already swallows DB errors internally.
    const partialEvents = costTracker.getEvents();
    if (partialEvents.length > 0) {
      try {
        await persistCostEvents({
          assetId,
          projectId,
          events: partialEvents,
          totalCents: costTracker.totalCents(),
        });
      } catch (persistErr) {
        console.error(
          '[Workflows:Dispatch] cost persist failed on error path:',
          persistErr instanceof Error
            ? persistErr.message
            : String(persistErr)
        );
      }
    }

    await db
      .update(schema.assets)
      .set({
        status: 'failed',
        metadata: { error: errorMessage },
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, assetId));

    await projectProgressPublisher.error(
      projectId,
      'generation',
      `Failed to generate ${asset.type}: ${errorMessage}`
    );

    throw err;
  }
}
