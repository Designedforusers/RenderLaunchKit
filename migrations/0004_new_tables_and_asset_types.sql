-- Migration: add the five new tables for the agentic GTM build
-- (Phase 2 of `silly-popping-rocket.md`) plus the five new asset
-- type enum values plus the two new embedding columns on existing
-- tables.
--
-- Why
-- ---
--
-- Phase 1 (migrations/0003_voyage_embeddings.sql) swapped the
-- `projects.embedding` column from vector(1536) to vector(1024) and
-- replaced the lexical-hash placeholder with real Voyage AI
-- embeddings. Phase 2 (this migration) adds the schema surface for
-- everything that consumes those embeddings: trending signals from
-- the dev community, a dev influencer database, per-commit marketing
-- run records, outreach drafts, and the Layer 3 asset feedback
-- event log for the self-learning loop.
--
-- All embedding columns on the new tables are also vector(1024) to
-- match the Voyage `voyage-3-large` output dimension. The two new
-- embedding columns added to existing tables (`assets.content_embedding`
-- and `webhook_events.diff_embedding`) follow the same convention.
--
-- This migration is additive and non-destructive — no existing rows
-- are touched, no columns are dropped. Safe to apply on a populated
-- database.

-- ── New asset type enum values (must run OUTSIDE the transaction) ──
--
-- Postgres documentation explicitly says `ALTER TYPE ... ADD VALUE`
-- is not transactional and cannot be rolled back. If we ran these
-- inside the BEGIN/COMMIT block below and any later statement
-- failed, the enum modifications would persist while the rest of
-- the migration would roll back, leaving the database in an
-- inconsistent state. Run each `ALTER TYPE` statement bare so the
-- catalog change commits immediately and independently.
--
-- The `IF NOT EXISTS` guard makes the statements idempotent — safe
-- to re-run on a database that already has the new values.
ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'tips';
ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'voice_commercial';
ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'podcast_script';
ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'outreach_draft';
ALTER TYPE asset_type ADD VALUE IF NOT EXISTS 'per_commit_teaser';

BEGIN;

-- ── New enums for the new tables ───────────────────────────────
CREATE TYPE trend_source AS ENUM (
  'hn',
  'devto',
  'reddit',
  'grok',
  'exa',
  'producthunt',
  'github'
);

CREATE TYPE outreach_channel AS ENUM (
  'twitter_dm',
  'email',
  'comment'
);

CREATE TYPE outreach_status AS ENUM (
  'drafted',
  'copied',
  'sent',
  'responded'
);

CREATE TYPE commit_run_status AS ENUM (
  'pending',
  'generating',
  'complete',
  'failed'
);

CREATE TYPE feedback_action AS ENUM (
  'approved',
  'rejected',
  'edited',
  'regenerated'
);

-- ── New columns on existing tables ─────────────────────────────
-- Both columns are nullable so the migration is non-destructive
-- on a populated database. Backfill happens lazily as the
-- relevant agents start producing embeddings.
ALTER TABLE assets ADD COLUMN content_embedding vector(1024);
ALTER TABLE webhook_events ADD COLUMN diff_embedding vector(1024);

-- HNSW indexes on the new embedding columns for fast cosine
-- similarity lookups (same operator class as projects.embedding).
CREATE INDEX ON assets USING hnsw (content_embedding vector_cosine_ops);
CREATE INDEX ON webhook_events USING hnsw (diff_embedding vector_cosine_ops);

-- ── strategy_insights: new column for insight type discrimination ──
-- Layer 1 stat-based insights (tone × category, asset_type ×
-- category) and Layer 3 edit-cluster summaries both land in this
-- table. The new `insight_type` column lets the strategist agent
-- query for one or the other when building prompt context.
ALTER TABLE strategy_insights ADD COLUMN IF NOT EXISTS insight_type VARCHAR(50);
CREATE INDEX IF NOT EXISTS strategy_insights_insight_type_idx
  ON strategy_insights(insight_type);

