import { z } from 'zod';

/**
 * Zod schemas for the Pika video-meeting integration.
 *
 * The LaunchKit worker shells out to the vendored
 * `vendor/pikastream-video-meeting/scripts/pikastreaming_videomeeting.py`
 * CLI to join Google Meet calls as an AI teammate with a real video
 * face. The subprocess has a well-defined contract:
 *
 *   - `join` emits JSON lines on stdout:
 *       1. `{session_id, platform, status: "created"}`  (immediately after POST)
 *       2. `{session_id, status, video, bot}`           (on every subsequent status change)
 *   - `leave` emits a single line `{session_id, closed}` and exits 0 on success.
 *   - Exit codes: 0=ok, 1=no devkey, 2=validation, 3=http, 4=session error, 5=timeout, 6=funding
 *
 * Every schema here parses a single boundary — HTTP request body,
 * subprocess stdout JSON, BullMQ job payload, DB row read — so a
 * malformed input produces a structured error at the boundary with
 * the offending field named, not a chained-optional `undefined` ten
 * lines later.
 *
 * The Pika CLI is streaming: a single `join` invocation emits N
 * stdout lines, not just one. The wrapper reads lines one at a time
 * and parses each against `PikaSessionUpdateSchema` (the discriminated
 * union of "created" + "progress"), resolving the `startMeeting`
 * promise when a line matches the terminal `status: 'ready'` or the
 * `video && bot` condition enforced by the Python source at
 * `pikastreaming_videomeeting.py:314`.
 */

// ── Session lifecycle status (application-level enum) ────────────────
//
// `pika_meeting_sessions.status` is a `varchar(32)` column with
// application-level validation via this schema. It is NOT a pgEnum
// — the plan deliberately mirrors the `strategy_insights.insight_type`
// pattern for non-core tables. The six states form a linear state
// machine:
//
//     pending → joining → active → ending → ended
//                     ↓
//                   failed
//
// `pending`  — row inserted, BullMQ job not yet picked up.
// `joining`  — subprocess spawned; waiting for the Pika backend to
//              bring the bot online in the Meet.
// `active`   — `status=ready` observed; the avatar is in the meeting.
// `ending`   — user clicked "End meeting" OR the 30-minute auto-
//              timeout fired; BullMQ `PIKA_LEAVE` job is in flight.
// `ended`    — `leave` subprocess returned exit 0.
// `failed`   — the subprocess returned a non-zero exit code, OR the
//              wrapper timed out, OR a DB write error prevented the
//              state machine from advancing.
export const PikaSessionStatusSchema = z.enum([
  'pending',
  'joining',
  'active',
  'ending',
  'ended',
  'failed',
]);
export type PikaSessionStatus = z.infer<typeof PikaSessionStatusSchema>;

// ── Subprocess exit codes ────────────────────────────────────────────
//
// Exit codes documented at `vendor/pikastream-video-meeting/scripts/
// pikastreaming_videomeeting.py:28`. Each maps to a typed error class
// in `apps/worker/src/lib/pika-stream.ts` so the caller can branch on
// failure mode without string-matching stderr.
//
// Exit 1 is NOT listed in the script's header docstring but IS used
// by `get_api_config()` when PIKA_DEV_KEY is unset (line 62 of the
// Python source). Include it in the enum so the error-mapping switch
// in the TypeScript wrapper can handle it explicitly rather than
// falling through to a generic "unknown exit code" error.
export const PikaExitCodeSchema = z.union([
  z.literal(0), // success
  z.literal(1), // missing PIKA_DEV_KEY env var
  z.literal(2), // validation error (bad URL, missing file, unknown platform)
  z.literal(3), // HTTP error (non-2xx response from Pika)
  z.literal(4), // session error (Pika reported status=error|closed)
  z.literal(5), // timeout (subprocess reached --timeout-sec without ready)
  z.literal(6), // insufficient credits (stdout JSON has checkout_url)
]);
export type PikaExitCode = z.infer<typeof PikaExitCodeSchema>;

// ── Streaming JSON from the `join` subcommand ────────────────────────
//
// Emitted twice (or more) over the lifetime of a single `join` call:
//
//   1. Immediately after `POST /meeting-session` succeeds:
//        {session_id, platform, status: "created"}
//
//   2. On every subsequent poll that produces a status change:
//        {session_id, status, video, bot}
//
// We model the two with a single permissive schema rather than a
// discriminated union because the Python code reuses the same
// `session_id` field across both shapes and never distinguishes them
// on the wire. The fields unique to each shape are marked optional;
// the wrapper checks `status` + `video` + `bot` to decide when to
// resolve the outer promise.

