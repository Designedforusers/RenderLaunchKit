-- Migration: drop the dev influencer + outreach draft subsystem.
--
-- Why
-- ---
--
-- The original Phase 5 build shipped a Phase-6-spanning subsystem
-- that auto-discovered dev influencers (GitHub / dev.to / HN / X
-- enrichment) and generated personalised outreach drafts off the
-- back of every commit-marketing run. The Layer-1 plumbing was all
-- there but the user-facing surface was never built — the dashboard
-- never grew an "outreach inbox," the user never saw a single draft,
-- and in late-2026 dev influencer discovery is mostly a manual
-- relationship-building exercise that AI can support but cannot
-- own. Continuing to ship the subsystem would mean carrying ~2k
-- LOC, four upstream API integrations, two BullMQ jobs, two DB
-- tables, and three pgEnums for a feature path that has zero UI.
--
-- This migration removes the schema surface in lockstep with the
-- code removal in this PR:
--
--   * `outreach_drafts` table (and its indexes) — dropped first
--     because it carries the FK to `dev_influencers`.
--   * `dev_influencers` table (and its indexes).
--   * `outreach_channel` and `outreach_status` pgEnums.
--   * `influencers_recommended` JSONB column on
--     `commit_marketing_runs` — was the snapshot the dashboard
--     would have read; now nothing reads it.
--   * `outreach_draft` value on the `asset_type` enum — never
--     materialised as actual asset rows in production (the
--     `outreach_drafts` table held the records), so removing the
--     enum value is a pure-catalog change with zero data impact
--     after the column-typing dance below.
--
-- Postgres `ALTER TYPE ... DROP VALUE` does not exist, so the only
-- way to remove an enum value is the four-step rename pattern:
-- create a new type with the surviving values, ALTER COLUMN USING
-- the cast through ::text::new_type, drop the old type, rename the
-- new type to the original name. The cast is safe because no live
-- rows have type='outreach_draft'.
--
-- Destructive but bounded: only drops surfaces that the rest of
-- this PR has already removed every consumer of. Re-applying is
-- not supported (Postgres has no "undo drop type"); the previous
-- migration's CREATE blocks would need to be re-run.

BEGIN;

-- ── Drop outreach_drafts (FK to dev_influencers) ──────────────
DROP INDEX IF EXISTS outreach_drafts_commit_run_id_idx;
DROP INDEX IF EXISTS outreach_drafts_influencer_id_idx;
DROP INDEX IF EXISTS outreach_drafts_status_idx;
DROP TABLE IF EXISTS outreach_drafts;

-- ── Drop dev_influencers ──────────────────────────────────────
DROP INDEX IF EXISTS dev_influencers_handle_idx;
DROP INDEX IF EXISTS dev_influencers_audience_size_idx;
DROP TABLE IF EXISTS dev_influencers;

-- ── Drop the two outreach pgEnums ─────────────────────────────
DROP TYPE IF EXISTS outreach_channel;
DROP TYPE IF EXISTS outreach_status;

-- ── Drop influencers_recommended snapshot column ──────────────
ALTER TABLE commit_marketing_runs
  DROP COLUMN IF EXISTS influencers_recommended;

-- ── Remove 'outreach_draft' from the asset_type enum ──────────
--
-- Postgres has no `ALTER TYPE ... DROP VALUE`. The four-step
-- rename pattern is the only catalog-safe way:
--
--   1. CREATE a new enum with only the surviving values.
--   2. ALTER every column using the old enum to the new enum via
--      USING old_col::text::new_enum (safe because zero live rows
--      have the value being dropped).
--   3. DROP the old enum.
--   4. RENAME the new enum to the old name.
--
-- Only `assets.type` references `asset_type` today.
CREATE TYPE asset_type_new AS ENUM (
  'blog_post',
  'twitter_thread',
  'linkedin_post',
  'product_hunt_description',
  'hacker_news_post',
  'faq',
  'changelog_entry',
  'og_image',
  'social_card',
  'product_video',
  'voiceover_script',
  'video_storyboard',
  'tips',
  'voice_commercial',
  'podcast_script',
  'per_commit_teaser',
  'world_scene'
);

ALTER TABLE assets
  ALTER COLUMN type TYPE asset_type_new
  USING type::text::asset_type_new;

DROP TYPE asset_type;
ALTER TYPE asset_type_new RENAME TO asset_type;

COMMIT;
