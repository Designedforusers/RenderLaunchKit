-- Migration: add per-platform audience breakdown + X enrichment timestamp
-- to `dev_influencers` (Phase 5 of the influencer pipeline).
--
-- Why
-- ---
--
-- Phase 5 introduces the dev-influencer discovery + enrichment loop:
--
--   1. The discovery agent proposes candidate handles from trend
--      signals and the wider dev community.
--
--   2. Enrichment tools fan out across the cheap/free APIs (GitHub,
--      dev.to, Hacker News) and the paid X enrichment endpoint to
--      fill in per-platform audience data.
--
--   3. The matcher ranks candidates by topic overlap + audience size.
--
-- The existing `audience_size` column on `dev_influencers` is a
-- single integer — the max follower count observed across platforms.
-- That scalar is enough for the matcher's ORDER BY, but the UI and
-- the enrichment cron both need the full per-platform picture
-- (Twitter followers, GitHub repo count, dev.to post count, HN
-- karma) to (a) explain the ranking to the user and (b) skip an
-- influencer whose only signal is one inflated platform.
--
-- `audience_breakdown` jsonb stores that per-platform blob, typed
-- at the Zod layer as `AudienceBreakdownSchema` in
-- `packages/shared/src/schemas/dev-influencer.ts`. The column is
-- nullable so influencers seeded before Phase 5 (or enriched only
-- by the free APIs) keep working.
--
-- `last_x_enriched_at` tracks when the paid X enrichment endpoint
-- last ran for this influencer. The X tool is rate- and cost-limited,
-- so the enrichment cron uses this timestamp to skip rows that were
-- refreshed recently. Separate from `last_enriched_at` (which covers
-- the free-API refresh) because the two loops run on different
-- cadences.
--
-- Both columns are nullable and additive — this migration is
-- non-destructive and safe to apply on a populated database.

BEGIN;

ALTER TABLE dev_influencers
  ADD COLUMN audience_breakdown jsonb,
  ADD COLUMN last_x_enriched_at timestamp;

COMMIT;