export const PikaSessionUpdateSchema = z.object({
  session_id: z.string().min(1),
  // "created" only appears on the first emission. Subsequent lines
  // carry the lowercase poll status from Pika (`pending`, `connecting`,
  // `ready`, `error`, `closed`, or any future status value). The
  // schema stays open — future states are accepted as strings and
  // ignored by the wrapper, which only acts on `ready` and the
  // `video && bot` terminal condition.
  status: z.string().min(1),
  platform: z.string().optional(),
  video: z.boolean().optional(),
  bot: z.boolean().optional(),
  // When the session fails, Pika may emit an `error_message` field
  // alongside `status: "error"` (pikastreaming_videomeeting.py:317).
  // Stored on the wrapper's thrown `PikaSessionError` for surfacing
  // in the DB row's `error` column.
  error_message: z.string().optional(),
});
export type PikaSessionUpdate = z.infer<typeof PikaSessionUpdateSchema>;

// ── `leave` subcommand response ──────────────────────────────────────
//
// The Python source emits a single line:
//
//     {"session_id": "<id>", "closed": true}
//
// on exit 0. Any other exit code implies a non-zero response body was
// printed to stderr; the wrapper never parses this schema in the
// failure path.
//
// Note: since the pure-TS leave helper at `apps/worker/src/lib/
// pika-stream.ts:pikaDeleteSession` calls Pika's DELETE endpoint
// directly (bypassing the Python subprocess entirely), this schema
// is now primarily validating the SYNTHETIC return shape constructed
// by the leave helper after a successful HTTP DELETE. The subprocess
// is only used during the `join` flow; `leave` is pure HTTPS.
export const PikaLeaveResponseSchema = z.object({
  session_id: z.string().min(1),
  closed: z.literal(true),
});
export type PikaLeaveResponse = z.infer<typeof PikaLeaveResponseSchema>;

// ── Session state (GET /proxy/realtime/session/{id}) ────────────────
//
// The `pika-poll` background job hits Pika's session GET endpoint
// every 30 seconds while a session is `active` to decide whether
// the bot should stay or leave. This schema validates the fields
// the poller reads — anything else Pika returns is accepted via
// `.passthrough()` so a future backend field addition does not
// force a schema update.
//
// Field meanings from `cmd_join:305-318` in the vendored Python:
//
//   status                  — "created" | "connecting" | "ready" |
//                              "error" | "closed" | (future states)
//   video_worker_connected  — Pika's video worker (the avatar render
//                              pipeline) has joined and is streaming
//   video_connected         — alias on some responses
//   meeting_bot_connected   — the Meet participant seat is occupied
//                              by Pika's bot
//
// The poller treats `status === 'closed' | 'error'` as the signal
// to leave. A future participant-count field would enable the "bot
// is alone in the room for N polls" idle-detect heuristic; for the
// MVP we rely on Google Meet auto-closing solo meets after ~1 min
// and Pika's session flipping to `closed` in response.
export const PikaSessionStateSchema = z
  .object({
    status: z.string().optional(),
    video_worker_connected: z.boolean().optional(),
    video_connected: z.boolean().optional(),
    meeting_bot_connected: z.boolean().optional(),
    error_message: z.string().optional(),
  })
  .passthrough();
export type PikaSessionState = z.infer<typeof PikaSessionStateSchema>;

// ── Insufficient-credits JSON ────────────────────────────────────────
//
// When exit code 6 is returned, the last line of stdout carries an
// `ensure_funded()` JSON payload naming a checkout URL. The wrapper
// captures this to surface on the failed session row so the operator
// can click through and top up without having to read the worker
// logs (pikastreaming_videomeeting.py:182-189).
export const PikaNeedsTopupPayloadSchema = z.object({
  status: z.literal('needs_topup'),
  balance: z.number().int().nonnegative().optional(),
  product: z.string().optional(),
  credits: z.number().int().nonnegative().optional(),
  checkout_url: z.string().url().optional(),
  message: z.string().optional(),
});
export type PikaNeedsTopupPayload = z.infer<typeof PikaNeedsTopupPayloadSchema>;

// ── HTTP API: invite request body ────────────────────────────────────
//
// Validated inside `POST /api/projects/:projectId/meetings`. The
// `meetUrl` must be a valid URL; the route handler additionally
// rejects anything that isn't a Google Meet or Zoom link (matches the
// Python `infer_platform` function at lines 71-77).
//
// `botName` is optional at the HTTP boundary — the worker falls back
// to a project-derived default (`{project.displayName} teammate`) if
// the dashboard doesn't send one.
export const PikaInviteRequestSchema = z.object({
  meetUrl: z.string().url(),
  botName: z.string().min(1).max(80).optional(),
  voiceId: z.string().min(1).max(80).optional(),
});
export type PikaInviteRequest = z.infer<typeof PikaInviteRequestSchema>;

