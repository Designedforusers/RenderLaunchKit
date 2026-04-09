import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES, QUEUE_CONFIG } from '@launchkit/shared';
import type {
  AnalyzeRepoJobData,
  EmbedFeedbackEventJobData,
  JobData,
} from '@launchkit/shared';
import { env } from '../env.js';

const redisUrl = new URL(env.REDIS_URL);

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
};

// BullMQ queues the web service produces to.
//
// The asset generation queue is gone as of PR 3 — every consumer now
// triggers the `generateAllAssetsForProject` Render Workflows task
// via the lazy SDK client in `./trigger-workflow-generation.ts`
// (web) or the parallel helper in `apps/worker/src/lib/` (worker).
//
// The review queue client used to live here too (as
// `creativeReviewJobQueue` + `enqueueCreativeReview`) but nothing in
// the web service ever enqueued to it — the review path was always
// producer-owned by the worker's `checkAndTriggerReview` (deleted in
// PR 3) and now by the workflow parent task's
// `apps/workflows/src/lib/review-enqueue.ts`. Removed in PR 3 with
// the rest of the dead generation-queue code.
export const analysisJobQueue = new Queue<JobData>(QUEUE_NAMES.ANALYSIS, {
  connection,
  defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.ANALYSIS].defaultJobOptions,
});

// Phase 7: trending queue is shared between heterogeneous background
// job types — the trending-signals cron, the dev-influencers
// enrichment cron, and the new feedback-event embedding job. Each
// processor validates its own job payload via Zod at the boundary
// (see `processIngestTrendingSignals`, `processEnrichDevInfluencers`,
// `processEmbedFeedbackEvent`), so the queue's payload type is
// intentionally `unknown`. A typed `Queue<JobData>` would force
// every consumer to carry a `projectId`, which the embed-feedback
// job doesn't have.
export const trendingJobQueue = new Queue<unknown>(QUEUE_NAMES.TRENDING, {
  connection,
  defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.TRENDING].defaultJobOptions,
});

// Helper to add analysis jobs
export async function enqueueRepositoryAnalysis(data: AnalyzeRepoJobData) {
  return analysisJobQueue.add('analyze-repo', data, {
    priority: 1,
    jobId: `analyze__${data.projectId}`,
  });
}

// Phase 7: enqueue a background Voyage embedding job for an asset
// feedback event's edit text. The deterministic jobId means a
// duplicate enqueue inside the same dedup window is dropped at the
// queue level — every feedback event embeds at most once even if a
// retry path re-fires the route handler.
//
// Per-job options OVERRIDE the trending queue's defaults:
//
//   - `attempts: 3` (queue default is 1) — the trending queue's
//     1-attempt default is correct for the trending-signals ingest
//     because the cron re-fires every 6h, but wrong for this job
//     because the only producer is the user-action route. A
//     transient Voyage failure (rate limit, network blip) should
//     retry, not silently drop the embedding forever.
//   - `backoff: { type: 'exponential', delay: 5000 }` — 5s, 10s, 20s
//     between retries gives Voyage time to recover from a transient
//     hiccup without hammering it on the first failure.
export async function enqueueEmbedFeedbackEvent(
  feedbackEventId: string
): Promise<void> {
  const payload: EmbedFeedbackEventJobData = { feedbackEventId };
  await trendingJobQueue.add(JOB_NAMES.EMBED_FEEDBACK_EVENT, payload, {
    jobId: `embed-feedback-event__${feedbackEventId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

console.log('[JobQueues] BullMQ queues initialized');
