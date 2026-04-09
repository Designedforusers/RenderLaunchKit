-- Migration: add `revision_instructions` column to `assets` to
-- separate the agent-facing revision prompt from the human-facing
-- `review_notes` display field.
--
-- Why
-- ---
--
-- Before this migration, three different re-queue paths all wrote
-- the agent-facing revision prompt into `assets.review_notes`:
--
--   1. `apps/worker/src/processors/review-generated-assets.ts` —
--      creative review rejection loop wrote strengths + issues +
--      revision instructions as a concatenated paragraph.
--   2. `apps/worker/src/processors/process-commit-marketing-run.ts` —
--      webhook-driven refresh wrote "Refresh this asset for commit
--      <sha>: <message>" as the revision context.
--   3. `apps/web/src/routes/asset-api-routes.ts` — the
--      `/api/assets/:id/regenerate` route wrote the caller's
--      `body.instructions` into the asset's `metadata.generationInstructions`,
--      overwriting the original brief on every regen.
--
-- All three were semantic overlaps PR #33's code-reviewer flagged.
-- `review_notes` is the human-readable feedback string the dashboard
-- renders under "Review feedback" — a webhook-driven refresh is not
-- review feedback, and bleeding prompt fragments into the UI was the
-- wrong abstraction. Overwriting the original brief lost the "what
-- this asset was for" context on every regeneration cycle.
--
-- This migration gives every re-queue path a dedicated column to
-- write the agent-facing revision prompt into. `dispatchAsset` in the
-- workflows service reads this column at run time and passes it
-- through to the writer / marketing-visual / product-video agents as
-- the `revisionInstructions` input, leaving the original
-- `metadata.generationInstructions` ("original brief") untouched.
--
-- Nullable because first-pass generations have no revision overlay —
-- the agents see `revisionInstructions: undefined` and treat the run
-- as a clean first pass.
--
-- Non-destructive, additive, safe to apply on a populated DB.

BEGIN;

ALTER TABLE assets
  ADD COLUMN revision_instructions text;

COMMIT;
