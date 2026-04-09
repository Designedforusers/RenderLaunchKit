import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@launchkit/shared';
import { env } from '../env.js';

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
const redisUrl = new URL(env.REDIS_URL);

export const redisConnection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  password: redisUrl.password || undefined,
};

// The generation queue was removed in Phase 10 — every asset
// generation now runs on the Render Workflows service
// (`apps/workflows/`). The worker retains only the analysis,
// review, trending, and pika-control queues because:
//
//   - the strategize handler still triggers the workflow via the
//     `triggerWorkflowGeneration` helper (which uses the Render SDK,
//     not BullMQ);
//   - the review and trending queues have no workflow equivalent;
//   - the pika-control queue hosts pure-TypeScript poll + leave
//     jobs that are too lightweight (single HTTPS call each) to
//     justify their own dyno.
//
// Note: the PIKA_INVITE queue (spawns the Python subprocess) is
// consumed by the dedicated `launchkit-pika-worker` service and
// is NOT declared here — the shared worker does not import a
// producer client for it either, because only the web service
// enqueues PIKA_INVITE jobs. See
// `apps/web/src/lib/job-queue-clients.ts` for that producer.
export const analysisQueue = new Queue(QUEUE_NAMES.ANALYSIS, { connection: redisConnection });
export const reviewQueue = new Queue(QUEUE_NAMES.REVIEW, { connection: redisConnection });
export const trendingQueue = new Queue(QUEUE_NAMES.TRENDING, { connection: redisConnection });
export const pikaControlQueue = new Queue(QUEUE_NAMES.PIKA_CONTROL, {
  connection: redisConnection,
});
