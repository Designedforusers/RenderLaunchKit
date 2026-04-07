import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import type {
  GenerateAssetJobData,
  RepoAnalysis,
  ResearchResult,
  ReviewJobData,
  StrategyBrief,
} from '@launchkit/shared';
import { reviewLaunchKitAssets } from '../agents/launch-kit-review-agent.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';
import { MIN_APPROVAL_SCORE, MAX_REVISION_ROUNDS } from '@launchkit/shared';
import { getInsightsForCategory } from '../tools/project-insight-memory.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
const generationQueue = new Queue(schema.QUEUE_NAMES.GENERATION, {
  connection: {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port || '6379', 10),
    password: redisUrl.password || undefined,
  },
});

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
    const repoAnalysis = project.repoAnalysis as unknown as RepoAnalysis;
    const research = project.research as unknown as ResearchResult;
    const pastInsights = await getInsightsForCategory(repoAnalysis.category);

    for (const assetReview of rejectedReviews) {
      const asset = projectAssets.find((candidate) => candidate.id === assetReview.assetId);
      if (!asset) {
        continue;
      }

      const assetMetadata = (asset.metadata as Record<string, unknown> | null) || {};
      const generationInstructions =
        typeof assetMetadata.generationInstructions === 'string'
          ? assetMetadata.generationInstructions
          : typeof assetMetadata.brief === 'string'
            ? assetMetadata.brief
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
            assetReview.revisionInstructions ||
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
