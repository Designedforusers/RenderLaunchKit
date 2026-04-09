import { Render } from '@renderinc/sdk';
import { env } from '../env.js';

/**
 * Triggers a `generateAllAssetsForProject` run on the Render
 * Workflows service for a given project. Replaces `fanOutGeneration`
 * when `GENERATION_RUNTIME=workflows`.
 *
 * Fires and forgets the run handle: we do NOT `await handle.get()`.
 * Holding the analysis worker's BullMQ slot until the parent task
 * completes would pin the worker for ~the full generation window
 * (tens of minutes) and defeat the entire point of offloading the
 * fan-out onto Workflows. The parent task itself enqueues the review
 * BullMQ job when it finishes, so the review path lights up without
 * the worker having to poll.
 *
 * The Render SDK client is lazy — constructed on first call so a
 * worker that boots with `GENERATION_RUNTIME=bullmq` (the default)
 * never instantiates the SDK and never trips the
 * `RENDER_API_KEY` presence check.
 *
 * Local dev: if `RENDER_USE_LOCAL_DEV=true` is set in the worker's
 * environment, the SDK's `get-base-url` helper auto-routes the call
 * to `http://localhost:8120` — the port that `render workflows dev`
 * exposes for the local task server. No code change here; we just
 * document the behaviour so an operator debugging a flaky local run
 * knows which knob to look at.
 */

let renderClient: Render | null = null;

function getRenderClient(): Render {
  if (renderClient !== null) return renderClient;

  const token = env.RENDER_API_KEY;
  if (token === undefined || token === '') {
    throw new Error(
      'triggerWorkflowGeneration: RENDER_API_KEY is required when GENERATION_RUNTIME=workflows'
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
      'triggerWorkflowGeneration: RENDER_WORKFLOW_SLUG is required when GENERATION_RUNTIME=workflows'
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