// ── BullMQ job payload shapes ────────────────────────────────────────
//
// The worker's `pika` queue carries two job types:
//
//   - `pika_invite` — fired by the web route on dashboard submit; the
//     processor loads the project, builds the system prompt, inserts
//     the session row, and spawns the `join` subprocess.
//
//   - `pika_leave` — fired by (a) the web route on dashboard End-click
//     and (b) the 30-minute delayed job auto-scheduled by the invite
//     processor after a successful join. The processor spawns the
//     `leave` subprocess and persists the cost event.

export const PikaInviteJobDataSchema = z.object({
  sessionRowId: z.string().uuid(),
  projectId: z.string().uuid(),
});
export type PikaInviteJobData = z.infer<typeof PikaInviteJobDataSchema>;

export const PikaLeaveJobDataSchema = z.object({
  sessionRowId: z.string().uuid(),
  // Marks whether the leave was scheduled by the auto-timeout delayed
  // job rather than an explicit user click. Used only for metrics in
  // the cost event metadata — the leave flow itself is identical.
  triggeredBy: z.enum(['user', 'auto_timeout']),
});
export type PikaLeaveJobData = z.infer<typeof PikaLeaveJobDataSchema>;

// ── Database row shape ───────────────────────────────────────────────
//
// `PikaMeetingSessionRowSchema` mirrors the columns of the drizzle
// `pikaMeetingSessions` table declared in `schema.ts` (Commit 3).
// Parsed at every read site via `parseJsonbColumn(...)` so a column
// drift between the writer and the reader surfaces at the boundary
// with the offending field named.
//
// `pikaSessionId` is nullable because it is only populated after the
// `join` subprocess emits its first `{session_id, platform, status:
// "created"}` line. The initial row insert happens before the
// subprocess spawns — if the worker crashes between insert and first
// line, the row is left with `pikaSessionId = null` and `status =
// 'joining'`, which a follow-up cron can reconcile (documented in
// CLAUDE.md as a deferred cleanup task).
// `z.coerce.date()` on every datetime field so the SAME schema
// parses both drizzle row reads (Date instances) and HTTP response
// reads (ISO strings after JSON round-trip). The alternative —
// two parallel schemas, one per boundary — is the pattern used by
// `AssetResponseSchema` in `./api.ts`, but that doubles the
// surface area and forces the web route to transform every row
// before return. A single coerced schema is less code and the
// output type is `Date` on both sides, which is the more useful
// type for the dashboard's elapsed-time math anyway.
export const PikaMeetingSessionRowSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  meetUrl: z.string(),
  botName: z.string(),
  avatarRef: z.string(),
  voiceId: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  pikaSessionId: z.string().nullable(),
  status: PikaSessionStatusSchema,
  error: z.string().nullable(),
  startedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  costCents: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type PikaMeetingSessionRow = z.infer<typeof PikaMeetingSessionRowSchema>;

// ── HTTP API: list / detail response shapes ──────────────────────────
//
// The dashboard polls `GET /api/projects/:id/meetings` every 5s while
// any session is in a non-terminal state. Return shape is a bare
// array plus a top-level wrapper so future fields (pagination,
// per-project quota usage) can land without a breaking change.

export const PikaMeetingSessionListResponseSchema = z.object({
  sessions: z.array(PikaMeetingSessionRowSchema),
});
export type PikaMeetingSessionListResponse = z.infer<
  typeof PikaMeetingSessionListResponseSchema
>;

export const PikaMeetingSessionDetailResponseSchema = z.object({
  session: PikaMeetingSessionRowSchema,
});
export type PikaMeetingSessionDetailResponse = z.infer<
  typeof PikaMeetingSessionDetailResponseSchema
>;

// ── HTTP API: invite response shape ──────────────────────────────────
//
// Returned from `POST /api/projects/:projectId/meetings`. The session
// row is persisted and the BullMQ job is enqueued before the handler
// returns, so the client immediately sees `status: 'pending'` and can
// poll the list endpoint for transitions.
export const PikaInviteResponseSchema = z.object({
  session: PikaMeetingSessionRowSchema,
});
export type PikaInviteResponse = z.infer<typeof PikaInviteResponseSchema>;
