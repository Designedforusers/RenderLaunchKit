import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  PikaInviteRequestSchema,
  PikaInviteResponseSchema,
  PikaMeetingSessionDetailResponseSchema,
  PikaMeetingSessionListResponseSchema,
  PikaMeetingSessionRowSchema,
  pikaMeetingSessions,
  projects,
} from '@launchkit/shared';
import { database } from '../lib/database.js';
import {
  enqueuePikaInvite,
  enqueuePikaLeave,
} from '../lib/job-queue-clients.js';
import { expensiveRouteRateLimit } from '../middleware/rate-limit.js';
import { parseUuidParam, invalidUuidResponse } from '../lib/validate-uuid.js';

/**
 * Routes for the Pika video-meeting integration.
 *
 * Mounted at `/api/projects` in `apps/web/src/index.ts` so the
 * relative `/:projectId/meetings*` paths resolve to
 * `/api/projects/:projectId/meetings*`. The mount point is shared
 * with `projectApiRoutes` and `projectCostRoutes` — Hono routes
 * the request to the first handler whose path matcher fits, and
 * the meetings subpath is distinct from every existing project
 * endpoint so there is no shadowing risk.
 *
 * Surface
 * -------
 *
 *   POST   /api/projects/:projectId/meetings
 *     Body: PikaInviteRequestSchema
 *     Creates a `pika_meeting_sessions` row at status='pending',
 *     enqueues a pika-invite BullMQ job, returns the fresh row.
 *     Returns 409 if a non-terminal session already exists for
 *     the project (one active meeting per project at a time).
 *
 *   GET    /api/projects/:projectId/meetings
 *     Returns every session row for the project, ordered by
 *     `created_at desc`. Used by the dashboard's polling view.
 *
 *   GET    /api/projects/:projectId/meetings/:sessionRowId
 *     Returns a single session row. Used by the dashboard when a
 *     row is first surfaced (the list endpoint is polled for
 *     status updates after that).
 *
 *   POST   /api/projects/:projectId/meetings/:sessionRowId/leave
 *     Enqueues an immediate pika-leave BullMQ job. Returns the
 *     updated row (which the worker will flip through `ending`
 *     → `ended` async). Idempotent against a row that is already
 *     terminal (returns 409 with a descriptive error) and against
 *     a row that is still pre-active (returns 409 too — the user
 *     is trying to cancel a join that is still in flight, which
 *     is a different operation we do not implement in the MVP).
 *
 * Validation invariants
 * ---------------------
 *
 *   1. Every request body parses through its Zod schema.
 *   2. Every response goes through a schema before return so a
 *      server-side invariant violation (unknown status value,
 *      malformed date) surfaces as a structured 500 at the web
 *      boundary instead of rendering garbage on the dashboard.
 *   3. The `meetUrl` is additionally filtered: we only accept
 *      Google Meet and Zoom hosts — the Python CLI infers the
 *      platform from the URL and rejects anything else with
 *      exit 2, so filtering at the route stops a doomed invite
 *      from ever enqueueing a BullMQ job.
 *   4. The bot name falls back to `${project.repoName} teammate`
 *      when the body does not supply one — the plan chose
 *      repo-derived defaults over a dashboard-side UX requirement.
 */

const pikaRoutes = new Hono();

const NON_TERMINAL_STATUSES = [
  'pending',
  'joining',
  'active',
  'ending',
] as const;

// ── POST /api/projects/:projectId/meetings ───────────────────────────

