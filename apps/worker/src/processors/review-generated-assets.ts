import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  MAX_REVISION_ROUNDS,
  MIN_APPROVAL_SCORE,
  parseJsonbColumn,
  StrategyBriefSchema,
} from '@launchkit/shared';
import type { ReviewJobData } from '@launchkit/shared';
import { reviewLaunchKitAssets } from '../agents/launch-kit-review-agent.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';
import { database as db } from '../lib/database.js';
import { triggerWorkflowGeneration } from '../lib/trigger-workflow-generation.js';

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

    // Flip each rejected asset back to `queued` and bump its version.
    // The workflow parent task picks up queued assets on its next
    // run and dispatches them through the appropriate child task.
    // `dispatchAsset` in the workflows service reads the asset's
    // `reviewNotes` directly off the row (which the creative-director
    // loop above already wrote as a concatenation of strengths,
    // issues, and the explicit revision instructions) and passes it
    // through to the agents as the revision prompt — so no per-asset
    // payload needs to carry a revisionInstructions string the way
    // the legacy BullMQ path did.
    let rejectedCount = 0;
    for (const assetReview of rejectedReviews) {
      const asset = projectAssets.find((candidate) => candidate.id === assetReview.assetId);
      if (!asset) {
        continue;
      }

      await db
        .update(schema.assets)
        .set({
          status: 'queued',
          version: asset.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.assets.id, asset.id));
      rejectedCount += 1;
    }

    // Mark for revision BEFORE triggering the workflow so the
    // dashboard's SSE consumer sees the revising state transition
    // ahead of the new `phase_start: generating` event the workflow
    // parent will emit once it reads the freshly-queued rows.
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

    // Fire the workflow — only if we actually flipped at least one
    // asset to `queued`, otherwise the parent task would run,
    // find an empty queued-asset set, and return early for nothing.
    if (rejectedCount > 0) {
      await triggerWorkflowGeneration(projectId);
    }

    console.log(
      `[Review] Project ${projectId} needs revision (score: ${review.overallScore}, round ${project.revisionCount + 1}, ${rejectedCount} assets re-queued)`
    );
  }
}
