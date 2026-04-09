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
 */

import './tasks/generate-written-asset.js';
import './tasks/generate-image-asset.js';
import './tasks/generate-video-asset.js';
import './tasks/generate-audio-asset.js';
import './tasks/generate-world-scene.js';
import './tasks/generate-all-assets-for-project.js';

console.log(
  '[Workflows] Task registration entrypoint loaded — six tasks registered'
);