pikaRoutes.post('/:projectId/meetings', expensiveRouteRateLimit, async (c) => {
  const projectId = parseUuidParam(c, 'projectId');
  if (!projectId) return invalidUuidResponse(c);

  // Parse the body against the Zod schema at the boundary. A
  // malformed POST (missing meetUrl, non-URL value, botName too
  // long) surfaces as a 400 with a structured error naming the
  // failing field.
  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const parsed = PikaInviteRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid request body',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      400
    );
  }
  const { meetUrl, botName: botNameInput, voiceId } = parsed.data;

  // Platform inference — the Python CLI's `infer_platform` at
  // `vendor/pikastream-video-meeting/scripts/pikastreaming_videomeeting.py:71`
  // recognises `meet.google.com` (google_meet) and `zoom.us` /
  // `zoom.com` (zoom). Anything else produces exit 2 with an
  // unhelpful message; we filter at the route so the failure
  // surfaces as a structured 400 naming the problem and no
  // subprocess ever spawns.
  let host: string;
  try {
    host = new URL(meetUrl).host.toLowerCase();
  } catch {
    return c.json(
      {
        error:
          'meetUrl is not a valid URL (could not construct new URL())',
      },
      400
    );
  }
  const isGoogleMeet = host.includes('meet.google.com');
  const isZoom = host.includes('zoom.us') || host.includes('zoom.com');
  if (!isGoogleMeet && !isZoom) {
    return c.json(
      {
        error:
          'meetUrl must be a Google Meet or Zoom link. Pika does not currently support other meeting platforms.',
      },
      400
    );
  }

  // Ensure the project exists before we allocate a row — a stray
  // 404 here avoids an orphan row if the client calls with a bad
  // projectId.
  const project = await database.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  // 409 guard: at most one non-terminal session per project at a
  // time. The dashboard enforces this in its UI too, but a direct
  // API call (or a double click) would otherwise stack sessions
  // and confuse both the user and the cost chip.
  const activeSessions = await database
    .select({ id: pikaMeetingSessions.id, status: pikaMeetingSessions.status })
    .from(pikaMeetingSessions)
    .where(
      and(
        eq(pikaMeetingSessions.projectId, projectId),
        inArray(pikaMeetingSessions.status, [...NON_TERMINAL_STATUSES])
      )
    )
    .limit(1);
  if (activeSessions.length > 0) {
    return c.json(
      {
        error:
          'A meeting session is already active or in-flight for this project. End the existing session before starting a new one.',
        code: 'pika_session_conflict',
        activeSessionId: activeSessions[0]?.id,
      },
      409
    );
  }

  // Default bot name is `Bufo` — LaunchKit's AI teammate persona.
  // The dashboard invite modal can still override this on a
  // per-meeting basis by passing `botName` in the POST body, but
  // the fallback is no longer derived from the repo name. Bufo
  // is the persona across every project; the per-project context
  // (repo, launch strategy, generated assets) is injected into
  // the system prompt by `buildPikaSystemPrompt`, not into the
  // display name.
  const botName = botNameInput ?? 'Bufo';

  // `avatarRef` is stored on the row so the subprocess wrapper
  // can resolve it at spawn time and a regenerate path can
  // round-trip the same value. The wrapper reads
  // `env.PIKA_AVATAR` at spawn time; persisting a copy here is
  // purely for operator auditing / debugging, not for the
  // subprocess contract.
  const insertedRows = await database
    .insert(pikaMeetingSessions)
    .values({
      projectId,
      meetUrl,
      botName,
      // The raw PIKA_AVATAR value is not in the web env schema
      // (no `env.PIKA_AVATAR` on the web surface) because the web
      // service never spawns the subprocess. The row's
      // `avatar_ref` column records the placeholder
      // `<worker PIKA_AVATAR>` token as a provenance marker —
      // the real value is only visible to the worker process at
      // spawn time. Keeps the PIKA_AVATAR secret out of the web
      // service entirely.
      avatarRef: '<worker PIKA_AVATAR>',
      voiceId: voiceId ?? null,
    })
    .returning();
  const sessionRow = insertedRows[0];
  if (!sessionRow) {
    // INSERT RETURNING should always produce a row; if it did
    // not, the DB is broken enough that a 500 is the right
    // answer.
    return c.json({ error: 'Failed to persist session row' }, 500);
  }

  // Enqueue the invite job AFTER the row is persisted. If the
  // queue is transiently unavailable, flip the row to `failed` so
  // the 409 guard does not permanently block future invites for
  // this project.
  try {
    await enqueuePikaInvite({
      sessionRowId: sessionRow.id,
      projectId,
    });
  } catch {
    await database
      .update(pikaMeetingSessions)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(pikaMeetingSessions.id, sessionRow.id));
    return c.json(
      { error: 'Failed to enqueue meeting invite — please retry' },
      503
    );
  }

  // Parse the row through the schema before return so a
  // drizzle-vs-Zod drift surfaces here, not on the dashboard.
  const rowParse = PikaMeetingSessionRowSchema.safeParse(sessionRow);
  if (!rowParse.success) {
    console.error(
      `[pika-routes] session row failed schema parse for project ${projectId}:`,
      rowParse.error.issues
    );
    return c.json(
      { error: 'Session row did not match expected shape' },
      500
    );
  }

  const response = PikaInviteResponseSchema.parse({ session: rowParse.data });
  return c.json(response, 201);
});

