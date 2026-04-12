import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import { JOB_NAMES, QUEUE_CONFIG, QUEUE_NAMES, ReviewJobDataSchema } from '@launchkit/shared';
import {
  AnalyzeRepoJobDataSchema,
  FilterWebhookJobDataSchema,
} from '@launchkit/shared';
import type { JobData } from '@launchkit/shared';
import { analyzeProjectRepository } from './processors/analyze-project-repository.js';
import { researchProjectLaunchContext } from './processors/research-project-launch-context.js';
import { buildProjectLaunchStrategy } from './processors/build-project-launch-strategy.js';
import { reviewGeneratedProjectAssets } from './processors/review-generated-assets.js';
import { processCommitMarketingRun } from './processors/process-commit-marketing-run.js';
import { processIngestTrendingSignals } from './processors/ingest-trending-signals.js';
import { processEmbedFeedbackEvent } from './processors/embed-feedback-event.js';
// Note: `processPikaInvite` is NOT imported here. The invite
// path spawns a Python subprocess for ~90 s per invocation and
// lives on the dedicated `launchkit-pika-worker` service (see
// `./index.pika.ts` — second entry point in this same workspace
// that compiles to `dist/index.pika.js`) so the shared worker's
// event loop never competes with it. The imports below cover
// only the pure-TS poll + leave jobs that run on this shared
// worker.
import { processPikaLeave } from './processors/process-pika-leave.js';
import { processPikaPoll } from './processors/process-pika-poll.js';
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
    // Validate job payload at the BullMQ boundary. The schemas exist in
    // @launchkit/shared and are already used by the review worker — the
    // analysis worker must follow the same pattern.
    const baseData = job.data as JobData;
    const startTime = Date.now();

    console.log(`[Worker:Analysis] Processing ${job.name} for project ${baseData.projectId}`);

    // Record job start
    await db.insert(schema.jobs).values({
      projectId: baseData.projectId,
      bullmqJobId: job.id,
      name: job.name,
      status: 'active',
      input: baseData,
      startedAt: new Date(),
    });

    try {
      if (job.name === JOB_NAMES.ANALYZE_REPO) {
        const parsed = AnalyzeRepoJobDataSchema.safeParse(job.data);
        if (!parsed.success) {
          console.error('[Worker:Analysis] Invalid analyze job data:', parsed.error.issues);
          throw new Error('Invalid analyze-repo job data');
        }
        await analyzeProjectRepository(parsed.data);

        // Chain: enqueue research
        await analysisQueue.add(
          JOB_NAMES.RESEARCH,
          { projectId: baseData.projectId },
          {
            jobId: `${JOB_NAMES.RESEARCH}__${baseData.projectId}`,
          }
        );
      } else if (job.name === JOB_NAMES.RESEARCH) {
        await researchProjectLaunchContext(baseData);

        // Chain: enqueue strategize
        await analysisQueue.add(
          JOB_NAMES.STRATEGIZE,
          { projectId: baseData.projectId },
          {
            jobId: `${JOB_NAMES.STRATEGIZE}__${baseData.projectId}`,
          }
        );
      } else if (job.name === JOB_NAMES.STRATEGIZE) {
        await buildProjectLaunchStrategy(baseData);

        // Kick off the Render Workflows parent task. It reads every
        // `status='queued'` asset on the project and fans out to the
        // five compute-bucketed child tasks via run chaining. The
        // parent task itself publishes the `phase_start: generating`
        // progress event and enqueues the review BullMQ job when
        // every child settles — the analysis handler releases its
        // slot as soon as `startTask` returns the run handle (~1s).
        await triggerWorkflowGeneration(baseData.projectId);
      } else if (job.name === JOB_NAMES.FILTER_WEBHOOK) {
        const parsed = FilterWebhookJobDataSchema.safeParse(job.data);
        if (!parsed.success) {
          console.error('[Worker:Analysis] Invalid webhook job data:', parsed.error.issues);
          throw new Error('Invalid filter-webhook job data');
        }
        await processCommitMarketingRun(parsed.data);
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
        .where(eq(schema.projects.id, baseData.projectId));

      await projectProgressPublisher.error(baseData.projectId, job.name, error.message);

      throw err;
    }
  },
  {
    connection,
    concurrency: QUEUE_CONFIG[QUEUE_NAMES.ANALYSIS].concurrency,
  }
);

// ── Trending Worker ──
// Handles: ingest-trending-signals (scheduled by the cron service) and
// embed-feedback-event (enqueued from the web service after a
// user-edit).
//
// Jobs on this queue are fire-and-forget from the producer's
// perspective. Both job types share the queue because they're
// semantically the same shape: scheduled background data refreshes
// that run independent of user requests, with their own per-row error
// isolation. Each processor validates its own job payload at the
// boundary.

const trendingWorker = new Worker(
  QUEUE_NAMES.TRENDING,
  async (job) => {
    if (job.name === JOB_NAMES.INGEST_TRENDING_SIGNALS) {
      await processIngestTrendingSignals(job);
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

// ── Pika Control Worker ──
// Handles: pika-poll (health check / safety cap) and pika-leave
// (HTTPS DELETE to Pika's session endpoint). Both are pure-TS
// single-HTTP-call jobs that take <1 s each, so they share the
// shared worker's event loop with analysis/review/trending.
//
// The PIKA_INVITE queue (spawns the Python join subprocess) is
// deliberately NOT registered here — it lives on a dedicated
// `launchkit-pika-worker` service so the 90-second subprocess
// burst has an isolated dyno. See `apps/pika-worker/src/index.ts`
// (Commit 12) for the invite worker.

const pikaControlWorker = new Worker(
  QUEUE_NAMES.PIKA_CONTROL,
  async (job) => {
    if (job.name === JOB_NAMES.PIKA_POLL) {
      await processPikaPoll(job);
      return;
    }
    if (job.name === JOB_NAMES.PIKA_LEAVE) {
      await processPikaLeave(job);
      return;
    }
    console.warn(
      `[Worker:PikaControl] unknown job name "${job.name}" — skipping`
    );
  },
  {
    connection,
    concurrency: QUEUE_CONFIG[QUEUE_NAMES.PIKA_CONTROL].concurrency,
  }
);

// ── Review Worker ──

const reviewWorker = new Worker(
  QUEUE_NAMES.REVIEW,
  async (job) => {
    const parsed = ReviewJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      console.error('[Worker:Review] Invalid job data:', parsed.error.issues);
      throw new Error('Invalid review job data');
    }
    const data = parsed.data;
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
    concurrency: QUEUE_CONFIG[QUEUE_NAMES.REVIEW].concurrency,
  }
);

// ── Worker Event Handlers ──

for (const [name, worker] of Object.entries({
  analysis: analysisWorker,
  review: reviewWorker,
  trending: trendingWorker,
  'pika-control': pikaControlWorker,
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
╔══════════════════════════════════════════════════════╗
║  LaunchKit Worker Service                            ║
║  Queues: analysis, review, trending, pika-control    ║
║  Generation: Render Workflows (apps/workflows/)      ║
║  Pika invites: launchkit-pika-worker (dedicated)     ║
║  Env: ${env.NODE_ENV.padEnd(46)}║
╚══════════════════════════════════════════════════════╝
`);

// ── Graceful Shutdown ──

async function shutdown() {
  console.log('[Worker] Shutting down gracefully...');
  await Promise.all([
    analysisWorker.close(),
    reviewWorker.close(),
    trendingWorker.close(),
    pikaControlWorker.close(),
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
