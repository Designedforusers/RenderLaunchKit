import { eq } from 'drizzle-orm';
import {
  PikaInviteJobDataSchema,
  JOB_NAMES,
  pikaMeetingSessions,
  projects,
  assets as assetsTable,
} from '@launchkit/shared';
import type { Job } from 'bullmq';

import { database as db } from '../lib/database.js';
import {
  startMeeting,
  PikaInsufficientCreditsError,
  PikaMissingKeyError,
  PikaMissingAvatarError,
  PikaSubprocessError,
} from '../lib/pika-stream.js';
import { buildPikaSystemPrompt } from '../lib/pika-system-prompt-builder.js';
import { pikaQueue } from '../lib/job-queues.js';

/**
 * BullMQ handler for `pika-invite` jobs.
 *
 * Flow:
 *
 *   1. Validate the job payload through Zod.
 *   2. Load the previously-inserted session row (the web route
 *      creates the row at `status='pending'` before enqueueing).
 *   3. Load the project + its assets so the system prompt builder
 *      has everything it needs.
 *   4. Build the per-project system prompt (≤ 4 KB).
 *   5. Flip the row to `status='joining'` and persist the prompt.
 *   6. Spawn the Python `join` subprocess via `startMeeting`.
 *   7. On success: flip to `active`, persist `pika_session_id`
 *      and `started_at`, and schedule the 30-minute delayed
 *      `pika-leave` job so a forgotten meeting does not bill
 *      indefinitely.
 *   8. On failure: flip to `failed`, persist the error message
 *      (and a topup URL when the failure was insufficient
 *      credits), and re-throw so BullMQ marks the job failed.
 *
 * All DB writes in the terminal-state path (success and failure)
 * are try/catch'd so a row-update failure never swallows the
 * subprocess result. The invariant is "the session row is the
 * source of truth" — so we always try to advance it, even when
 * the previous advance hiccupped.
 */