// ── GET /api/projects/:projectId/meetings ────────────────────────────

pikaRoutes.get('/:projectId/meetings', async (c) => {
  const projectId = parseUuidParam(c, 'projectId');
  if (!projectId) return invalidUuidResponse(c);

  const rows = await database
    .select()
    .from(pikaMeetingSessions)
    .where(eq(pikaMeetingSessions.projectId, projectId))
    .orderBy(desc(pikaMeetingSessions.createdAt));

  const parsed = PikaMeetingSessionListResponseSchema.safeParse({
    sessions: rows,
  });
  if (!parsed.success) {
    console.error(
      `[pika-routes] list response failed schema parse for project ${projectId}:`,
      parsed.error.issues
    );
    return c.json({ error: 'Response did not match expected shape' }, 500);
  }
  return c.json(parsed.data);
});

// ── GET /api/projects/:projectId/meetings/:sessionRowId ──────────────

pikaRoutes.get('/:projectId/meetings/:sessionRowId', async (c) => {
  const projectId = parseUuidParam(c, 'projectId');
  if (!projectId) return invalidUuidResponse(c);
  const sessionRowId = parseUuidParam(c, 'sessionRowId');
  if (!sessionRowId) return invalidUuidResponse(c);

  const [row] = await database
    .select()
    .from(pikaMeetingSessions)
    .where(
      and(
        eq(pikaMeetingSessions.id, sessionRowId),
        eq(pikaMeetingSessions.projectId, projectId)
      )
    )
    .limit(1);

  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const parsed = PikaMeetingSessionDetailResponseSchema.safeParse({
    session: row,
  });
  if (!parsed.success) {
    console.error(
      `[pika-routes] detail response failed schema parse for session ${sessionRowId}:`,
      parsed.error.issues
    );
    return c.json({ error: 'Response did not match expected shape' }, 500);
  }
  return c.json(parsed.data);
});

// ── POST /api/projects/:projectId/meetings/:sessionRowId/leave ───────

pikaRoutes.post('/:projectId/meetings/:sessionRowId/leave', async (c) => {
  const projectId = parseUuidParam(c, 'projectId');
  if (!projectId) return invalidUuidResponse(c);
  const sessionRowId = parseUuidParam(c, 'sessionRowId');
  if (!sessionRowId) return invalidUuidResponse(c);

  const [row] = await database
    .select()
    .from(pikaMeetingSessions)
    .where(
      and(
        eq(pikaMeetingSessions.id, sessionRowId),
        eq(pikaMeetingSessions.projectId, projectId)
      )
    )
    .limit(1);

  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (row.status === 'ended' || row.status === 'failed') {
    return c.json(
      {
        error: `Session already ${row.status}; leave is a no-op.`,
        code: 'pika_session_terminal',
      },
      409
    );
  }

  if (row.status === 'pending' || row.status === 'joining') {
    // The invite flow hasn't produced a pika_session_id yet, so
    // `endMeeting` would have nothing to DELETE. The MVP does not
    // implement "cancel a pending join" — the user should wait
    // for the join to succeed or fail, then leave, or wait for
    // the 30-minute auto-timeout.
    return c.json(
      {
        error:
          'Session has not yet fully joined the meeting. Wait for status to reach "active" before leaving, or let the 30-minute auto-timeout clean it up.',
        code: 'pika_session_not_active',
      },
      409
    );
  }

  // status is `active` or `ending` — both are safe to enqueue
  // against. An `ending` session with a user-initiated leave is
  // redundant but harmless (the leave processor's terminal-status
  // guard will turn the second one into a no-op), so we accept
  // the call and let the worker sort it out.
  await enqueuePikaLeave({
    sessionRowId,
    triggeredBy: 'user',
  });

  const parsed = PikaMeetingSessionRowSchema.safeParse(row);
  if (!parsed.success) {
    console.error(
      `[pika-routes] leave response failed schema parse for session ${sessionRowId}:`,
      parsed.error.issues
    );
    return c.json({ error: 'Response did not match expected shape' }, 500);
  }
  return c.json({ session: parsed.data });
});

export default pikaRoutes;
