-- Migration: add rendered video storage columns to the assets table.
--
-- Why
-- ---
--
-- The Remotion-on-Workflows migration (follow-up PR) moves video
-- rendering off the web dyno and onto a `renderRemotionVideo` task
-- hosted on the Render Workflows service. That task produces a
-- finished MP4 and uploads it to the `launchkit-minio` object store
-- (added in the `feat(deploy): add MinIO object storage service`
-- commit earlier in this batch). The web service's existing
-- `/api/assets/:id/video.mp4` handler then 302-redirects clients to
-- the stored public URL instead of streaming 30+ MB of bytes
-- through its own Node process.
--
-- Two new nullable columns land on `assets`:
--
--   * `rendered_video_url` — the public HTTPS URL clients GET to
--     retrieve the rendered MP4. Populated by the workflows task
--     on successful upload, read by the web route when deciding
--     whether to 302-redirect or re-trigger the render.
--
--   * `rendered_video_key` — the raw S3 key (e.g.
--     `videos/<assetId>-v<version>-visual.mp4`) used by the task
--     to detect cache hits without re-parsing the URL, and by any
--     future CDN swap that needs to reconstruct the public prefix
--     without rewriting every row.
--
-- Both are NULL until the first successful render. Pre-existing
-- asset rows stay on the legacy file-streaming path until their
-- next render populates the columns — see ADR-002 § "Consequences"
-- for the migration strategy.
--
-- Non-destructive, additive, safe to apply on a populated DB. Zero
-- rows change on apply; the columns default to NULL so every
-- existing asset keeps working unchanged until its next regen.

ALTER TABLE "assets"
  ADD COLUMN "rendered_video_url" text,
  ADD COLUMN "rendered_video_key" text;