export async function processPikaInvite(job: Job): Promise<void> {
  const payload = PikaInviteJobDataSchema.parse(job.data);
  const { sessionRowId, projectId } = payload;

  const [sessionRow] = await db
    .select()
    .from(pikaMeetingSessions)
    .where(eq(pikaMeetingSessions.id, sessionRowId));

  if (!sessionRow) {
    // The row the web route was supposed to insert is gone — most
    // likely the user deleted the project between click and job
    // pickup. Nothing to do.
    console.warn(
      `[PikaInvite] session row ${sessionRowId} not found, skipping`
    );
    return;
  }

  if (sessionRow.status !== 'pending') {
    // A previous attempt already advanced the row (e.g. the same
    // job id was re-enqueued or another worker picked it up). Be
    // idempotent and skip.
    console.warn(
      `[PikaInvite] session row ${sessionRowId} has status "${sessionRow.status}", skipping invite`
    );
    return;
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) {
    await markSessionFailed(sessionRowId, `Project ${projectId} not found`);
    throw new Error(
      `[PikaInvite] project ${projectId} not found for session ${sessionRowId}`
    );
  }

  const projectAssets = await db
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.projectId, projectId));

  const systemPrompt = buildPikaSystemPrompt({
    project: {
      repoOwner: project.repoOwner,
      repoName: project.repoName,
      repoUrl: project.repoUrl,
      repoAnalysis: project.repoAnalysis,
      research: project.research,
      strategy: project.strategy,
    },
    assets: projectAssets.map((asset) => ({
      type: asset.type,
      metadata: asset.metadata,
      content: asset.content,
    })),
    botName: sessionRow.botName,
  });

  // Flip to `joining` and persist the prompt before spawning so
  // the dashboard's polling view sees the transition immediately
  // and the prompt is stored even if the worker crashes between
  // the spawn and the next row update.
  await db
    .update(pikaMeetingSessions)
    .set({
      status: 'joining',
      systemPrompt,
      updatedAt: new Date(),
    })
    .where(eq(pikaMeetingSessions.id, sessionRowId));

  try {
    const result = await startMeeting({
      meetUrl: sessionRow.meetUrl,
      botName: sessionRow.botName,
      systemPrompt,
      voiceId: sessionRow.voiceId,
    });

    // Happy path: flip to active, persist the pika session id,
    // set started_at, and schedule the auto-leave delayed job.
    const startedAt = new Date();
    await db
      .update(pikaMeetingSessions)
      .set({
        status: 'active',
        pikaSessionId: result.pikaSessionId,
        startedAt,
        updatedAt: startedAt,
      })
      .where(eq(pikaMeetingSessions.id, sessionRowId));

    // Schedule the auto-leave. The delayed job's `jobId` is
    // deterministic on `sessionRowId` so a retry of the invite
    // cannot stack up duplicate leave jobs — the second add
    // with the same jobId is a BullMQ no-op.
    const AUTO_LEAVE_MS = 30 * 60 * 1000;
    await pikaQueue.add(
      JOB_NAMES.PIKA_LEAVE,
      { sessionRowId, triggeredBy: 'auto_timeout' },
      {
        delay: AUTO_LEAVE_MS,
        jobId: `pika-leave-auto__${sessionRowId}`,
      }
    );

    console.log(
      `[PikaInvite] session ${sessionRowId} joined: pika_session=${result.pikaSessionId}, auto-leave in ${String(AUTO_LEAVE_MS / 1000)}s`
    );
  } catch (err) {
    // Dump the full forensic state before mapping to a message.
    // The error-to-message extraction (`extractErrorMessage`)
    // reduces the failure to a single line so the `error` column
    // on the session row stays compact, but we also want the full
    // stdout + stderr + exit code in the worker log for triage
    // when something goes wrong. The upstream Python CLI prints
    // useful progress info to both streams and throwing that
    // away on failure is the kind of thing that turns a 5-minute
    // debug into a 50-minute one.
    if (err instanceof PikaSubprocessError) {
      console.error(
        `[PikaInvite] session ${sessionRowId} failed (exit ${String(err.exitCode)}, ${err.name})`
      );
      if (err.stdout.length > 0) {
        console.error(`[PikaInvite] stdout:\n${err.stdout.slice(0, 4000)}`);
      }
      if (err.stderr.length > 0) {
        console.error(`[PikaInvite] stderr:\n${err.stderr.slice(0, 4000)}`);
      }
    } else {
      console.error(`[PikaInvite] session ${sessionRowId} failed:`, err);
    }
    const message = extractErrorMessage(err);
    await markSessionFailed(sessionRowId, message);
    // Re-throw so BullMQ records the job as failed and the
    // worker's `failed` event handler logs the error.
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Flip a session row to `failed` with a persisted error message.
 * Swallows its own DB failure — the caller already has a more
 * informative error to propagate.
 */
async function markSessionFailed(
  sessionRowId: string,
  errorMessage: string
): Promise<void> {
  const now = new Date();
  try {
    await db
      .update(pikaMeetingSessions)
      .set({
        status: 'failed',
        // Cap the error text at 4 KB so a chatty subprocess
        // traceback cannot blow the column size. The TEXT
        // column has no hard cap, but the dashboard rendering
        // surface does.
        error: errorMessage.slice(0, 4 * 1024),
        endedAt: now,
        updatedAt: now,
      })
      .where(eq(pikaMeetingSessions.id, sessionRowId));
  } catch (err) {
    console.error(
      `[PikaInvite] failed to mark session ${sessionRowId} as failed:`,
      err
    );
  }
}

/**
 * Extract a user-surfaceable error message from any exception
 * thrown by `startMeeting`. Credits failures get their checkout
 * URL appended so the dashboard row surfaces it directly.
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof PikaInsufficientCreditsError && err.checkoutUrl) {
    return `Insufficient Pika credits. Top up at: ${err.checkoutUrl}`;
  }
  if (err instanceof PikaMissingKeyError) {
    return 'PIKA_API_KEY is not configured on the worker. Set it in your environment.';
  }
  if (err instanceof PikaMissingAvatarError) {
    return 'PIKA_AVATAR is not configured on the worker. Set it to an image file path or https URL.';
  }
  if (err instanceof PikaSubprocessError) {
    return `${err.name}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
