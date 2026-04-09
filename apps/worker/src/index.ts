import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import { JOB_NAMES, QUEUE_CONFIG, QUEUE_NAMES } from '@launchkit/shared';
import type {
  AnalyzeRepoJobData,
  FilterWebhookJobData,
  ReviewJobData,
  JobData,
} from '@launchkit/shared';
import { analyzeProjectRepository } from './processors/analyze-project-repository.js';
import { researchProjectLaunchContext } from './processors/research-project-launch-context.js';
import { buildProjectLaunchStrategy } from './processors/build-project-launch-strategy.js';
import { reviewGeneratedProjectAssets } from './processors/review-generated-assets.js';
import { processCommitMarketingRun } from './processors/process-commit-marketing-run.js';
import { processIngestTrendingSignals } from './processors/ingest-trending-signals.js';
import { processEnrichDevInfluencers } from './processors/enrich-dev-influencers.js';
import { processEmbedFeedbackEvent } from './processors/embed-feedback-event.js';
import { projectProgressPublisher } from './lib/project-progress-publisher.js';
import { database as db, databasePool } from './lib/database.js';
import {
  redisConnection as connection,
  analysisQueue,
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

        // Kick off the Render Workflows parent task. It reads every
        // `status='queued'` asset on the project and fans out to the
        // five compute-bucketed child tasks via run chaining. The
        // parent task itself publishes the `phase_start: generating`
        // progress event and enqueues the review BullMQ job when
        // every child settles — the analysis handler releases its
        // slot as soon as `startTask` returns the run handle (~1s).
        await triggerWorkflowGeneration(data.projectId);
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

// ── Worker Event Handlers ──

for (const [name, worker] of Object.entries({
  analysis: analysisWorker,
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
║  Queues: analysis, review, trending              ║
║  Generation: Render Workflows (apps/workflows/)  ║
║  Env: ${env.NODE_ENV.padEnd(42)}║
╚══════════════════════════════════════════════════╝
`);

// ── Graceful Shutdown ──

async function shutdown() {
  console.log('[Worker] Shutting down gracefully...');
  await Promise.all([
    analysisWorker.close(),
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
