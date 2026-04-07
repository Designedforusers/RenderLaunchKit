import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  parseJsonbColumn,
  RepoAnalysisSchema,
  ResearchResultSchema,
  StrategyBriefSchema,
} from '@launchkit/shared';
import type { AssetType, FilterWebhookJobData } from '@launchkit/shared';
import { evaluateWebhookEvent } from '../agents/webhook-relevance-agent.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';
import { getInsightsForCategory } from '../tools/project-insight-memory.js';
import { database as db } from '../lib/database.js';
import { generationQueue } from '../lib/job-queues.js';

function buildWebhookGenerationInstructions(
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

export async function filterWebhookEventForRegeneration(
  data: FilterWebhookJobData
): Promise<void> {
  const { projectId, webhookEventId } = data;

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    with: {
      assets: true,
    },
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

  // `asset.type` is already typed as `AssetType` (drizzle's pgEnum
  // narrows the column type to the same union the schema produces),
  // so the previous `as AssetType` cast is no longer needed.
  const availableAssets = project.assets.map((asset) => asset.type);
  if (availableAssets.length === 0) {
    await db
      .update(schema.webhookEvents)
      .set({
        isMarketable: false,
        filterReasoning: 'No existing assets are available to regenerate for this project.',
      })
      .where(eq(schema.webhookEvents.id, webhookEvent.id));
    return;
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

  const decision = await evaluateWebhookEvent({
    eventType: webhookEvent.eventType,
    commitMessage: webhookEvent.commitMessage ?? 'No commit message provided',
    commitSha: webhookEvent.commitSha,
    repoAnalysis,
    strategy,
    availableAssets,
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

  const pastInsights = await getInsightsForCategory(repoAnalysis.category);
  const assetsToRegenerate = project.assets.filter((asset) =>
    decision.assetTypes.includes(asset.type)
  );

  if (assetsToRegenerate.length === 0) {
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

  for (const asset of assetsToRegenerate) {
    const assetMetadata = (asset.metadata as Record<string, unknown> | null) ?? {};
    const existingGenerationInstructions =
      typeof assetMetadata['generationInstructions'] === 'string'
        ? assetMetadata['generationInstructions']
        : typeof assetMetadata['brief'] === 'string'
          ? assetMetadata['brief']
          : undefined;

    await db
      .update(schema.assets)
      .set({
        status: 'queued',
        userApproved: null,
        reviewNotes: null,
        qualityScore: null,
        version: asset.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, asset.id));

    await generationQueue.add(
      `generate-${asset.type.replace(/_/g, '-')}`,
      {
        projectId,
        assetId: asset.id,
        assetType: asset.type,
        generationInstructions: buildWebhookGenerationInstructions(
          asset.type,
          existingGenerationInstructions,
          webhookEvent.eventType,
          webhookEvent.commitMessage ?? 'No commit message provided',
          decision.reasoning
        ),
        repoName: project.repoName,
        repoAnalysis,
        research,
        strategy,
        pastInsights,
        revisionInstructions: `Refresh this asset for commit ${webhookEvent.commitSha ?? 'unknown'}: ${webhookEvent.commitMessage ?? 'No commit message provided'}`,
      },
      {
        jobId: `webhook__${webhookEvent.id}__${asset.id}__${asset.version + 1}`,
      }
    );
  }

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
    .set({
      triggeredGeneration: true,
    })
    .where(eq(schema.webhookEvents.id, webhookEvent.id));

  await projectProgressPublisher.statusUpdate(
    projectId,
    'generating',
    `Webhook-triggered refresh queued for ${assetsToRegenerate.length} assets`
  );
}
