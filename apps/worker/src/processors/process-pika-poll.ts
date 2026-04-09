import { eq } from 'drizzle-orm';
import {
  JOB_NAMES,
  PikaPollJobDataSchema,
  pikaMeetingSessions,
} from '@launchkit/shared';
import type { Job } from 'bullmq';

import { database as db } from '../lib/database.js';
import {
  fetchPikaSessionState,
  PikaHttpError,
  PikaSubprocessError,
} from '../lib/pika-stream.js';
import { pikaControlQueue } from '../lib/job-queues.js';

/**
 * BullMQ handler for `pika-poll` jobs.
 *
 * The poll job is the heartbeat of a live Pika session — it runs
 * every 30 seconds while the row is in `active` state and decides
 * whether the bot should stay in the meeting or leave.
 *
 * State machine
 * -------------
 *
 *   1. Load the session row.
 *      - If missing, the row was deleted — stop polling, no-op.
 *      - If status is terminal (ended | failed), stop polling, no-op.
 *      - If status is not yet `active`, re-enqueue with the normal
 *        30-s delay and try again next tick (may happen briefly
 *        during the `joining` → `active` transition).
 *
 *   2. Enforce the 60-minute safety cap.
 *      - If `startedAt` is non-null and age > 60 min, enqueue an
 *        immediate `pika-leave` with `triggeredBy='safety_cap'` and
 *        stop polling. Belt-and-suspenders against any runaway or
 *        orphaned session.
 *
 *   3. Fetch the Pika session state via `fetchPikaSessionState`.
 *      - On HTTP 404 (Pika does not know the session): enqueue
 *        `pika-leave` with `triggeredBy='pika_closed'`. The bot is
 *        already gone from Pika's side; our leave DELETE is a
 *        no-op but still runs so cost persistence fires.
 *      - On any other HTTP error: log and re-enqueue the poll. A
 *        transient upstream issue should not kill the session.
 *      - On 2xx with `status === 'closed'`: enqueue `pika-leave`
 *        with `triggeredBy='pika_closed'`. This fires when Google
 *        Meet ends naturally (host leaves, 1-person timeout, etc.).
 *      - On 2xx with `status === 'error'`: enqueue `pika-leave`
 *        with `triggeredBy='pika_error'`. The bot is broken on
 *        Pika's side; leave and mark the row failed.
 *      - Otherwise: re-enqueue the poll with a 30-s delay.
 *
 * Idempotency
 * -----------
 *
 * Every `pika-leave` enqueue uses a deterministic `jobId` of
 * `pika-leave-<triggeredBy>__<sessionRowId>` so repeated poll ticks
 * that reach the "leave now" branch cannot stack duplicate leave
 * jobs at the queue level — BullMQ drops the second `add` with the
 * same jobId as a no-op. The leave processor itself is also
 * terminal-status-idempotent, so even if two different trigger
 * sources fire, only the first one does actual work.
 *
 * Why a polling loop instead of a webhook
 * ---------------------------------------
 *
 * Pika does not expose a push notification when a meeting ends. The
 * only way to know the state is to ask. A 30-s poll cadence is
 * cheap (single HTTPS GET per tick, <200 bytes of traffic), has
 * <30 s worst-case termination latency, and does not require us to
 * expose a public webhook endpoint Pika would need to authenticate.
 * If Pika ships webhooks later, swap the polling loop for a webhook
 * receiver — the state machine above stays the same.
 */

// 60 minutes from start to the safety-cap leave. This is the
// runaway ceiling, not a usage limit — a legitimate meeting longer
// than 60 min should be possible by bumping this constant, but for
// a demo keeping it bounded prevents a forgotten session from
// draining the credit balance overnight.
const SAFETY_CAP_MS = 60 * 60 * 1000;

// Re-enqueue delay between polls. 30 s is a good balance between
// responsiveness (user who clicks End in the Meet UI should see
// the bot leave within ~half a minute) and cost (a 60-min meeting
// produces ~120 poll requests — negligible).
const POLL_INTERVAL_MS = 30 * 1000;

