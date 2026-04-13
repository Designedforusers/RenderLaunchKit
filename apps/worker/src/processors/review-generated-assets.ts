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
    console.log(`[Review] No assets to review for project ${projectId} — marking as failed`);
    await db
      .update(schema.projects)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));
    await projectProgressPublisher.error(projectId, 'review', 'No reviewable assets found');
    return;
  }

  const strategy = parseJsonbColumn(
    StrategyBriefSchema,
    project.strategy,
    'project.strategy'
  );

  let review;
  try {
    review = await reviewLaunchKitAssets(strategy, assetsForReview);
  } catch (err) {
    // The LLM review call can fail (timeout, rate limit, network).
    // Assets are already in `reviewing` status — reset them to
    // `complete` so they don't get stuck, and finalize the project
    // without a review score rather than leaving it in limbo.
    const message = err instanceof Error ? err.message : 'Unknown review error';
    console.error(`[Review] Creative director review failed for project ${projectId}: ${message}`);

    for (const asset of assetsForReview) {
      await db
        .update(schema.assets)
        .set({ status: 'complete', updatedAt: new Date() })
        .where(eq(schema.assets.id, asset.id));
    }

    await db
      .update(schema.projects)
      .set({ status: 'complete', updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));

    await projectProgressPublisher.phaseComplete(
      projectId,
      'reviewing',
      'Review skipped due to error — assets auto-approved'
    );
    return;
  }

  // Update each asset with its review. Two columns are in play:
  //
  //   `reviewNotes`         — the human-readable summary the dashboard
  //                           renders under "Review feedback" on the
  //                           asset card. Strengths, issues, and
  //                           revision instructions concatenated as a
  //                           single paragraph. DISPLAY-ONLY.
  //
  //   `revisionInstructions` — the agent-facing revision prompt the
  //                           workflow re-run will pass to the writer /
  //                           marketing-visual / product-video agents.
  //                           Issues + explicit revision instructions
  //                           from the reviewer, joined without the
  //                           "Strengths:" prefix (which is praise, not
  //                           a directive). Only set on rejected rows
  //                           — approved rows clear it so the next
  //                           legitimate regeneration starts fresh.
  //
  // The two fields intentionally overlap in content but serve different
  // consumers: dashboard vs. agent. Keeping them separate avoids the
  // semantic overlap PR #33's code-reviewer flagged.
  for (const assetReview of review.assetReviews) {
    const isRejected = assetReview.score < MIN_APPROVAL_SCORE;
    const reviewNotes = [
      `Strengths: ${assetReview.strengths.join(', ')}`,
      assetReview.issues.length > 0 ? `Issues: ${assetReview.issues.join(', ')}` : null,
      assetReview.revisionInstructions ? `Revision: ${assetReview.revisionInstructions}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const revisionInstructions = isRejected
      ? [
          assetReview.revisionInstructions ?? null,
          assetReview.issues.length > 0
            ? `Issues to address: ${assetReview.issues.join('; ')}`
            : null,
        ]
          .filter((line): line is string => line !== null && line.length > 0)
          .join('\n') || null
      : null;

    await db
      .update(schema.assets)
      .set({
        qualityScore: assetReview.score,
        reviewNotes,
        revisionInstructions,
        status: isRejected ? 'rejected' : 'complete',
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
    // `revisionInstructions` column (already written above as the
    // reviewer's issues + explicit revision instructions) and passes
    // it through to the agents as the `revisionInstructions` input —
    // so no per-asset payload needs to carry a revision string the
    // way the legacy BullMQ path did.
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
          renderedVideoUrl: null,
          renderedVideoKey: null,
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
      await triggerWorkflowGeneration(projectId, {
        zeroSuccessProjectStatus: 'failed',
      });
    }

    console.log(
      `[Review] Project ${projectId} needs revision (score: ${review.overallScore}, round ${project.revisionCount + 1}, ${rejectedCount} assets re-queued)`
    );
  }
}
