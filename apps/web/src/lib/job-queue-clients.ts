import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES, QUEUE_CONFIG, parseRedisUrl } from '@launchkit/shared';
import type {
  AnalyzeRepoJobData,
  EmbedFeedbackEventJobData,
  JobData,
  PikaInviteJobData,
  PikaLeaveJobData,
} from '@launchkit/shared';
import { env } from '../env.js';

const connection = parseRedisUrl(env.REDIS_URL);

let analysisJobQueue: Queue<JobData> | null = null;
let trendingJobQueue: Queue<unknown> | null = null;
let pikaInviteJobQueue: Queue<unknown> | null = null;
let pikaControlJobQueue: Queue<unknown> | null = null;

// BullMQ queue handles are constructed lazily so importing a route
// module does not immediately start Redis reconnect loops. This keeps
// boundary-only tests pure: invalid-UUID requests that never enqueue a
// job should not need a live Redis instance just to import the route.
export function getAnalysisJobQueue(): Queue<JobData> {
  analysisJobQueue ??= new Queue<JobData>(QUEUE_NAMES.ANALYSIS, {
    connection,
    defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.ANALYSIS].defaultJobOptions,
  });
  return analysisJobQueue;
}

// Phase 7: trending queue is shared between heterogeneous background
// job types — the trending-signals cron and the feedback-event
// embedding job. Each processor validates its own job payload via
// Zod at the boundary (see `processIngestTrendingSignals`,
// `processEmbedFeedbackEvent`), so the queue's payload type is
// intentionally `unknown`. A typed `Queue<JobData>` would force
// every consumer to carry a `projectId`, which the embed-feedback
// job doesn't have.
function getTrendingJobQueue(): Queue<unknown> {
  trendingJobQueue ??= new Queue<unknown>(QUEUE_NAMES.TRENDING, {
    connection,
    defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.TRENDING].defaultJobOptions,
  });
  return trendingJobQueue;
}

// Pika video-meeting queues. Split into two:
//
//   - PIKA_INVITE queue — consumed ONLY by the dedicated
//     `launchkit-pika-worker` service. Every job on this queue
//     spawns the Python `join` subprocess for ~90 s.
//   - PIKA_CONTROL queue — consumed by the shared worker alongside
//     analysis/review/trending. Carries pure-TS poll + leave jobs.
//
// The web service enqueues to BOTH queues depending on the action:
//   - POST /meetings           → PIKA_INVITE queue
//   - POST /meetings/:id/leave → PIKA_CONTROL queue (pika-leave)
function getPikaInviteJobQueue(): Queue<unknown> {
  pikaInviteJobQueue ??= new Queue<unknown>(QUEUE_NAMES.PIKA_INVITE, {
    connection,
    defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.PIKA_INVITE].defaultJobOptions,
  });
  return pikaInviteJobQueue;
}

function getPikaControlJobQueue(): Queue<unknown> {
  pikaControlJobQueue ??= new Queue<unknown>(QUEUE_NAMES.PIKA_CONTROL, {
    connection,
    defaultJobOptions: QUEUE_CONFIG[QUEUE_NAMES.PIKA_CONTROL].defaultJobOptions,
  });
  return pikaControlJobQueue;
}

// Helper to add analysis jobs
export async function enqueueRepositoryAnalysis(data: AnalyzeRepoJobData) {
  return getAnalysisJobQueue().add('analyze-repo', data, {
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
  await getTrendingJobQueue().add(JOB_NAMES.EMBED_FEEDBACK_EVENT, payload, {
    jobId: `embed-feedback-event__${feedbackEventId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

/**
 * Enqueue a pika-invite job for a previously-inserted session row.
 * Called from `POST /api/projects/:projectId/meetings` after the
 * handler has created the `pika_meeting_sessions` row at
 * `status='pending'`. The deterministic jobId dedupes a double-
 * click on the dashboard.
 *
 * Routes to the PIKA_INVITE queue, which is consumed only by the
 * dedicated `launchkit-pika-worker` dyno.
 */
export async function enqueuePikaInvite(
  data: PikaInviteJobData
): Promise<void> {
  await getPikaInviteJobQueue().add(JOB_NAMES.PIKA_INVITE, data, {
    jobId: `pika-invite__${data.sessionRowId}`,
  });
}

/**
 * Enqueue a user-initiated pika-leave job. Routes to the
 * PIKA_CONTROL queue, which is consumed by the shared worker.
 *
 * A user leave does NOT cancel the poll loop's `pika-leave` jobs
 * (e.g. from a safety cap or pika_closed detection) — all leave
 * triggers share the same terminal-status idempotency guard in
 * the leave processor, so whichever fires first terminates the
 * session and subsequent jobs no-op.
 */
export async function enqueuePikaLeave(data: PikaLeaveJobData): Promise<void> {
  await getPikaControlJobQueue().add(JOB_NAMES.PIKA_LEAVE, data, {
    jobId: `pika-leave-user__${data.sessionRowId}`,
  });
}

export async function closeJobQueues(): Promise<void> {
  const queues = [
    analysisJobQueue,
    trendingJobQueue,
    pikaInviteJobQueue,
    pikaControlJobQueue,
  ];

  analysisJobQueue = null;
  trendingJobQueue = null;
  pikaInviteJobQueue = null;
  pikaControlJobQueue = null;

  await Promise.all(
    queues
      .filter((queue): queue is Queue<unknown> => queue !== null)
      .map(async (queue) => {
        await queue.close();
      })
  );
}
