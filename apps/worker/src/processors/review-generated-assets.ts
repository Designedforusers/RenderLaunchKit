import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  MAX_REVISION_ROUNDS,
  MIN_APPROVAL_SCORE,
  parseJsonbColumn,
  RepoAnalysisSchema,
  ResearchResultSchema,
  StrategyBriefSchema,
} from '@launchkit/shared';
import type { GenerateAssetJobData, ReviewJobData } from '@launchkit/shared';
import { reviewLaunchKitAssets } from '../agents/launch-kit-review-agent.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';
import { getInsightsForCategory } from '../tools/project-insight-memory.js';
import { database as db } from '../lib/database.js';
import { generationQueue } from '../lib/job-queues.js';

export async function reviewGeneratedProjectAssets(data: ReviewJobData): Promise<void> {
  const { projectId, assetIds } = data;

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });

  if (!project || !project.strategy || !project.repoAnalysis || !project.research) {
    throw new Error(`Project ${projectId} not ready for review`);
  }

  await projectProgressPublisher.phaseStart(
    projectId,
    'reviewing',
    'Creative director reviewing all assets'
  );

  // Fetch all assets for this project
  const projectAssets = await db.query.assets.findMany({
    where: eq(schema.assets.projectId, projectId),
  });

  // Restrict the review to the specific asset IDs that triggered this job.
  //
  // The set is captured by `checkAndTriggerReview` in the worker entrypoint
  // when a generation round completes. Without this filter, a webhook-driven
  // partial regeneration would re-review every previously-`complete` asset on
  // the project — burning Anthropic tokens and risking spurious re-revision
  // requests on content that did not change.
  const assetIdSet = new Set(assetIds);
  const assetsForReview = projectAssets
    .filter((a) => assetIdSet.has(a.id))
    .filter((a) => a.status === 'reviewing' || a.status === 'complete')
    .map((a) => ({
      id: a.id,
      type: a.type,
      content: a.content,
      mediaUrl: a.mediaUrl,
      metadata: a.metadata as Record<string, unknown> | null,
    }));

  if (assetsForReview.length === 0) {
    console.log(`[Review] No assets to review for project ${projectId}`);
    return;
  }

  const strategy = parseJsonbColumn(
    StrategyBriefSchema,
    project.strategy,
    'project.strategy'
  );
  const review = await reviewLaunchKitAssets(strategy, assetsForReview);

  // Update each asset with its review
  for (const assetReview of review.assetReviews) {
    await db
      .update(schema.assets)
      .set({
        qualityScore: assetReview.score,
        reviewNotes: [
          `Strengths: ${assetReview.strengths.join(', ')}`,
          assetReview.issues.length > 0 ? `Issues: ${assetReview.issues.join(', ')}` : null,
          assetReview.revisionInstructions ? `Revision: ${assetReview.revisionInstructions}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        status: assetReview.score >= MIN_APPROVAL_SCORE ? 'complete' : 'rejected',
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, assetReview.assetId));
  }

  // Update project with review results. The schema-validated `review`
  // matches the `review_feedback` jsonb column shape exactly, so the
  // previous `review as any` cast is no longer required.
  await db
    .update(schema.projects)
    .set({
      reviewScore: review.overallScore,
      reviewFeedback: review,
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  if (review.approved || project.revisionCount >= MAX_REVISION_ROUNDS) {
    // Mark project as complete
    await db
      .update(schema.projects)
      .set({
        status: 'complete',
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, projectId));

    await projectProgressPublisher.phaseComplete(
      projectId,
      'reviewing',
      `Kit approved with score ${review.overallScore.toFixed(1)}/10`
    );

    console.log(`[Review] Project ${projectId} COMPLETE — score: ${review.overallScore}`);
  } else {
    const rejectedReviews = review.assetReviews.filter(
      (assetReview) => assetReview.score < MIN_APPROVAL_SCORE
    );
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
    const pastInsights = await getInsightsForCategory(repoAnalysis.category);

    for (const assetReview of rejectedReviews) {
      const asset = projectAssets.find((candidate) => candidate.id === assetReview.assetId);
      if (!asset) {
        continue;
      }

      const assetMetadata = (asset.metadata as Record<string, unknown> | null) ?? {};
      const generationInstructions =
        typeof assetMetadata['generationInstructions'] === 'string'
          ? assetMetadata['generationInstructions']
          : typeof assetMetadata['brief'] === 'string'
            ? assetMetadata['brief']
          : `Regenerate the ${asset.type} asset for this project.`;

      await db
        .update(schema.assets)
        .set({
          status: 'queued',
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
          generationInstructions,
          repoName: project.repoName,
          repoAnalysis,
          research,
          strategy,
          pastInsights,
          revisionInstructions:
            assetReview.revisionInstructions ??
            `Improve this asset based on review feedback: ${assetReview.issues.join(', ')}`,
        } satisfies GenerateAssetJobData,
        {
          jobId: `revision__${projectId}__${asset.id}__${asset.version + 1}`,
        }
      );
    }

    // Mark for revision
    await db
      .update(schema.projects)
      .set({
        status: 'revising',
        revisionCount: project.revisionCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, projectId));

    await projectProgressPublisher.statusUpdate(
      projectId,
      'revising',
      `Score ${review.overallScore.toFixed(1)}/10 — revising ${review.revisionPriority.length} assets`
    );

    console.log(
      `[Review] Project ${projectId} needs revision (score: ${review.overallScore}, round ${project.revisionCount + 1})`
    );
  }
}
