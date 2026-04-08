import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES, QUEUE_CONFIG } from '@launchkit/shared';
import type {
  AnalyzeRepoJobData,
  EmbedFeedbackEventJobData,
  GenerateAssetJobData,
  JobData,
  ReviewJobData,
} from '@launchkit/shared';
import { env } from '../env.js';

const redisUrl = new URL(env.REDIS_URL);

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
};

// Create queues
export const analysisJobQueue = new Queue<JobData>(QUEUE_NAMES.ANALYSIS, {
  connection,
  defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.ANALYSIS].defaultJobOptions,
});

export const assetGenerationJobQueue = new Queue<JobData>(QUEUE_NAMES.GENERATION, {
  connection,
  defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.GENERATION].defaultJobOptions,
});

export const creativeReviewJobQueue = new Queue<JobData>(QUEUE_NAMES.REVIEW, {
  connection,
  defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.REVIEW].defaultJobOptions,
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

// Helper to add generation jobs
export async function enqueueAssetGeneration(
  jobName: string,
  data: GenerateAssetJobData
) {
  return assetGenerationJobQueue.add(jobName, data, {
    priority: data.assetType.includes('video') ? 3 : 2,
    jobId: `${jobName}__${data.projectId}__${data.assetId}__${data.assetType}`,
  });
}

// Helper to add review jobs
export async function enqueueCreativeReview(data: ReviewJobData) {
  return creativeReviewJobQueue.add('creative-review', data, {
    priority: 2,
    jobId: `review__${data.projectId}`,
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
