import { Render } from '@renderinc/sdk';
import type { ProjectStatus } from '@launchkit/shared';
import { env } from '../env.js';

/**
 * Triggers a `generateAllAssetsForProject` task run on the Render
 * Workflows service. Used by the `/api/assets/:id/regenerate` route
 * after it flips the target asset's status back to `queued` in the
 * DB — the workflow parent picks up every asset on the project that
 * is in the queued state and dispatches it to the correct child task.
 *
 * Parallel to `apps/worker/src/lib/trigger-workflow-generation.ts`,
 * deliberately duplicated because each backend service constructs
 * its own lazy SDK client from its own typed env module. A shared
 * package was considered and rejected for PR 3: the helper is 40
 * lines, has no business logic, and moving it would just add a new
 * package-level abstraction for a concern that only two call sites
 * share.
 *
 * The client is lazy. The first call constructs the `Render` object
 * from `env.RENDER_API_KEY` and reuses it for every subsequent call.
 * Fires and forgets the run handle — we do NOT `await handle.get()`
 * because holding the web request open for the full generation
 * window (seconds to minutes) would defeat the fan-out. The parent
 * task itself enqueues the review BullMQ job when it finishes, so
 * the review path lights up without the web service having to poll.
 *
 * Local dev: when `RENDER_USE_LOCAL_DEV=true` is set in the web
 * service's environment, the SDK's `get-base-url` helper auto-routes
 * every `startTask` call to `http://localhost:8120` — the port that
 * `render workflows dev` exposes. Same code path as prod; only the
 * env var differs.
 */

let renderClient: Render | null = null;

function getRenderClient(): Render {
  if (renderClient !== null) return renderClient;

  const token = env.RENDER_API_KEY;
  if (token === undefined || token === '') {
    throw new Error(
      'triggerWorkflowGeneration (web): RENDER_API_KEY is required to trigger asset regeneration'
    );
  }

  renderClient = new Render({ token });
  return renderClient;
}

/**
 * Test-only seam. See the matching hook in
 * `trigger-remotion-render.ts` for the rationale. Pass `null` to
 * reset the cached client on test teardown.
 */
export function _setRenderClientForTests(fake: Render | null): void {
  renderClient = fake;
}

export async function triggerWorkflowGeneration(
  projectId: string,
  options?: {
    zeroSuccessProjectStatus?: ProjectStatus;
  }
): Promise<void> {
  const workflowSlug = env.RENDER_WORKFLOW_SLUG;
  if (workflowSlug === undefined || workflowSlug === '') {
    throw new Error(
      'triggerWorkflowGeneration (web): RENDER_WORKFLOW_SLUG is required to trigger asset regeneration'
    );
  }

  const client = getRenderClient();
  const taskIdentifier = `${workflowSlug}/generateAllAssetsForProject`;

  const handle = await client.workflows.startTask(taskIdentifier, [
    {
      projectId,
      ...(options?.zeroSuccessProjectStatus !== undefined
        ? { zeroSuccessProjectStatus: options.zeroSuccessProjectStatus }
        : {}),
    },
  ]);

  console.log(
    `[Web:TriggerWorkflow] Started ${taskIdentifier} for project ${projectId} as run ${handle.taskRunId}`
  );
}
