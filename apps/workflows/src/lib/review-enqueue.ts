import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES, parseRedisUrl } from '@launchkit/shared';
import type { ReviewJobData } from '@launchkit/shared';
import { env } from '../env.js';

/**
 * BullMQ client for the review queue, owned by the workflows process.
 *
 * The parent task (`generateAllAssetsForProject`) enqueues a
 * `CREATIVE_REVIEW` job on this queue once every child task has
 * settled (whether succeeded or failed — failed assets are still
 * terminal and the review can run with whatever landed). The review
 * queue itself lives in the worker's BullMQ setup and is consumed by
 * the worker's `reviewWorker` (`apps/worker/src/index.ts`). The
 * workflows process is only the producer for this queue, never the
 * consumer.
 *
 * The Redis connection is separate from the one used by the progress
 * publisher — BullMQ wants its own connection object, and keeping
 * them decoupled means a disconnect during a pub/sub reconnect loop
 * does not stall the review enqueue.
 */
const redisConnection = parseRedisUrl(env.REDIS_URL);

const reviewQueue = new Queue(QUEUE_NAMES.REVIEW, { connection: redisConnection });

/**
 * Enqueue a creative-review job for every asset on the project. The
 * worker's `reviewWorker` picks this up and routes it through
 * `reviewGeneratedProjectAssets`.
 *
 * The `revisionCount` is baked into the job id so a second review
 * round (after a revision loop) doesn't collide with the first
 * round's job id.
 */
export async function enqueueReviewJob(input: {
  projectId: string;
  assetIds: string[];
  revisionCount: number;
}): Promise<void> {
  const jobData: ReviewJobData = {
    projectId: input.projectId,
    assetIds: input.assetIds,
  };

  await reviewQueue.add(JOB_NAMES.CREATIVE_REVIEW, jobData, {
    jobId: `review__${input.projectId}__${input.revisionCount}`,
  });
}
