-- Migration: add the Pika video-meeting session tracking surface.
--
-- Why
-- ---
--
-- LaunchKit's AI teammate grows a face in this PR: a user clicks
-- "Invite AI teammate to a meet" on the project dashboard, drops a
-- Google Meet URL, and a Pika-hosted avatar joins the call as a
-- full video participant. The worker spawns the vendored
-- `vendor/pikastream-video-meeting` Python CLI as a short-lived
-- subprocess, captures the Pika-side session identifier from the
-- subprocess's streaming JSON stdout, and needs somewhere durable
-- to record the lifecycle so the dashboard can render a live
-- status chip and the leave flow can look up the session by ID.
--
-- Two changes land here:
--
--   1. A new `pika_meeting_sessions` table, one row per meeting
--      invite, with a 6-state lifecycle status column backing
--      `PikaSessionStatusSchema` in
--      `packages/shared/src/schemas/pika.ts`.
--
--   2. `asset_cost_events.asset_id` becomes nullable so the leave
--      processor can write a `(provider=pika, asset_id=NULL,
--      project_id=<row.project_id>)` cost event against the
--      existing aggregation surface without introducing a second
--      table that the dashboard's project cost chip would have to
--      UNION across.
--
-- Non-destructive, additive, safe to apply on a populated DB. The
-- column nullability change is a relaxation of an existing
-- constraint: every previously-inserted row still has a non-NULL
-- asset_id, and no downstream code dereferences the field
-- unconditionally (checked via grep during this commit — only
-- `persist-cost-events.ts` writes to the column, and it always
-- passes a concrete UUID).

BEGIN;

-- ── asset_cost_events: asset_id becomes nullable ──
--
-- Session-scoped cost events (Pika) set asset_id = NULL and rely on
-- project_id for aggregation. Per-asset events (Anthropic, fal,
-- ElevenLabs, World Labs, Voyage) continue to populate asset_id
-- exactly as before, and the existing partial index on asset_id
-- still accelerates the per-asset breakdown modal query.
--
-- The FK to assets.id stays in place: if a Pika session row has
-- asset_id = NULL, the FK simply doesn't apply to that row. For
-- rows with a non-NULL asset_id, the ON DELETE CASCADE still fires
-- when the referenced asset is deleted.

ALTER TABLE asset_cost_events
  ALTER COLUMN asset_id DROP NOT NULL;

-- ── pika_meeting_sessions: one row per "Invite teammate" click ──
--
-- Column rationale:
--
--   project_id      FK to projects so a project delete cleans up
--                   its session history (ON DELETE CASCADE).
--   meet_url        The raw Google Meet or Zoom URL the bot joined.
--                   TEXT rather than VARCHAR because upstream URL
--                   length has no reasonable cap.
--   bot_name        Display name used by the Pika avatar in the
--                   meeting. Derived at invite time from either the
--                   dashboard input or the project's display name.
--   avatar_ref      The raw PIKA_AVATAR value passed to the `--image`
--                   flag of the vendored Python CLI. Accepts either
--                   an absolute local file path OR an https:// URL
--                   — the Python CLI handles both transparently at
--                   `vendor/pikastream-video-meeting/scripts/
--                   pikastreaming_videomeeting.py:232-247`. Stored
--                   on the row so a regenerate path can round-trip
--                   the same avatar.
--   voice_id        Nullable — null means the default voice
--                   (English_radiant_girl) is used at spawn time.
--   system_prompt   The per-project prompt built from repoAnalysis
--                   + research + strategy + asset metadata at
--                   invite time, capped at 4 KB by the builder.
--                   Stored verbatim so the next invite can diff
--                   against it, and so a failed call can be
--                   re-spawned with the exact same input.
--   pika_session_id Returned by the join subprocess on its first
--                   stdout line. Null during `pending` and the
--                   initial moments of `joining`, becomes non-null
--                   before status flips to `active`. Indexed for
--                   the leave flow's row lookup by Pika-side ID.
--   status          VARCHAR(32) with application-level validation
--                   via PikaSessionStatusSchema — matches the
--                   `strategy_insights.insight_type` non-pgEnum
--                   pattern for non-core tables. The valid values
--                   form a linear state machine with a `failed`
--                   escape hatch from any non-terminal state:
--                     pending → joining → active → ending → ended
--                                      ↘ failed
--   error           Structured failure message from the TypeScript
--                   wrapper's error class on exit code 2/3/4/5/6.
--                   Null on the happy path.
--   started_at      Set when status first flips to `active`.
--   ended_at        Set when status flips to `ended` or `failed`.
--   cost_cents      Computed at leave time from
--                     (ended_at - started_at) * PIKA_PRICING.centsPerMinute.
--                   Cached on the row so the dashboard per-session
--                   chip does not need to query the cost event log
--                   on every render. Also written to asset_cost_events
--                   with asset_id=NULL for the aggregate cost chip.
--
-- Indexes:
--
--   project_id_idx       Drives `GET /api/projects/:id/meetings`.
--   pika_session_id_idx  Drives the leave flow's lookup by the
--                        Pika-side identifier returned from the
--                        subprocess's first stdout line.
--   status_idx           Drives the follow-up orphan-cleanup cron
--                        (documented as a deferred task) that will
--                        reconcile stuck `joining` / `active` rows
--                        after a worker crash.

CREATE TABLE pika_meeting_sessions (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id       UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meet_url         TEXT        NOT NULL,
  bot_name         TEXT        NOT NULL,
  avatar_ref       TEXT        NOT NULL,
  voice_id         TEXT,
  system_prompt    TEXT,
  pika_session_id  TEXT,
  status           VARCHAR(32) NOT NULL DEFAULT 'pending',
  error            TEXT,
  started_at       TIMESTAMP,
  ended_at         TIMESTAMP,
  cost_cents       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP   NOT NULL DEFAULT now()
);

CREATE INDEX pika_meeting_sessions_project_id_idx
  ON pika_meeting_sessions(project_id);
CREATE INDEX pika_meeting_sessions_pika_session_id_idx
  ON pika_meeting_sessions(pika_session_id);
CREATE INDEX pika_meeting_sessions_status_idx
  ON pika_meeting_sessions(status);

COMMIT;
