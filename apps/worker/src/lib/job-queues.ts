import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@launchkit/shared';

/**
 * Shared BullMQ queue clients for the worker process.
 *
 * Centralises Redis connection setup and queue construction so each
 * processor does not open its own Redis client. The web service has its
 * own equivalent in `apps/web/src/lib/job-queue-clients.ts` — these two
 * files intentionally do not share an instance because the web and worker
 * are separate processes that connect to the same Redis from different
 * Render services.
 */
const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');

export const redisConnection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password || undefined,
};

export const analysisQueue = new Queue(QUEUE_NAMES.ANALYSIS, { connection: redisConnection });
export const generationQueue = new Queue(QUEUE_NAMES.GENERATION, { connection: redisConnection });
export const reviewQueue = new Queue(QUEUE_NAMES.REVIEW, { connection: redisConnection });
