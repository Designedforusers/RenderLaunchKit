-- Migration: add `github_token_encrypted` column to `projects` for
-- private-repo support.
--
-- Why
-- ---
--
-- Until now the analyze pipeline fetched repo metadata from GitHub
-- with an optional global `GITHUB_TOKEN` env var. That worked for
-- every public repo the demo surface pointed at, but rejected
-- private repos outright — the unauthenticated (or shared-token)
-- client does not have permission to read them.
--
-- This migration lets a user paste in a GitHub personal access
-- token alongside the repo URL when creating a project. The web
-- service encrypts the token with AES-256-GCM using the
-- `GITHUB_TOKEN_SECRET` server secret and stores the resulting
-- `iv:tag:ciphertext` blob in this column. The worker reads the
-- blob at the start of the analyze job, decrypts it, and routes
-- every GitHub API / raw.githubusercontent.com fetch through that
-- user-scoped token for the duration of the run.
--
-- The column is nullable so public-repo projects keep working
-- exactly as before — no token submitted, no encrypted blob
-- stored, the fetch tools fall back to the global `GITHUB_TOKEN`
-- env var (if set) or go unauthenticated.
--
-- Non-destructive, additive, safe to apply on a populated DB.

BEGIN;

ALTER TABLE projects
  ADD COLUMN github_token_encrypted text;

COMMIT;