export async function processPikaPoll(job: Job): Promise<void> {
  const payload = PikaPollJobDataSchema.parse(job.data);
  const { sessionRowId } = payload;

  const [sessionRow] = await db
    .select()
    .from(pikaMeetingSessions)
    .where(eq(pikaMeetingSessions.id, sessionRowId));

  if (!sessionRow) {
    console.warn(`[PikaPoll] session row ${sessionRowId} not found, stopping`);
    return;
  }

  // Terminal statuses — stop polling.
  if (sessionRow.status === 'ended' || sessionRow.status === 'failed') {
    console.log(
      `[PikaPoll] session ${sessionRowId} already ${sessionRow.status}, stopping`
    );
    return;
  }

  // Pre-active — the bot hasn't finished the join handshake yet.
  // Re-enqueue and check again next tick.
  if (sessionRow.status !== 'active' || !sessionRow.pikaSessionId) {
    console.log(
      `[PikaPoll] session ${sessionRowId} status='${sessionRow.status}', waiting for active`
    );
    await reenqueuePoll(sessionRowId);
    return;
  }

  // 60-minute safety cap. `startedAt` is normally set when the
  // invite processor flips the row to `active`. In a crash window
  // between status='active' and the set of started_at, the column
  // can be null — in that case we fall back to `createdAt` as the
  // age baseline so the safety cap ALWAYS fires eventually. An
  // `active` session without a safety cap is the worst possible
  // failure mode: it could run forever and drain credits. Using
  // `createdAt` as a fallback is slightly generous (the bot has
  // been in the meeting for less time than `now - createdAt`), but
  // the baseline is still bounded and the session WILL terminate.
  const ageBaseline = sessionRow.startedAt ?? sessionRow.createdAt;
  const ageMs = Date.now() - ageBaseline.getTime();
  if (ageMs > SAFETY_CAP_MS) {
    console.log(
      `[PikaPoll] session ${sessionRowId} exceeded ${String(SAFETY_CAP_MS / 60_000)}-min safety cap ` +
        `(ageMs=${String(ageMs)}, baseline=${sessionRow.startedAt === null ? 'createdAt' : 'startedAt'}), ` +
        `enqueueing leave`
    );
    await enqueueLeave(sessionRowId, 'safety_cap');
    return;
  }

  // Fetch Pika's session state. On HTTP 404, the session is
  // already gone from Pika's side — leave immediately so the cost
  // event gets written and the row transitions cleanly.
  try {
    const state = await fetchPikaSessionState({
      pikaSessionId: sessionRow.pikaSessionId,
    });

    if (state.status === 'closed') {
      console.log(
        `[PikaPoll] session ${sessionRowId} reports status=closed on Pika's side, enqueueing leave`
      );
      await enqueueLeave(sessionRowId, 'pika_closed');
      return;
    }
    if (state.status === 'error') {
      console.warn(
        `[PikaPoll] session ${sessionRowId} reports status=error on Pika's side: ${state.error_message ?? '<no message>'}, enqueueing leave`
      );
      await enqueueLeave(sessionRowId, 'pika_error');
      return;
    }

    // Still healthy — re-enqueue the poll.
    await reenqueuePoll(sessionRowId);
  } catch (err) {
    if (err instanceof PikaHttpError && err.exitCode === 404) {
      // Session is gone from Pika's side. Treat as a natural close.
      console.log(
        `[PikaPoll] session ${sessionRowId} returned 404 from Pika, enqueueing leave`
      );
      await enqueueLeave(sessionRowId, 'pika_closed');
      return;
    }

    // Any other error is transient — log and retry the poll on
    // the next tick. We deliberately do NOT propagate the error
    // up to BullMQ because a transient upstream blip should not
    // cause BullMQ to retry with exponential backoff (which
    // could delay detection of a real termination).
    const message =
      err instanceof PikaSubprocessError
        ? `${err.name}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.warn(
      `[PikaPoll] session ${sessionRowId} state fetch failed, re-enqueueing: ${message}`
    );
    await reenqueuePoll(sessionRowId);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Re-enqueue the poll job with a 30-s delay. The jobId includes
 * a timestamp suffix so each tick gets a unique job id — a fixed
 * jobId would not work here because the SELF re-enqueue fires
 * while the current poll is still in BullMQ's `active` state,
 * and BullMQ drops any `add` whose jobId collides with a job in
 * `waiting`, `delayed`, OR `active` state. With a fixed jobId the
 * very first self-reenqueue would be silently dropped, the poll
 * would run exactly once per session, and auto-termination via
 * pika_closed / pika_error / safety_cap would never fire. Caught
 * on the first end-to-end auto-leave test — a session where
 * Pika reported `status=closed` within 2 minutes of the join
 * stayed `active` in our DB indefinitely because the poll only
 * ever ran once.
 *
 * The reviewer's original concern with timestamped jobIds was
 * chain multiplication under `attempts: 3` retries, but that
 * concern is moot here: this poll processor catches every error
 * in its outer try/catch and self-reenqueues on the transient
 * branch — it NEVER throws to BullMQ. The `attempts: 3` retry
 * path on the PIKA_CONTROL queue is effectively unused for
 * `pika-poll` jobs, so chain multiplication via retries is not
 * possible. The only edge case is a throw inside
 * `reenqueuePoll` itself (e.g. Redis blip mid-enqueue) — in
 * that rare case BullMQ WILL retry and we could briefly see two
 * poll chains before one fails again, converging within ~30 s.
 * The 60-min safety cap backstops this.
 *
 * `removeOnComplete: true` aggressively cleans up finished poll
 * jobs so the completed set does not grow to thousands of
 * rows over a long session.
 */
async function reenqueuePoll(sessionRowId: string): Promise<void> {
  await pikaControlQueue.add(
    JOB_NAMES.PIKA_POLL,
    { sessionRowId },
    {
      delay: POLL_INTERVAL_MS,
      jobId: `pika-poll__${sessionRowId}__${String(Date.now())}`,
      removeOnComplete: true,
    }
  );
}

/**
 * Enqueue a `pika-leave` job with a deterministic jobId scoped to
 * the trigger source. A second poll tick that tries to enqueue the
 * same `(sessionRowId, triggeredBy)` pair is dropped by BullMQ.
 */
async function enqueueLeave(
  sessionRowId: string,
  triggeredBy: 'safety_cap' | 'pika_closed' | 'pika_error'
): Promise<void> {
  await pikaControlQueue.add(
    JOB_NAMES.PIKA_LEAVE,
    { sessionRowId, triggeredBy },
    {
      jobId: `pika-leave-${triggeredBy}__${sessionRowId}`,
    }
  );
}
