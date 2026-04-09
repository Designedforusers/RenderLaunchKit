import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  JOB_NAMES,
  parseJsonbColumn,
  QUEUE_CONFIG,
  QUEUE_NAMES,
  RepoAnalysisSchema,
  ResearchResultSchema,
  StrategyBriefSchema,
} from '@launchkit/shared';
import type {
  AnalyzeRepoJobData,
  FilterWebhookJobData,
  GenerateAssetJobData,
  ReviewJobData,
  JobData,
} from '@launchkit/shared';
import { analyzeProjectRepository } from './processors/analyze-project-repository.js';
import { researchProjectLaunchContext } from './processors/research-project-launch-context.js';
import { buildProjectLaunchStrategy } from './processors/build-project-launch-strategy.js';
import { generateProjectAsset } from './processors/generate-project-assets.js';
import { reviewGeneratedProjectAssets } from './processors/review-generated-assets.js';
import { processCommitMarketingRun } from './processors/process-commit-marketing-run.js';
import { processIngestTrendingSignals } from './processors/ingest-trending-signals.js';
import { processEnrichDevInfluencers } from './processors/enrich-dev-influencers.js';
import { processEmbedFeedbackEvent } from './processors/embed-feedback-event.js';
import { projectProgressPublisher } from './lib/project-progress-publisher.js';
import { getInsightsForCategory } from './tools/project-insight-memory.js';
import { database as db, databasePool } from './lib/database.js';
import {
  redisConnection as connection,
  analysisQueue,
  generationQueue,
  reviewQueue,
} from './lib/job-queues.js';
import { triggerWorkflowGeneration } from './lib/trigger-workflow-generation.js';
import { env } from './env.js';

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

        // Fan-out generation: either the existing BullMQ path or the
        // new Render Workflows path, gated by the GENERATION_RUNTIME
        // env flag (default `bullmq`). Both paths publish the
        // `phase_start: generating` event themselves, so the
        // analysis handler does not emit anything generation-related
        // from here.
        if (env.GENERATION_RUNTIME === 'workflows') {
          await triggerWorkflowGeneration(data.projectId);
        } else {
          await fanOutGeneration(data.projectId);
        }
      } else if (job.name === JOB_NAMES.FILTER_WEBHOOK) {
        await processCommitMarketingRun(data as FilterWebhookJobData);
      }

      // Record job completion
      await db
        .update(schema.jobs)
        .set({
          status: 'completed',
          duration: Date.now() - startTime,
          completedAt: new Date(),
        })
        .where(eq(schema.jobs.bullmqJobId, job.id ?? ''));
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
        .where(eq(schema.jobs.bullmqJobId, job.id ?? ''));

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
        .where(eq(schema.jobs.bullmqJobId, job.id ?? ''));

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
        .where(eq(schema.jobs.bullmqJobId, job.id ?? ''));

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

// ── Trending Worker ──
// Handles: ingest-trending-signals AND enrich-dev-influencers
// (both scheduled by the cron service).
//
// Jobs on this queue are fire-and-forget from the cron's perspective.
// Both job types share the queue because they're semantically the
// same shape: scheduled background data refreshes that run independent
// of user requests, with their own per-row error isolation. Each
// processor validates its own job payload at the boundary.

const trendingWorker = new Worker(
  QUEUE_NAMES.TRENDING,
  async (job) => {
    if (job.name === JOB_NAMES.INGEST_TRENDING_SIGNALS) {
      await processIngestTrendingSignals(job);
      return;
    }
    if (job.name === JOB_NAMES.ENRICH_DEV_INFLUENCERS) {
      await processEnrichDevInfluencers(job);
      return;
    }
    if (job.name === JOB_NAMES.EMBED_FEEDBACK_EVENT) {
      await processEmbedFeedbackEvent(job);
      return;
    }
    console.warn(
      `[Worker:Trending] unknown job name "${job.name}" — skipping`
    );
  },
  {
    connection,
    concurrency: QUEUE_CONFIG[QUEUE_NAMES.TRENDING].concurrency,
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
        .where(eq(schema.jobs.bullmqJobId, job.id ?? ''));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      await db
        .update(schema.jobs)
        .set({
          status: 'failed',
          error: error.message,
          duration: Date.now() - startTime,
        })
        .where(eq(schema.jobs.bullmqJobId, job.id ?? ''));

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

  // Parse the jsonb columns through their schemas instead of the
  // previous `as unknown as X` triple casts. If the database row was
  // written by a different worker version with an incompatible
  // shape, the parser fails fast with a structured error naming the
  // failing field — much easier to debug than a downstream crash.
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
          (typeof assetMetadata?.['generationInstructions'] === 'string'
            ? assetMetadata['generationInstructions']
            : null) ??
          (typeof assetMetadata?.['brief'] === 'string'
            ? assetMetadata['brief']
            : null) ??
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
  trending: trendingWorker,
})) {
  worker.on('completed', (job) => {
    console.log(`[${name}] Job ${job.name}:${job.id ?? '<unknown>'} completed`);
  });

  worker.on('failed', (job, err) => {
    const jobName = job?.name ?? '<unknown>';
    const jobId = job?.id ?? '<unknown>';
    console.error(`[${name}] Job ${jobName}:${jobId} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error(`[${name}] Worker error:`, err.message);
  });
}

// ── Startup ──

console.log(`
╔══════════════════════════════════════════════════╗
║  LaunchKit Worker Service                        ║
║  Queues: analysis, generation, review, trending  ║
║  Env: ${env.NODE_ENV.padEnd(42)}║
╚══════════════════════════════════════════════════╝
`);

// ── Graceful Shutdown ──

async function shutdown() {
  console.log('[Worker] Shutting down gracefully...');
  await Promise.all([
    analysisWorker.close(),
    generationWorker.close(),
    reviewWorker.close(),
    trendingWorker.close(),
  ]);
  await databasePool.end();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
