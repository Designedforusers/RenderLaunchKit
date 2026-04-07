import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  QUEUE_NAMES,
  QUEUE_CONFIG,
  JOB_NAMES,
} from '@launchkit/shared';
import type {
  AnalyzeRepoJobData,
  FilterWebhookJobData,
  GenerateAssetJobData,
  ReviewJobData,
  RepoAnalysis,
  ResearchResult,
  StrategyBrief,
  JobData,
} from '@launchkit/shared';
import { analyzeProjectRepository } from './processors/analyze-project-repository.js';
import { researchProjectLaunchContext } from './processors/research-project-launch-context.js';
import { buildProjectLaunchStrategy } from './processors/build-project-launch-strategy.js';
import { generateProjectAsset } from './processors/generate-project-assets.js';
import { reviewGeneratedProjectAssets } from './processors/review-generated-assets.js';
import { filterWebhookEventForRegeneration } from './processors/process-webhook-regeneration.js';
import { projectProgressPublisher } from './lib/project-progress-publisher.js';
import { getInsightsForCategory } from './tools/project-insight-memory.js';
import { database as db, databasePool } from './lib/database.js';
import {
  redisConnection as connection,
  analysisQueue,
  generationQueue,
  reviewQueue,
} from './lib/job-queues.js';

// ── Analysis Worker ──
// Handles: analyze-repo → research → strategize → fan-out generation

const analysisWorker = new Worker(
  QUEUE_NAMES.ANALYSIS,
  async (job) => {
    const data = job.data as JobData;
    const startTime = Date.now();

    console.log(`[Worker:Analysis] Processing ${job.name} for project ${data.projectId}`);

    // Record job start
    await db.insert(schema.jobs).values({
      projectId: data.projectId,
      bullmqJobId: job.id,
      name: job.name,
      status: 'active',
      input: data,
      startedAt: new Date(),
    });

    try {
      if (job.name === JOB_NAMES.ANALYZE_REPO) {
        await analyzeProjectRepository(data as AnalyzeRepoJobData);

        // Chain: enqueue research
        await analysisQueue.add(
          JOB_NAMES.RESEARCH,
          { projectId: data.projectId },
          {
            jobId: `${JOB_NAMES.RESEARCH}__${data.projectId}`,
          }
        );
      } else if (job.name === JOB_NAMES.RESEARCH) {
        await researchProjectLaunchContext(data);

        // Chain: enqueue strategize
        await analysisQueue.add(
          JOB_NAMES.STRATEGIZE,
          { projectId: data.projectId },
          {
            jobId: `${JOB_NAMES.STRATEGIZE}__${data.projectId}`,
          }
        );
      } else if (job.name === JOB_NAMES.STRATEGIZE) {
        await buildProjectLaunchStrategy(data);

        // Fan-out: enqueue all generation jobs
        await fanOutGeneration(data.projectId);
      } else if (job.name === JOB_NAMES.FILTER_WEBHOOK) {
        await filterWebhookEventForRegeneration(data as FilterWebhookJobData);
      }

      // Record job completion
      await db
        .update(schema.jobs)
        .set({
          status: 'completed',
          duration: Date.now() - startTime,
          completedAt: new Date(),
        })
        .where(eq(schema.jobs.bullmqJobId, job.id || ''));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      await db
        .update(schema.jobs)
        .set({
          status: 'failed',
          error: error.message,
          duration: Date.now() - startTime,
          attempts: job.attemptsMade + 1,
        })
        .where(eq(schema.jobs.bullmqJobId, job.id || ''));

      // Update project status to failed
      await db
        .update(schema.projects)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(schema.projects.id, data.projectId));

      await projectProgressPublisher.error(data.projectId, job.name, error.message);

      throw err;
    }
  },
  {
    connection,
    concurrency: QUEUE_CONFIG[QUEUE_NAMES.ANALYSIS].concurrency,
  }
);

// ── Generation Worker ──
// Handles all content/media generation jobs

