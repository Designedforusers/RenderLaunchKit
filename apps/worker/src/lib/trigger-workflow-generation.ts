import { Render } from '@renderinc/sdk';
import { env } from '../env.js';

/**
 * Triggers a `generateAllAssetsForProject` run on the Render
 * Workflows service for a given project.
 *
 * Called from three code paths in the worker, all of them after
 * asset rows have been flipped to `status='queued'` in the DB:
 *
 *   1. The strategize handler in `src/index.ts` — immediately after
 *      `buildProjectLaunchStrategy` persists the strategy and its
 *      initial asset rows.
 *   2. `review-generated-assets.ts` — after the creative director
 *      rejects one or more assets and re-queues them for revision.
 *   3. `process-commit-marketing-run.ts` — after the commit
 *      marketing run decides which existing project assets to
 *      refresh in light of a new commit.
 *
 * In every case the workflow parent task reads the project's
 * `status='queued'` asset set and fans out to the five child tasks
 * via run chaining. The SDK client is lazy and only instantiates on
 * first call, so worker boot never requires `RENDER_API_KEY` — the
 * helper throws a structured error at call time if the env is
 * missing. That keeps the analyze → research handlers booting
 * cleanly in environments that have not yet been wired to the
 * workflow service.
 *
 * Fires and forgets the run handle: we do NOT `await handle.get()`.
 * Holding the analysis worker's BullMQ slot until the parent task
 * completes would pin the worker for the full generation window
 * (tens of minutes) and defeat the point of offloading fan-out to
 * Workflows. The parent task itself enqueues the review BullMQ job
 * when every child settles, so the review path lights up without
 * the worker having to poll.
 *
 * Local dev: if `RENDER_USE_LOCAL_DEV=true` is set on the worker's
 * environment, the SDK's `get-base-url` helper auto-routes the
 * call to `http://localhost:8120` — the port that `render workflows
 * dev` exposes for the local task server. No code change here; we
 * just document the behaviour so an operator debugging a flaky
 * local run knows which knob to look at.
 */

let renderClient: Render | null = null;

function getRenderClient(): Render {
  if (renderClient !== null) return renderClient;

  const token = env.RENDER_API_KEY;
  if (token === undefined || token === '') {
    throw new Error(
      'triggerWorkflowGeneration: RENDER_API_KEY is required to trigger the generateAllAssetsForProject workflow task'
    );
  }

  renderClient = new Render({ token });
  return renderClient;
}

export async function triggerWorkflowGeneration(
  projectId: string
): Promise<void> {
  const workflowSlug = env.RENDER_WORKFLOW_SLUG;
  if (workflowSlug === undefined || workflowSlug === '') {
    throw new Error(
      'triggerWorkflowGeneration: RENDER_WORKFLOW_SLUG is required to address the deployed workflow service'
    );
  }

  const client = getRenderClient();
  const taskIdentifier = `${workflowSlug}/generateAllAssetsForProject`;

  const handle = await client.workflows.startTask(taskIdentifier, [
    { projectId },
  ]);

  console.log(
    `[Workflows:Trigger] Started ${taskIdentifier} for project ${projectId} as run ${handle.taskRunId}`
  );
}
