import { Queue } from 'bullmq';
import { QUEUE_NAMES, QUEUE_CONFIG } from '@launchkit/shared';
import type {
  AnalyzeRepoJobData,
  GenerateAssetJobData,
  ReviewJobData,
  JobData,
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

console.log('[JobQueues] BullMQ queues initialized');
