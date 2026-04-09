-- Migration: add per-asset cost tracking surface (PR #35 / Phase 9).
--
-- Why
-- ---
--
-- LaunchKit's asset generation pipeline pays for every upstream API
-- call: Anthropic messages for every agent reasoning pass, fal.ai
-- for every image and video render, ElevenLabs for every voice
-- synthesis, World Labs (Marble) for every 3D scene. Without a
-- tracking surface, an operator has no way to answer "what did this
-- project cost us to generate?" short of reading four provider
-- dashboards and correlating timestamps by hand.
--
-- This migration adds two things:
--
--   1. A per-upstream-call event log (`asset_cost_events`) that
--      records one row per successful external API call during an
--      asset generation. Granular enough to answer "what did the
--      Anthropic call for this blog post cost us?" without
--      approximating from the summary.
--
--   2. A denormalized per-asset total and breakdown on the `assets`
--      table (`cost_cents`, `cost_breakdown`) so the dashboard's
--      per-asset cost label and per-asset breakdown modal do not
--      need to join back to `asset_cost_events` on every render.
--
-- The two are kept in sync by the workflows service's
-- `persistCostEvents` helper, which writes the event rows AND the
-- asset summary inside the same transaction after the agent returns.
--
-- Integer cents at every layer. No floating-point dollar math
-- anywhere in the pipeline — pricing helpers in
-- `packages/shared/src/pricing.ts` always round up to the nearest
-- cent, and the dashboard formats `(cents / 100).toFixed(2)` at
-- display time.
--
-- Non-blocking invariant
-- ----------------------
--
-- A failed insert into `asset_cost_events` (or a failed UPDATE on
-- `assets.cost_cents`) must NEVER fail a real asset generation. The
-- `persistCostEvents` helper wraps the transaction in try/catch and
-- logs on failure. A user's blog post always ships, even if the
-- cost write crashes. The columns and table are sized so insert
-- failures are a process-level bug (bad data, FK violation), not
-- an expected runtime degradation.
--
-- Non-destructive, additive, safe to apply on a populated DB.

BEGIN;

-- ── assets: denormalized cost summary columns ──
--
-- `cost_cents` defaults to 0 so seed rows and historical
-- pre-tracking assets read as "not priced yet" rather than NULL.
-- `cost_breakdown` is nullable because not every historical row
-- will ever have a breakdown — only rows generated after this
-- migration lands get one.

ALTER TABLE assets
  ADD COLUMN cost_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN cost_breakdown jsonb;

-- ── asset_cost_events: per-upstream-call log ──
--
-- One row per successful external API call during an asset
-- generation. The `provider` column is a varchar rather than a
-- pgEnum so adding a new provider (e.g. a second Voyage model,
-- a new World Labs variant) does not require a migration — the
-- closed set of valid values lives in the Zod enum in
-- `packages/shared/src/schemas/asset-cost-event.ts` which the
-- dashboard reads from.
--
-- `input_units` and `output_units` are nullable because fixed-cost
-- operations (one FLUX image, one Marble world) have no meaningful
-- per-unit count. They're bigint instead of integer so a long
-- synthesis (tens of thousands of characters) does not overflow —
-- integer's 2.1B ceiling is generous but bigint removes the ceiling
-- as a concern.

CREATE TABLE asset_cost_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  operation VARCHAR(64) NOT NULL,
  input_units BIGINT,
  output_units BIGINT,
  cost_cents INTEGER NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- ── Indexes ──
--
-- `project_id` drives the `/api/projects/:id/costs` aggregation
-- query. `asset_id` drives the per-asset breakdown modal query.
-- `provider` supports future analytics queries that roll up
-- spend by provider across all projects (e.g., "how much did
-- we spend on Anthropic this month?").

CREATE INDEX asset_cost_events_project_id_idx
  ON asset_cost_events(project_id);
CREATE INDEX asset_cost_events_asset_id_idx
  ON asset_cost_events(asset_id);
CREATE INDEX asset_cost_events_provider_idx
  ON asset_cost_events(provider);

COMMIT;
