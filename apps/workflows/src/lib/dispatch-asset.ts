import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  parseJsonbColumn,
  RepoAnalysisSchema,
  ResearchResultSchema,
  StrategyBriefSchema,
} from '@launchkit/shared';
import type { AssetType } from '@launchkit/shared';
import { database as db } from './database.js';
import { projectProgressPublisher } from './project-progress-publisher.js';
import { assetGenerators } from './asset-generators-instance.js';
import { getInsightsForCategory } from './project-insight-memory.js';

/**
 * Core dispatch function for a single asset generation.
 *
 * This is the workflows-side counterpart to
 * `apps/worker/src/processors/generate-project-assets.ts`. The two
 * coexist during PR 2 (gated by the worker's `GENERATION_RUNTIME`
 * feature flag); PR 3 deletes the worker's copy once the workflow
 * path has run in prod for a release cycle.
 *
 * Key differences from the worker version:
 *
 *   1. **Context is re-read from the DB, not passed in.** The worker's
 *      `generateProjectAsset(data: GenerateAssetJobData)` receives a
 *      bundle of `repoAnalysis`, `research`, `strategy`, and
 *      `pastInsights` inline from the BullMQ payload. Here we accept
 *      only `{ projectId, assetId }` and re-read everything from the
 *      `projects` + `assets` + `strategy_insights` tables. Smaller
 *      task inputs, no drift between enqueue-time and run-time
 *      payloads, idempotent retries.
 *
 *   2. **Per-task scope validation.** The caller passes
 *      `allowedTypes` — the subset of asset types the calling task is
 *      allowed to handle. If the asset's actual type is outside that
 *      subset, we throw before doing any work. This is the safety net
 *      against a routing bug in `generateAllAssetsForProject`
 *      accidentally landing a 10-minute video render on a starter
 *      instance sized for a 20-second blog post.
 *
 *   3. **Same DB writes, same progress events.** Every update to the
 *      `assets` row and every `projectProgressPublisher` call mirrors
 *      the worker's behaviour exactly. The web service's SSE
 *      subscription cannot tell which code path emitted an event — by
 *      design, so the dashboard does not need to change.
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

  // Pull generation instructions off the asset metadata. The old
  // BullMQ payload stamped this inline; here we read the same field
  // back from the row that `fanOutGeneration` (or the strategist)
  // persisted it on.
  const assetMetadata = (asset.metadata as Record<string, unknown> | null) ?? {};
  const generationInstructions =
    (typeof assetMetadata['generationInstructions'] === 'string'
      ? assetMetadata['generationInstructions']
      : null) ??
    (typeof assetMetadata['brief'] === 'string'
      ? assetMetadata['brief']
      : null) ??
    `Generate a ${asset.type} for this product`;

  // Revision instructions live on the review's asset note, which the
  // BullMQ-era code path attached to the re-enqueued job payload. On
  // the workflow path we pull the most recent set of review notes off
  // the asset row if present; if the asset is on its first pass the
  // field is null and nothing gets passed.
  const reviewNotes = asset.reviewNotes ?? null;
  const revisionInstructions =
    reviewNotes !== null && reviewNotes.length > 0 ? reviewNotes : undefined;

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

  try {
    let content: string | null = null;
    let mediaUrl: string | null = null;
    let metadata: Record<string, unknown> = {};

    const assetType = asset.type;

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
        ...(revisionInstructions !== undefined ? { revisionInstructions } : {}),
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
        ...(revisionInstructions !== undefined ? { revisionInstructions } : {}),
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
        ...(revisionInstructions !== undefined ? { revisionInstructions } : {}),
      });
      content = result.content;
      metadata = result.metadata;
    }

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

    await projectProgressPublisher.assetReady(projectId, assetId, assetType);

    console.log(
      `[Workflows:Dispatch] ${assetType} complete for project ${projectId}`
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

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
