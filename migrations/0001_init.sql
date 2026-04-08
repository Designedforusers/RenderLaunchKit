-- LaunchKit Database Initialization
-- Requires PostgreSQL 16+ with pgvector extension

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ──

CREATE TYPE project_status AS ENUM (
  'pending',
  'analyzing',
  'researching',
  'strategizing',
  'generating',
  'reviewing',
  'revising',
  'complete',
  'failed'
);

CREATE TYPE asset_type AS ENUM (
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
  -- Phase 2: agentic GTM build asset types
  'tips',
  'voice_commercial',
  'podcast_script',
  'outreach_draft',
  'per_commit_teaser'
);

-- ── Phase 2: enums for the agentic GTM build new tables ──
CREATE TYPE trend_source AS ENUM (
  'hn', 'devto', 'reddit', 'grok', 'exa', 'producthunt', 'github'
);

CREATE TYPE outreach_channel AS ENUM (
  'twitter_dm', 'email', 'comment'
);

CREATE TYPE outreach_status AS ENUM (
  'drafted', 'copied', 'sent', 'responded'
);

CREATE TYPE commit_run_status AS ENUM (
  'pending', 'generating', 'complete', 'failed'
);

CREATE TYPE feedback_action AS ENUM (
  'approved', 'rejected', 'edited', 'regenerated'
);

CREATE TYPE asset_status AS ENUM (
  'queued',
  'generating',
  'reviewing',
  'approved',
  'rejected',
  'regenerating',
  'complete',
  'failed'
);

-- ── Tables ──

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repo_url TEXT NOT NULL,
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  status project_status NOT NULL DEFAULT 'pending',

  repo_analysis JSONB,
  research JSONB,
  strategy JSONB,

  review_score REAL,
  review_feedback JSONB,
  revision_count INTEGER NOT NULL DEFAULT 0,

  -- Voyage `voyage-3-large` output dimension. See
  -- migrations/0003_voyage_embeddings.sql for the rationale and the
  -- migration that handles older installs that bootstrapped at 1536.
  embedding vector(1024),

  webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_commit_sha VARCHAR(40),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type asset_type NOT NULL,
  status asset_status NOT NULL DEFAULT 'queued',

  content TEXT,
  media_url TEXT,
  metadata JSONB,

  quality_score REAL,
  review_notes TEXT,

  user_approved BOOLEAN,
  user_edited BOOLEAN NOT NULL DEFAULT FALSE,
  user_edited_content TEXT,

  version INTEGER NOT NULL DEFAULT 1,

  -- Phase 2: semantic embedding of the rendered asset content for
  -- Layer 2 similarity search and the cross-asset deduplication guard.
  content_embedding vector(1024),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bullmq_job_id VARCHAR(255),
  name VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'queued',

  input JSONB,
  output JSONB,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,

  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  -- GitHub `x-github-delivery` header. Unique per delivery
  -- (including manual redeliveries from the GitHub UI). Used by
  -- the webhook receiver to dedupe replays before queuing
  -- background work. The unique index allows NULL values so any
  -- pre-existing rows from before delivery_id was added are
  -- preserved (relevant for migration history, not fresh installs).
  delivery_id VARCHAR(64),
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  commit_sha VARCHAR(40),
  commit_message TEXT,

  is_marketable BOOLEAN,
  filter_reasoning TEXT,
  triggered_generation BOOLEAN NOT NULL DEFAULT FALSE,

  -- Phase 2: semantic embedding of the commit (msg + diff summary)
  -- for Layer 2 trend matching and the per-commit duplication guard.
  diff_embedding vector(1024),

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE strategy_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(100) NOT NULL,
  insight TEXT NOT NULL,
  confidence REAL NOT NULL,
  sample_size INTEGER NOT NULL,
  data_points JSONB,
  -- Phase 2: insight type discriminator (`tone`, `asset_type`,
  -- `trend_velocity`, `influencer_response`, `edit_pattern`).
  -- Lets the strategist agent query for one or the other when
  -- building prompt context.
  insight_type VARCHAR(50),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Phase 2: agentic GTM build tables ──

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

CREATE TABLE asset_feedback_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  action feedback_action NOT NULL,
  edit_text TEXT,
  edit_embedding vector(1024),
  user_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Indexes ──

CREATE INDEX projects_repo_url_idx ON projects(repo_url);
CREATE INDEX projects_status_idx ON projects(status);
CREATE INDEX assets_project_id_idx ON assets(project_id);
CREATE INDEX assets_type_idx ON assets(type);
CREATE INDEX assets_status_idx ON assets(status);
CREATE INDEX jobs_project_id_idx ON jobs(project_id);
CREATE INDEX jobs_status_idx ON jobs(status);
CREATE INDEX webhook_events_project_id_idx ON webhook_events(project_id);
CREATE UNIQUE INDEX webhook_events_delivery_id_idx
  ON webhook_events(delivery_id)
  WHERE delivery_id IS NOT NULL;
CREATE INDEX strategy_insights_category_idx ON strategy_insights(category);
CREATE INDEX strategy_insights_insight_type_idx ON strategy_insights(insight_type);

-- ── Phase 2 indexes ──
CREATE INDEX trend_signals_source_idx ON trend_signals(source);
CREATE INDEX trend_signals_category_idx ON trend_signals(category);
CREATE INDEX trend_signals_ingested_at_idx ON trend_signals(ingested_at);
CREATE INDEX trend_signals_expires_at_idx ON trend_signals(expires_at);

CREATE UNIQUE INDEX dev_influencers_handle_idx ON dev_influencers(handle);
CREATE INDEX dev_influencers_audience_size_idx ON dev_influencers(audience_size);

CREATE INDEX commit_marketing_runs_project_id_idx ON commit_marketing_runs(project_id);
CREATE INDEX commit_marketing_runs_webhook_event_id_idx ON commit_marketing_runs(webhook_event_id);
CREATE INDEX commit_marketing_runs_status_idx ON commit_marketing_runs(status);
CREATE INDEX commit_marketing_runs_created_at_idx ON commit_marketing_runs(created_at);

CREATE INDEX outreach_drafts_commit_run_id_idx ON outreach_drafts(commit_marketing_run_id);
CREATE INDEX outreach_drafts_influencer_id_idx ON outreach_drafts(influencer_id);
CREATE INDEX outreach_drafts_status_idx ON outreach_drafts(status);

CREATE INDEX asset_feedback_events_asset_id_idx ON asset_feedback_events(asset_id);
CREATE INDEX asset_feedback_events_action_idx ON asset_feedback_events(action);
CREATE INDEX asset_feedback_events_created_at_idx ON asset_feedback_events(created_at);

-- Vector similarity indexes (HNSW for fast cosine similarity lookups)
CREATE INDEX ON projects USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON assets USING hnsw (content_embedding vector_cosine_ops);
CREATE INDEX ON webhook_events USING hnsw (diff_embedding vector_cosine_ops);
CREATE INDEX ON trend_signals USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON dev_influencers USING hnsw (topic_embedding vector_cosine_ops);
CREATE INDEX ON asset_feedback_events USING hnsw (edit_embedding vector_cosine_ops);
