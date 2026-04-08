-- Migration: swap the projects.embedding column from vector(1536) to
-- vector(1024) to match Voyage AI `voyage-3-large` output dimension.
--
-- Why
-- ---
--
-- The previous schema declared `embedding vector(1536)` to match an
-- OpenAI text-embedding-3-small / text-embedding-3-large default. The
-- column was populated by a deterministic lexical hash in
-- `apps/worker/src/lib/project-embedding-service.ts` that produced
-- vectors with no semantic meaning — pgvector cosine similarity
-- queries against those vectors returned essentially random results.
--
-- This migration:
--   1. Drops the existing HNSW index on `projects.embedding`
--      (HNSW indexes are dimension-locked and cannot be ALTERed)
--   2. Drops the column itself
--   3. Recreates the column at vector(1024)
--   4. Recreates the HNSW index on the new column
--
-- All existing project rows lose their embedding (the column is
-- nullable). The seed script regenerates embeddings via Voyage on
-- the next `npm run seed`. Production projects need to be re-embedded
-- via a one-off backfill job after deploy — see the README disclaimer
-- and the `seed.ts` reseed path.
--
-- Forward-compat note: voyage-3-large supports matryoshka dimensions
-- (256 / 512 / 1024 / 2048). 1024 is the sweet spot for retrieval
-- quality vs storage. If we ever swap to a different dimension, this
-- migration is the template — drop the index, drop the column,
-- recreate at the new dim, recreate the index, re-embed.

BEGIN;

-- Step 1: drop the HNSW index. pgvector HNSW indexes encode the
-- vector dimension and cannot be modified in place.
DROP INDEX IF EXISTS projects_embedding_idx;

-- Some installs auto-name the HNSW index differently; drop the
-- common variants too. (`CREATE INDEX ON projects USING hnsw (...)`
-- without an explicit name produces a generated name.)
DO $$
DECLARE
  idx_name TEXT;
BEGIN
  FOR idx_name IN
    SELECT indexname
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'projects'
       AND indexdef ILIKE '%hnsw%embedding%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', idx_name);
  END LOOP;
END $$;

-- Step 2: drop the existing 1536-dim column. The data is the
-- lexical-hash placeholder; nothing of value is lost.
--
-- WARNING: this is a destructive column drop. All stored embeddings
-- on `projects.embedding` are deleted. The seed script regenerates
-- them on the next `npm run seed`; production projects need a one-off
-- backfill via Voyage after deploy.
ALTER TABLE projects DROP COLUMN IF EXISTS embedding;

-- Step 3: recreate at the Voyage `voyage-3-large` dimension.
ALTER TABLE projects ADD COLUMN embedding vector(1024);

-- Step 4: recreate the HNSW index on the new column. Cosine
-- similarity is the right operator class for normalized embeddings.
CREATE INDEX ON projects USING hnsw (embedding vector_cosine_ops);

COMMIT;
