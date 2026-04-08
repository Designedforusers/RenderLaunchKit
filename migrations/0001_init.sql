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
  'video_storyboard'
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
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  commit_sha VARCHAR(40),
  commit_message TEXT,

  is_marketable BOOLEAN,
  filter_reasoning TEXT,
  triggered_generation BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE strategy_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(100) NOT NULL,
  insight TEXT NOT NULL,
  confidence REAL NOT NULL,
  sample_size INTEGER NOT NULL,
  data_points JSONB,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
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
CREATE INDEX strategy_insights_category_idx ON strategy_insights(category);

-- Vector similarity index (HNSW for fast cosine similarity lookups)
CREATE INDEX ON projects USING hnsw (embedding vector_cosine_ops);
