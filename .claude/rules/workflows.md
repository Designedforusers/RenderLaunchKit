---
paths:
  - "apps/workflows/**"
  - "**/trigger-workflow-generation*"
  - "render.yaml"
---

# Render Workflows service

`apps/workflows/` hosts asset-generation tasks as Render Workflows task definitions. Created manually in the Render dashboard (not via Blueprint — Render Workflows is public beta).

## Architecture

Six child tasks grouped by compute profile:
- `starter`: `generateWrittenAsset` (text)
- `standard`: `generateImageAsset`, `generateAudioAsset`
- `pro`: `generateVideoAsset`, `generateWorldScene`, `renderRemotionVideo`

Parent task (`generateAllAssetsForProject`) reads `status='queued'` assets, fans out via `Promise.allSettled`, then enqueues the review BullMQ job. Partial failures are first-class.

The `renderRemotionVideo` task is NOT part of the generation fan-out — it runs on-demand when a user requests `/api/assets/:id/video.mp4` and no cached render exists. It launches Chrome headless, renders the Remotion composition (product video, voice commercial, podcast waveform, or vertical video), uploads the MP4 to MinIO (`launchkit-minio`), and persists the public URL on the asset row (`rendered_video_url`). Subsequent requests 302-redirect to the cached MinIO URL without triggering a new task.

## Trigger call sites

All call `triggerWorkflowGeneration(projectId)`:

1. `apps/worker/src/index.ts` — after strategy builds initial asset rows
2. `apps/worker/src/processors/review-generated-assets.ts` — creative-review re-queue
3. `apps/worker/src/processors/process-commit-marketing-run.ts` — commit-marketing refresh
4. `apps/web/src/routes/asset-api-routes.ts` — user "Regenerate" button

Worker and web each have their own trigger helper (deliberate copy — each service owns its own Render SDK client). Both require `RENDER_API_KEY` and `RENDER_WORKFLOW_SLUG` at call time (optional in Zod schema, throws at call time if missing).

## Local dev

Set `RENDER_USE_LOCAL_DEV=true` and run `render workflows dev` (port 8120). The SDK reads that env var directly.