const generationWorker = new Worker(
  QUEUE_NAMES.GENERATION,
  async (job) => {
    const data = job.data as GenerateAssetJobData;
    const startTime = Date.now();

    console.log(`[Worker:Generation] Processing ${job.name} for asset ${data.assetId}`);

    await db.insert(schema.jobs).values({
      projectId: data.projectId,
      bullmqJobId: job.id,
      name: job.name,
      status: 'active',
      input: { assetType: data.assetType, assetId: data.assetId },
      startedAt: new Date(),
    });

    try {
      await generateProjectAsset(data);

      await db
        .update(schema.jobs)
        .set({
          status: 'completed',
          duration: Date.now() - startTime,
          completedAt: new Date(),
        })
        .where(eq(schema.jobs.bullmqJobId, job.id || ''));

      // Check if all generation jobs are done → trigger review
      await checkAndTriggerReview(data.projectId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      await db
        .update(schema.jobs)
        .set({
          status: 'failed',
          error: error.message,
          duration: Date.now() - startTime,
          attempts: job.attemptsMade + 1,
        })
        .where(eq(schema.jobs.bullmqJobId, job.id || ''));

      await projectProgressPublisher.error(
        data.projectId,
        'generation',
        `${data.assetType}: ${error.message}`
      );

      throw err;
    }
  },
  {
    connection,
    concurrency: QUEUE_CONFIG[QUEUE_NAMES.GENERATION].concurrency,
  }
);

// ── Review Worker ──

const reviewWorker = new Worker(
  QUEUE_NAMES.REVIEW,
  async (job) => {
    const data = job.data as ReviewJobData;
    const startTime = Date.now();

    console.log(`[Worker:Review] Reviewing project ${data.projectId}`);

    await db.insert(schema.jobs).values({
      projectId: data.projectId,
      bullmqJobId: job.id,
      name: JOB_NAMES.CREATIVE_REVIEW,
      status: 'active',
      startedAt: new Date(),
    });

    try {
      await reviewGeneratedProjectAssets(data);

      await db
        .update(schema.jobs)
        .set({
          status: 'completed',
          duration: Date.now() - startTime,
          completedAt: new Date(),
        })
        .where(eq(schema.jobs.bullmqJobId, job.id || ''));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      await db
        .update(schema.jobs)
        .set({
          status: 'failed',
          error: error.message,
          duration: Date.now() - startTime,
        })
        .where(eq(schema.jobs.bullmqJobId, job.id || ''));

      throw err;
    }
  },
  {
    connection,
    concurrency: QUEUE_CONFIG[QUEUE_NAMES.REVIEW].concurrency,
  }
);

// ── Helper: Fan out generation jobs ──

async function fanOutGeneration(projectId: string): Promise<void> {
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    with: { assets: true },
  });

  if (!project || !project.strategy || !project.repoAnalysis || !project.research) {
    throw new Error('Project not ready for generation fan-out');
  }

  const repoAnalysis = project.repoAnalysis as unknown as RepoAnalysis;
  const research = project.research as unknown as ResearchResult;
  const strategy = project.strategy as unknown as StrategyBrief;

  // Get past insights for this category
  const pastInsights = await getInsightsForCategory(repoAnalysis.category);

  // Enqueue a generation job for each queued asset
  const queuedAssets = project.assets.filter((a) => a.status === 'queued');

  await projectProgressPublisher.phaseStart(
    projectId,
    'generating',
    `Generating ${queuedAssets.length} assets in parallel`
  );

  for (const asset of queuedAssets) {
    const assetMetadata = asset.metadata as Record<string, unknown> | null;

    await generationQueue.add(
      `generate-${asset.type}`,
      {
        projectId,
        assetId: asset.id,
        assetType: asset.type,
        generationInstructions:
          (assetMetadata?.generationInstructions as string) ||
          (assetMetadata?.brief as string) ||
          `Generate a ${asset.type} for this product`,
        repoName: project.repoName,
        repoAnalysis,
        research,
        strategy,
        pastInsights,
      } satisfies GenerateAssetJobData,
      {
        jobId: `generate__${projectId}__${asset.id}__${asset.version}`,
      }
    );
  }

  console.log(`[FanOut] Enqueued ${queuedAssets.length} generation jobs for project ${projectId}`);
}

// ── Helper: Check if all assets are done and trigger review ──

async function checkAndTriggerReview(projectId: string): Promise<void> {
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });

  if (!project) {
    return;
  }

  const projectAssets = await db.query.assets.findMany({
    where: eq(schema.assets.projectId, projectId),
  });

  const pending = projectAssets.filter(
    (a) =>
      a.status === 'queued' ||
      a.status === 'generating' ||
      a.status === 'regenerating'
  );

  if (pending.length === 0 && !['reviewing', 'complete', 'failed'].includes(project.status)) {
    // All assets done — trigger creative review
    const assetIds = projectAssets.map((a) => a.id);
    await reviewQueue.add(
      JOB_NAMES.CREATIVE_REVIEW,
      {
        projectId,
        assetIds,
      } satisfies ReviewJobData,
      {
        jobId: `review__${projectId}__${project.revisionCount}`,
      }
    );

    await db
      .update(schema.projects)
      .set({ status: 'reviewing', updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));

    console.log(`[Review] All assets complete, triggering review for project ${projectId}`);
  }
}

// ── Worker Event Handlers ──

for (const [name, worker] of Object.entries({
  analysis: analysisWorker,
  generation: generationWorker,
  review: reviewWorker,
})) {
  worker.on('completed', (job) => {
    console.log(`[${name}] Job ${job.name}:${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[${name}] Job ${job?.name}:${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error(`[${name}] Worker error:`, err.message);
  });
}

// ── Startup ──

console.log(`
╔══════════════════════════════════════════╗
║  LaunchKit Worker Service                ║
║  Queues: analysis, generation, review    ║
║  Env: ${(process.env.NODE_ENV || 'development').padEnd(34)}║
╚══════════════════════════════════════════╝
`);

// ── Graceful Shutdown ──

async function shutdown() {
  console.log('[Worker] Shutting down gracefully...');
  await Promise.all([
    analysisWorker.close(),
    generationWorker.close(),
    reviewWorker.close(),
  ]);
  await databasePool.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
