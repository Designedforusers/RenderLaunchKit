/**
 * Workflows service entrypoint.
 *
 * Importing each task file triggers the `task(...)` call at module
 * load, which registers the task with the Render SDK's in-process
 * task registry. The Render build step uses this file's compiled
 * `dist/index.js` as the service's `startCommand` so every registered
 * task is picked up and advertised to the Render control plane.
 *
 * There is no explicit `run()` call or `app.start()` — the SDK keeps
 * the process alive once any task is registered and listens for
 * incoming run requests from the Render orchestrator (or the local
 * `render workflows dev` task server when `RENDER_USE_LOCAL_DEV=true`).
 *
 * Side-effect-only imports are intentional. Do not `import type` —
 * that would erase at compile time and the tasks would not register.
 *
 * ── Manual dashboard configuration (one-time per fresh deploy) ──
 *
 * Render Workflows is still public beta and is NOT supported by
 * the Blueprint (`render.yaml`), so this service is created by
 * hand in the Render dashboard via "New" → "Workflows". Two fields
 * need the dashboard UI because they cannot live in the Blueprint:
 *
 *   1. **Build Command.** Set to the multi-line form below so
 *      `renderRemotionVideo` has Chrome Headless Shell + the
 *      system libs it needs available at runtime. The same
 *      buildCommand the web service USED to have before the
 *      Remotion-on-Workflows migration — that cost has moved
 *      here, where rendering actually happens now.
 *
 *          apt-get update &&
 *          apt-get install -y --no-install-recommends
 *            libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2
 *            libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1
 *            libxdamage1 libatk-bridge2.0-0 libpango-1.0-0
 *            libcairo2 libcups2 &&
 *          npm ci &&
 *          npx remotion browser ensure &&
 *          npm run build
 *
 *   2. **Env vars.** Set the following on the workflows service
 *      env page (none are wired through Blueprint `fromService`
 *      references since the workflows service does not appear
 *      in `render.yaml`):
 *
 *        - DATABASE_URL        — same value the web service sees
 *        - REDIS_URL           — same value the web service sees
 *        - ANTHROPIC_API_KEY
 *        - FAL_API_KEY
 *        - WORLD_LABS_API_KEY
 *        - ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL_ID
 *        - MINIO_ENDPOINT_HOST — same hostname wired to the web
 *                                 service via `fromService.host`
 *        - MINIO_ROOT_USER     — from the launchkit-minio service
 *        - MINIO_ROOT_PASSWORD — from the launchkit-minio service
 *        - REMOTION_CONCURRENCY — optional, defaults to '50%'
 *
 * Copy the resulting workflow slug into the web service's
 * `RENDER_WORKFLOW_SLUG` env var and the worker service's
 * `RENDER_WORKFLOW_SLUG` env var so both triggers can call the
 * task. The README "Create the workflow service" section carries
 * the step-by-step runbook.
 */

import './tasks/generate-written-asset.js';
import './tasks/generate-image-asset.js';
import './tasks/generate-video-asset.js';
import './tasks/generate-audio-asset.js';
import './tasks/generate-world-scene.js';
import './tasks/generate-all-assets-for-project.js';
import './tasks/render-remotion-video.js';

console.log(
  '[Workflows] Task registration entrypoint loaded — seven tasks registered'
);
