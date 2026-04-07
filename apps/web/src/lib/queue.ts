import { Queue } from 'bullmq';
import { QUEUE_NAMES, QUEUE_CONFIG } from '@launchkit/shared';
import type {
  AnalyzeRepoJobData,
  GenerateAssetJobData,
  ReviewJobData,
  JobData,
} from '@launchkit/shared';

const connection = {
  host: new URL(process.env.REDIS_URL || 'redis://localhost:6379').hostname,
  port: parseInt(new URL(process.env.REDIS_URL || 'redis://localhost:6379').port || '6379'),
  password: new URL(process.env.REDIS_URL || 'redis://localhost:6379').password || undefined,
};

// Create queues
export const analysisQueue = new Queue<JobData>(QUEUE_NAMES.ANALYSIS, {
  connection,
  defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.ANALYSIS].defaultJobOptions,
});

export const generationQueue = new Queue<JobData>(QUEUE_NAMES.GENERATION, {
  connection,
  defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.GENERATION].defaultJobOptions,
});

export const reviewQueue = new Queue<JobData>(QUEUE_NAMES.REVIEW, {
  connection,
  defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.REVIEW].defaultJobOptions,
});

// Helper to add analysis jobs
export async function enqueueAnalysis(data: AnalyzeRepoJobData) {
  return analysisQueue.add('analyze-repo', data, {
    priority: 1,
  });
}

// Helper to add generation jobs
export async function enqueueGeneration(jobName: string, data: GenerateAssetJobData) {
  return generationQueue.add(jobName, data, {
    priority: data.assetType.includes('video') ? 3 : 2,
  });
}

// Helper to add review jobs
export async function enqueueReview(data: ReviewJobData) {
  return reviewQueue.add('creative-review', data, {
    priority: 2,
  });
}

console.log('[Queue] BullMQ queues initialized');