-- ── trend_signals ──────────────────────────────────────────────
-- One row per trending topic ingested from any source. Powers the
-- trend-matching layer ("for this commit's category, what's hot
-- right now?") and the trend velocity scoring in Layer 1.
CREATE TABLE trend_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source trend_source NOT NULL,
  topic TEXT NOT NULL,
  headline TEXT NOT NULL,
  url TEXT,
  raw_payload JSONB,
  velocity_score REAL NOT NULL DEFAULT 0,
  embedding vector(1024),
  category VARCHAR(100),
  ingested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE INDEX trend_signals_source_idx ON trend_signals(source);
CREATE INDEX trend_signals_category_idx ON trend_signals(category);
CREATE INDEX trend_signals_ingested_at_idx ON trend_signals(ingested_at);
CREATE INDEX trend_signals_expires_at_idx ON trend_signals(expires_at);
CREATE INDEX ON trend_signals USING hnsw (embedding vector_cosine_ops);

-- ── dev_influencers ────────────────────────────────────────────
-- Curated + auto-enriched dev influencer database. Seeded from
-- a hand-picked starter set, grown daily by the
-- enrich-dev-influencers cron. Topic embedding powers the
-- influencer matcher.
CREATE TABLE dev_influencers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  handle VARCHAR(100) NOT NULL,
  platforms JSONB NOT NULL,
  categories TEXT[] NOT NULL,
  bio TEXT,
  recent_topics JSONB,
  audience_size INTEGER NOT NULL DEFAULT 0,
  topic_embedding vector(1024),
  last_enriched_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX dev_influencers_handle_idx ON dev_influencers(handle);
CREATE INDEX dev_influencers_audience_size_idx ON dev_influencers(audience_size);
CREATE INDEX ON dev_influencers USING hnsw (topic_embedding vector_cosine_ops);

-- ── commit_marketing_runs ──────────────────────────────────────
-- One row per webhook-triggered marketing fan-out. Links the
-- source webhook event, the trends used, the influencers
-- recommended, and the asset IDs the fan-out generated. Powers
-- the continuous launch feed dashboard view.
CREATE TABLE commit_marketing_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  webhook_event_id UUID NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  commit_sha VARCHAR(40) NOT NULL,
  commit_message TEXT,
  trends_used JSONB,
  influencers_recommended JSONB,
  asset_ids UUID[],
  status commit_run_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX commit_marketing_runs_project_id_idx
  ON commit_marketing_runs(project_id);
CREATE INDEX commit_marketing_runs_webhook_event_id_idx
  ON commit_marketing_runs(webhook_event_id);
CREATE INDEX commit_marketing_runs_status_idx
  ON commit_marketing_runs(status);
CREATE INDEX commit_marketing_runs_created_at_idx
  ON commit_marketing_runs(created_at);

-- ── outreach_drafts ────────────────────────────────────────────
-- Personalised DMs / emails / comments produced by the
-- outreach-draft-agent. One row per (commit_marketing_run ×
-- influencer × channel). Drafts are never auto-sent — the user
-- copies, marks sent, and (eventually) the system listens for
-- responses.
CREATE TABLE outreach_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commit_marketing_run_id UUID NOT NULL
    REFERENCES commit_marketing_runs(id) ON DELETE CASCADE,
  influencer_id UUID NOT NULL
    REFERENCES dev_influencers(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  channel outreach_channel NOT NULL,
  draft_text TEXT NOT NULL,
  status outreach_status NOT NULL DEFAULT 'drafted',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX outreach_drafts_commit_run_id_idx
  ON outreach_drafts(commit_marketing_run_id);
CREATE INDEX outreach_drafts_influencer_id_idx
  ON outreach_drafts(influencer_id);
CREATE INDEX outreach_drafts_status_idx ON outreach_drafts(status);

-- ── asset_feedback_events (Layer 3 of the self-learning loop) ──
-- Every approve / reject / edit / regenerate action on an asset
-- writes a row here with the edit text and a Voyage embedding
-- of the edit. The cron clusters edits by (asset_type, category)
-- using pgvector cosine similarity, generates a one-sentence
-- human-readable summary per cluster via Claude, and writes the
-- summary to strategy_insights as an `edit_pattern` insight type.
CREATE TABLE asset_feedback_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  action feedback_action NOT NULL,
  edit_text TEXT,
  edit_embedding vector(1024),
  user_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX asset_feedback_events_asset_id_idx
  ON asset_feedback_events(asset_id);
CREATE INDEX asset_feedback_events_action_idx
  ON asset_feedback_events(action);
CREATE INDEX asset_feedback_events_created_at_idx
  ON asset_feedback_events(created_at);
CREATE INDEX ON asset_feedback_events USING hnsw (edit_embedding vector_cosine_ops);

COMMIT;
