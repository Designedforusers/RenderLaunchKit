# Pika video meeting integration

LaunchKit's AI teammate grows a face. This doc explains how a user click on the project dashboard turns into a Pika-hosted avatar walking into a live Google Meet with full context on the project — and what the architectural rules are for extending the integration.

If you only read one section of this doc, read [The "do not auto-invoke" invariant](#the-do-not-auto-invoke-invariant). It's the rule that shapes every other design decision.

---

## The "do not auto-invoke" invariant

> **A Pika session is only ever started by an explicit user click on the dashboard.** No strategist heuristic picks Pika. No review loop spawns a session. No cron auto-joins a meet. Every invite is a user pressing the Invite AI teammate to a meet button.

Why this is the load-bearing constraint:

1. **A session burns real money.** Pika bills $0.275/minute of bot runtime. A runaway auto-invite could drain credits in the background without the operator seeing anything.
2. **An unexpected avatar is a UX disaster.** Video meetings are synchronous and trust-sensitive. An AI face joining a live conversation without an explicit invite would erode user trust in a way that is very hard to recover from.
3. **The user should always be the context switcher.** Inviting the teammate into a meeting is a different user intent than generating content — the two flows should NOT share a trigger surface.

Every part of the integration is built around this. There is no BullMQ auto-enqueue, no scheduled-job path, no webhook handler that calls the invite route. The only producer is `POST /api/projects/:projectId/meetings` from a dashboard button click.

---

## Architecture

```
User clicks "Invite AI teammate"
              │
              ▼
┌─────────────────────────────┐
│ Dashboard  (PikaMeetingCard)│
│ React + Vite SPA            │
└─────────────┬───────────────┘
              │ POST /api/projects/:id/meetings
              ▼
┌─────────────────────────────┐
│ Web service (Hono)          │
│ Validates meet URL          │
│ Inserts pika_meeting_sessions│
│   row at status='pending'   │
│ Enqueues pika-invite job    │
└─────────────┬───────────────┘
              │ BullMQ (Redis)
              ▼
┌─────────────────────────────┐
│ Worker (process-pika-invite)│
│ Loads project + assets      │
│ Builds system prompt        │
│ Flips row to 'joining'      │
│ Spawns Python subprocess    │
└─────────────┬───────────────┘
              │ child_process.spawn
              ▼
┌─────────────────────────────┐
│ vendor/pikastream-video-    │
│ meeting/scripts/            │
│ pikastreaming_videomeeting.py│
│ (Python CLI, ~600 lines)    │
└─────────────┬───────────────┘
              │ HTTPS
              ▼
┌─────────────────────────────┐
│ Pika SaaS (api.worldlabs... │
│ pika.art)                   │
│ Headless browser, Google    │
│ Meet auth, WebRTC, avatar   │
│ render, voice synth         │
└─────────────┬───────────────┘
              │
              ▼
         Google Meet
```

Every arrow is a boundary we validate at:

- **Dashboard → Web:** `PikaInviteRequestSchema` parses the POST body. Invalid URLs get a 400 with a structured error list.
- **Web → DB:** the insert uses the drizzle `pikaMeetingSessions` table from `packages/shared/src/schema.ts`; the column shape is authoritative.
- **Web → BullMQ:** `PikaInviteJobDataSchema` parses the job payload.
- **Worker → Python:** the wrapper writes a tmp file for the system prompt and passes it via `--system-prompt-file`; the CLI args are shell-quoted by `child_process.spawn`.
- **Python → Worker:** `PikaSessionUpdateSchema` + `PikaLeaveResponseSchema` + `PikaNeedsTopupPayloadSchema` parse every line of stdout. Non-JSON lines are ignored silently.
- **Worker → DB:** every row update goes through drizzle's typed query builder.

---

## The Python subprocess

We vendor Pika's reference client at `vendor/pikastream-video-meeting/`. The skill is Apache 2.0 and pinned to a specific upstream commit SHA — see `vendor/README.md` for the refresh procedure.

Four subcommands are available; we use two:

| Subcommand | Used? | Purpose |
|---|---|---|
| `join`             | ✅ | Connect the bot to a live Google Meet / Zoom call |
| `leave`            | ✅ | Disconnect the bot and close the session |
| `generate-avatar`  | ❌ | Create a new avatar image via OpenAI proxy (we supply our own) |
| `clone-voice`      | ❌ | Upload a voice sample for cloning (we use the default voice) |

### `join` contract

```bash
python3 vendor/pikastream-video-meeting/scripts/pikastreaming_videomeeting.py join \
  --meet-url https://meet.google.com/abc-defg-hij \
  --bot-name "LaunchKit Teammate" \
  --image /path/to/avatar.png \
  --system-prompt-file /tmp/pika-stream-xxx/system-prompt.txt \
  --voice-id English_radiant_girl \
  --timeout-sec 200
```

**Stdout:** the subprocess emits JSON lines. The first is always:

```json
{"session_id":"<id>","platform":"google_meet","status":"created"}
```

Then subsequent lines are emitted on every poll-loop status change:

```json
{"session_id":"<id>","status":"ready","video":true,"bot":true}
```

The subprocess exits `0` when it observes `status=ready` OR (`video=true` AND `bot=true`). The wrapper captures the `session_id` from any of the parsed lines and uses it for the leave call later.

**The 90-second wall.** The `--timeout-sec` flag bounds the subprocess's own polling wait. The TypeScript wrapper's `AbortController` wall-clock is set slightly longer (240 s) so a subprocess timeout produces exit 5 → `PikaTimeoutError` rather than a forced kill. Both timeouts together mean a hung join NEVER exceeds 4 minutes of wall time.

### `leave` contract

```bash
python3 vendor/pikastream-video-meeting/scripts/pikastreaming_videomeeting.py leave \
  --session-id <id>
```

**Stdout:** a single line on exit 0:

```json
{"session_id":"<id>","closed":true}
```

### Exit code → error class mapping

| Exit | Error class | Meaning |
|---|---|---|
| 0 | (success) | bot joined (or leave succeeded) |
| 1 | `PikaMissingKeyError` | `PIKA_DEV_KEY` missing at subprocess boot |
| 2 | `PikaValidationError` | bad URL, missing image file, unknown platform |
| 3 | `PikaHttpError` | non-2xx response from Pika |
| 4 | `PikaSessionError` | Pika reported `status=error` or `status=closed` |
| 5 | `PikaTimeoutError` | subprocess reached `--timeout-sec` without ready |
| 6 | `PikaInsufficientCreditsError` | funding check failed; carries `checkoutUrl` |

The mapping lives in `apps/worker/src/lib/pika-stream.ts:mapExitCodeToError`. An unknown exit code falls back to `PikaSubprocessError` (the base class) with the raw code in the message so triage can find it.

---

## Env var mapping: `PIKA_API_KEY` → `PIKA_DEV_KEY`

LaunchKit's codebase uses `PIKA_API_KEY` in its `.env` surface for naming consistency with every other `*_API_KEY` we have. The upstream Python CLI reads from `PIKA_DEV_KEY`. The wrapper performs the rename at spawn time:

```ts
// apps/worker/src/lib/pika-stream.ts
child = spawn('python3', args, {
  env: {
    ...process.env,
    PIKA_DEV_KEY: input.apiKey,  // our env.PIKA_API_KEY
  },
  cwd: REPO_ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
```

The rest of our code never sees `PIKA_DEV_KEY`, and a grep for `PIKA_API_KEY` lands every consumer (the env schema, the wrapper, the docs, the render.yaml entry, `.env.example`).

---

## `PIKA_AVATAR` — local path or HTTPS URL

The `PIKA_AVATAR` env var is passed verbatim to the Python CLI's `--image` flag. The Python CLI transparently handles both forms at `pikastreaming_videomeeting.py:232-247`:

- **Absolute local path** (e.g. `/Users/nick/Pictures/me.png`): used directly.
- **HTTPS URL** (e.g. `https://storage.example.com/avatar.png`): downloaded to a temp file, used, then cleaned up.

**Local dev:** use a local path. Drop a headshot somewhere stable on your Mac and paste the absolute path into `.env`.

**Production (Render deploy):** use an HTTPS URL. The Render worker container has no persistent filesystem, so any local file path would break on the first restart. Host the avatar on R2 / S3 / Cloudinary / a raw GitHub URL and paste the public https URL.

**Privacy:** `PIKA_AVATAR` is user-private. The wrapper's error messages redact the meet URL's query string (Zoom encodes passwords there) and NEVER quote the avatar ref. The web service's typed env schema does NOT include `PIKA_AVATAR` — only the worker reads it at spawn time, so the secret stays scoped to the one service that needs it.

---

## BullMQ queue + session lifecycle

The `pika` BullMQ queue carries two job names:

| Job name | Producer | Purpose |
|---|---|---|
| `pika-invite` | web service on user click | kick off the `join` subprocess |
| `pika-leave`  | web service (user End click) OR worker invite processor (30-min delayed auto-timeout) | kick off the `leave` subprocess |

Queue config in `packages/shared/src/constants.ts`:

- `concurrency: 2` — max two active joins at once per worker process
- `attempts: 1` — deliberate. A failed join with a structured error (exit 2-6) will NOT get better on retry, and a second attempt would burn Pika credits for nothing. The retry story is the user clicking Invite again, not a BullMQ retry loop.
- `PIKA_INVITE timeout: 300_000 ms` (5 min) — generous cover for the ~90 s join flow plus a slow Meet auth handshake
- `PIKA_LEAVE timeout: 90_000 ms` (90 s) — single HTTP DELETE + DB writes

### Session lifecycle state machine

```
pending → joining → active → ending → ended
                        ↘ failed (from any non-terminal state)
```

| State | Set by | Meaning |
|---|---|---|
| `pending`  | web route (insert) | row created, BullMQ job not yet picked up |
| `joining`  | invite processor   | subprocess spawned, waiting for Pika to bring bot online |
| `active`   | invite processor   | `status=ready` observed, bot is in the meeting |
| `ending`   | leave processor    | `leave` subprocess in flight |
| `ended`    | leave processor    | `leave` subprocess returned exit 0 |
| `failed`   | invite or leave    | any non-zero exit code, timeout, or DB write error |

The invite processor schedules a delayed `pika-leave` job 30 minutes after a successful join, with a deterministic `jobId` (`pika-leave-auto__<sessionRowId>`) so retries cannot stack duplicates. The user's End click enqueues a separate `pika-leave-user__<sessionRowId>` job. Both paths land on the same leave processor; whichever fires first terminates the session, and the second sees a terminal row and no-ops via the idempotency guard at `process-pika-leave.ts`.

---

## Cost tracking

Pika bills at a flat $0.275/minute of bot runtime. The rate is set in `packages/shared/src/pricing.ts`:

```ts
export const PIKA_PRICING: { centsPerMinute: number } = {
  centsPerMinute: 27.5,
};

export function computePikaMeetingCostCents(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return Math.ceil((durationSeconds / 60) * PIKA_PRICING.centsPerMinute);
}
```

At leave time, the worker computes:

```ts
const endedAt = new Date();
const startedAt = sessionRow.startedAt ?? endedAt;
const durationSeconds = Math.max(
  0,
  Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
);
const costCents = computePikaMeetingCostCents(durationSeconds);
```

The cost is persisted in two places:

1. **`pika_meeting_sessions.cost_cents`** on the row itself, so the dashboard can render the per-session cost without a second query.
2. **`asset_cost_events`** with `asset_id=NULL` and `provider='pika'`, so the project cost chip picks up Pika spend via the existing `GROUP BY provider` aggregation query.

The column nullability for `asset_cost_events.asset_id` was relaxed in `migrations/0010_pika_meeting_sessions.sql` specifically so session-scoped cost events can share the existing aggregation surface. Per-asset events (Anthropic, fal, ElevenLabs, World Labs, Voyage) still populate `asset_id` exactly as before; only the Pika leave path writes `NULL`.

**Non-blocking.** A failure inside the `asset_cost_events` insert is logged and swallowed. The session row's own `cost_cents` column has the total regardless, so the per-session display stays correct even if the aggregate log missed the row.

---

## Troubleshooting

### "Insufficient Pika credits"

The session row surfaces `Insufficient Pika credits. Top up at: https://pika.me/checkout/...`. Click the URL, complete the top-up, and click Invite again. The failed row stays in the history list; you do not need to delete it.

Exit code 6 carries the `checkout_url` in the subprocess stdout JSON via `PikaNeedsTopupPayloadSchema`; the wrapper extracts it and puts it in the `error` column.

### "PIKA_API_KEY is not configured on the worker"

The typed env var is unset. Add `PIKA_API_KEY=dk_...` to your `.env` (local) or the worker service's env page (Render) and restart.

### "PIKA_AVATAR is not configured on the worker"

Same as above but for `PIKA_AVATAR`. Use an absolute local path (dev) or HTTPS URL (prod).

### "Session has not yet fully joined the meeting"

The user tried to click End while the session was in `pending` or `joining`. The MVP does not implement "cancel a pending join" — wait for `active` or let the 30-minute auto-timeout clean the session up.

### "A meeting session is already active or in-flight"

The 409 guard on `POST /api/projects/:id/meetings` caught a double invite. Only one session per project at a time. End the existing one first.

### "Session timeout" — subprocess exit 5

The subprocess reached its own `--timeout-sec` without observing `status=ready` from Pika. Most common cause: the Google Meet was set up with a password or lobby the bot cannot bypass. The bot stays in the join loop waiting for the room to become accessible until the timeout fires.

Workaround: start the Google Meet with "Anyone with the link can join" and no lobby.

### Worker crashes mid-join (no `pika_session_id` captured)

Documented follow-up task. For the MVP the session row is left at `status='joining'` with `pika_session_id=NULL` and no cleanup runs. A follow-up cron will reconcile orphaned rows older than ~5 minutes. In the meantime: manually flip the row to `status='failed'` via SQL if it's blocking a new invite (the 409 guard).

---

## Extending the integration

### Adding a new subcommand

We currently use `join` and `leave`. To add e.g. `generate-avatar`:

1. Add a Zod schema for the new stdout shape to `packages/shared/src/schemas/pika.ts`.
2. Add a new exported function in `apps/worker/src/lib/pika-stream.ts` that builds the argv array and calls `runPikaSubprocess(...)`.
3. Wire it up at the call site (a new processor, or a new web route, depending on whether it's user-triggered or scheduled).

The existing `runPikaSubprocess` helper already handles buffering, timeouts, exit-code mapping, and the env var rename — each new subcommand is a ~20-line wrapper function.

### Refreshing the vendored skill

When Pika ships a new upstream version, re-run the curl commands in `vendor/README.md` with the new SHA, update the `Commit:` line in the provenance header of every modified file, and test against a real Meet. The subprocess contract (stdout JSON shapes, exit codes) may have drifted — the Zod schemas will fail loudly in the test suite if anything essential changed.

### Switching to a different voice

Set `voiceId` in the POST body (or let the default `English_radiant_girl` take over). For a cloned voice: run `clone-voice` manually against a recording, grab the returned `voice_id`, and pass it in. The MVP deliberately does NOT expose voice cloning via the dashboard — it's a one-time setup step per voice.
