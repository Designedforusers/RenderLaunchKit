import { eq } from 'drizzle-orm';
import {
  PikaLeaveJobDataSchema,
  assetCostEvents,
  computePikaMeetingCostCents,
  pikaMeetingSessions,
} from '@launchkit/shared';
import type { Job } from 'bullmq';

import { database as db } from '../lib/database.js';
import { endMeeting, PikaSubprocessError } from '../lib/pika-stream.js';

/**
 * BullMQ handler for `pika-leave` jobs.
 *
 * Two entry points:
 *
 *   1. User-initiated: the dashboard's End Meeting button POSTs
 *      to the web route, which enqueues a `pika-leave` job with
 *      `triggeredBy: 'user'`.
 *
 *   2. Auto-timeout: the invite processor schedules a delayed
 *      `pika-leave` job with `triggeredBy: 'auto_timeout'` 30
 *      minutes after the bot joined. If the user's click arrives
 *      first, the delayed job sees a terminal status and no-ops.
 *
 * The handler is idempotent-by-terminal-status: a session that is
 * already `ended` or `failed` produces an early return with a
 * warning log but no error. A session that is still `joining` or
 * `pending` (the subprocess never progressed far enough to capture
 * a `pika_session_id`) is flipped straight to `failed` with a
 * structured error — calling `endMeeting` without a session id is
 * not valid.
 *
 * Cost tracking is non-blocking. A failed insert into
 * `asset_cost_events` is logged and swallowed so the row's
 * terminal state (`ended` + `cost_cents`) always advances.
 */
export async function processPikaLeave(job: Job): Promise<void> {
  const payload = PikaLeaveJobDataSchema.parse(job.data);
  const { sessionRowId, triggeredBy } = payload;

  const [sessionRow] = await db
    .select()
    .from(pikaMeetingSessions)
    .where(eq(pikaMeetingSessions.id, sessionRowId));

  if (!sessionRow) {
    // Row was deleted between invite and leave. Nothing to do —
    // the delayed auto-leave job can land on a wiped project.
    console.warn(
      `[PikaLeave] session row ${sessionRowId} not found, skipping`
    );
    return;
  }

  // Idempotent on terminal status. A user-initiated leave that
  // arrives after the auto-timeout already ran is a no-op — and
  // vice versa.
  if (sessionRow.status === 'ended' || sessionRow.status === 'failed') {
    console.log(
      `[PikaLeave] session ${sessionRowId} already ${sessionRow.status} (triggeredBy=${triggeredBy}), skipping`
    );
    return;
  }

  // A session in `pending` or `joining` with no pika_session_id
  // means the subprocess never produced its first stdout line —
  // there's nothing to leave. Mark the row failed and record no
  // cost (never-started guard).
  if (!sessionRow.pikaSessionId) {
    const now = new Date();
    await db
      .update(pikaMeetingSessions)
      .set({
        status: 'failed',
        error:
          'Leave fired but no pika_session_id was ever captured — the invite subprocess may have crashed before emitting a session id.',
        endedAt: now,
        updatedAt: now,
      })
      .where(eq(pikaMeetingSessions.id, sessionRowId));
    console.warn(
      `[PikaLeave] session ${sessionRowId} had no pika_session_id; marked failed`
    );
    return;
  }

  // Advance to `ending` before calling the subprocess so the
  // dashboard's polling view shows the transition immediately.
  await db
    .update(pikaMeetingSessions)
    .set({
      status: 'ending',
      updatedAt: new Date(),
    })
    .where(eq(pikaMeetingSessions.id, sessionRowId));

  // Call the subprocess. Any failure here still lets us advance
  // the row to `ended` because the Pika backend may have already
  // cleaned up (e.g., Meet ended naturally, credits expired),
  // and we still want the dashboard to reflect the final state.
  let subprocessError: Error | null = null;
  try {
    await endMeeting({ pikaSessionId: sessionRow.pikaSessionId });
  } catch (err) {
    subprocessError = err instanceof Error ? err : new Error(String(err));
    console.warn(
      `[PikaLeave] endMeeting failed for ${sessionRowId}: ${subprocessError.message}`
    );
  }

  // Compute the billable duration from started_at → now.
  const endedAt = new Date();
  const startedAt = sessionRow.startedAt ?? endedAt;
  const durationSeconds = Math.max(
    0,
    Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
  );
  const costCents = computePikaMeetingCostCents(durationSeconds);

  // Flip to the terminal state. If the subprocess failed and we
  // had to fall through, still mark the row `ended` (the bot is
  // not in the meeting anymore regardless of whether our leave
  // call hit its mark); but also persist the subprocess error so
  // the operator can see what happened.
  const terminalError = subprocessError
    ? formatSubprocessError(subprocessError)
    : null;
  await db
    .update(pikaMeetingSessions)
    .set({
      status: 'ended',
      endedAt,
      costCents,
      ...(terminalError !== null ? { error: terminalError } : {}),
      updatedAt: endedAt,
    })
    .where(eq(pikaMeetingSessions.id, sessionRowId));

  console.log(
    `[PikaLeave] session ${sessionRowId} ended (triggeredBy=${triggeredBy}): duration=${String(durationSeconds)}s, cost=${String(costCents)}¢`
  );

  // Persist the cost event. Session-scoped rows set
  // `asset_id=NULL` and rely on `project_id` for aggregation —
  // this is the code path that consumes the nullability
  // relaxation added in migration 0010.
  //
  // Non-blocking: a failure here logs and continues. The row's
  // own `cost_cents` column already has the total, so the
  // dashboard still renders the per-session cost correctly even
  // if the aggregate log missed this row.
  try {
    await db.insert(assetCostEvents).values({
      assetId: null,
      projectId: sessionRow.projectId,
      provider: 'pika',
      operation: 'meeting-session',
      inputUnits: null,
      outputUnits: durationSeconds,
      costCents,
      metadata: {
        sessionRowId,
        pikaSessionId: sessionRow.pikaSessionId,
        triggeredBy,
        botName: sessionRow.botName,
      },
    });
  } catch (err) {
    console.error(
      `[PikaLeave] cost event insert failed for ${sessionRowId}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

function formatSubprocessError(err: Error): string {
  if (err instanceof PikaSubprocessError) {
    return `${err.name}: ${err.message}`.slice(0, 4 * 1024);
  }
  return err.message.slice(0, 4 * 1024);
}
