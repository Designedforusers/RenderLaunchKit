import { eq, and, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import type { ReviewJobData, StrategyBrief, GenerateAssetJobData } from '@launchkit/shared';
import { runCreativeDirector } from '../agents/creative-director.js';
import { events } from '../lib/publisher.js';
import { MIN_APPROVAL_SCORE, MAX_REVISION_ROUNDS } from '@launchkit/shared';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

export async function processReview(data: ReviewJobData): Promise<void> {
  const { projectId, assetIds } = data;

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });

  if (!project || !project.strategy) {
    throw new Error(`Project ${projectId} not ready for review`);
  }

  await events.phaseStart(projectId, 'reviewing', 'Creative director reviewing all assets');

  // Fetch all assets for this project
  const projectAssets = await db.query.assets.findMany({
    where: eq(schema.assets.projectId, projectId),
  });

  const assetsForReview = projectAssets
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

  const strategy = project.strategy as unknown as StrategyBrief;
  const review = await runCreativeDirector(strategy, assetsForReview);

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

  // Update project with review results
  await db
    .update(schema.projects)
    .set({
      reviewScore: review.overallScore,
      reviewFeedback: review as any,
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

    await events.phaseComplete(
      projectId,
      'reviewing',
      `Kit approved with score ${review.overallScore.toFixed(1)}/10`
    );

    console.log(`[Review] Project ${projectId} COMPLETE — score: ${review.overallScore}`);
  } else {
    // Mark for revision
    await db
      .update(schema.projects)
      .set({
        status: 'revising',
        revisionCount: project.revisionCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, projectId));

    await events.statusUpdate(
      projectId,
      'revising',
      `Score ${review.overallScore.toFixed(1)}/10 — revising ${review.revisionPriority.length} assets`
    );

    console.log(
      `[Review] Project ${projectId} needs revision (score: ${review.overallScore}, round ${project.revisionCount + 1})`
    );
  }
}
