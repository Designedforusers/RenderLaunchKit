import { Render } from '@renderinc/sdk';
import { z } from 'zod';
import type {
  LaunchKitVideoProps,
  PodcastWaveformProps,
  VerticalVideoProps,
  VoiceCommercialProps,
} from '@launchkit/video';
import { env } from '../env.js';

/**
 * Triggers a `renderRemotionVideo` task run on the Render Workflows
 * service and AWAITS its result. Parallel in shape to
 * `trigger-workflow-generation.ts` but different in semantics: the
 * launch-kit generation trigger is fire-and-forget (the parent task
 * enqueues the review job on completion), while the video render
 * trigger is request/response (the web handler needs the public
 * URL to 302-redirect the browser).
 *
 * The helper constructs a lazy singleton `Render` SDK client on
 * first call and reuses it for every subsequent call. Fires the
 * task, waits on `handle.get()` until the task run reaches a
 * terminal state (`succeeded`, `failed`, or `canceled`), then
 * parses the first-slot result through Zod so the caller gets a
 * typed `{url, key, cached, sizeBytes}` payload instead of the
 * SDK's `unknown[]` surface.
 *
 * Local dev: when `RENDER_USE_LOCAL_DEV=true` is set in the web
 * service's environment, the SDK's `get-base-url` helper auto-routes
 * every `startTask` call to `http://localhost:8120` — the port that
 * `render workflows dev` exposes. Same code path as prod; only the
 * env var differs.
 *
 * Duplicated (not shared) with `trigger-workflow-generation.ts` for
 * the same reason the generation trigger is duplicated across the
 * web and worker services: each backend service owns its own lazy
 * SDK client from its own typed env module. Moving them to a shared
 * package would add an abstraction boundary for zero shared logic.
 */

const RenderRemotionVideoResultSchema = z.object({
  url: z.string().url(),
  key: z.string().min(1),
  cached: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
});

type TriggerRemotionRenderInputProps =
  | { compositionId: 'LaunchKitProductVideo'; inputProps: LaunchKitVideoProps }
  | {
      compositionId: 'LaunchKitVoiceCommercial';
      inputProps: VoiceCommercialProps;
    }
  | {
      compositionId: 'LaunchKitPodcastWaveform';
      inputProps: PodcastWaveformProps;
    }
  | {
      compositionId: 'LaunchKitVerticalVideo';
      inputProps: VerticalVideoProps;
    };

export type TriggerRemotionRenderInput = {
  assetId: string;
  version: number;
  variant?: 'visual' | 'narrated';
  cacheSeed?: string;
} & TriggerRemotionRenderInputProps;

export interface TriggerRemotionRenderResult {
  url: string;
  key: string;
  cached: boolean;
  sizeBytes: number;
  taskRunId: string;
}

let renderClient: Render | null = null;

function getRenderClient(): Render {
  if (renderClient !== null) return renderClient;

  const token = env.RENDER_API_KEY;
  if (token === undefined || token === '') {
    throw new Error(
      'triggerRemotionRender: RENDER_API_KEY is required to call the Remotion render workflow task'
    );
  }

  renderClient = new Render({ token });
  return renderClient;
}

/**
 * Test-only seam for unit tests that need to replace the lazy
 * singleton `Render` SDK client with a stub. Intentional escape
 * hatch — production code should never call this. Exported with
 * an underscore prefix and a doc comment so the "why is this
 * exported" question has an answer at the site.
 *
 * Pass `null` to reset the cached client on test teardown so the
 * next test that constructs the real client sees a fresh env.
 */
export function _setRenderClientForTests(fake: Render | null): void {
  renderClient = fake;
}

export async function triggerRemotionRender(
  input: TriggerRemotionRenderInput
): Promise<TriggerRemotionRenderResult> {
  const workflowSlug = env.RENDER_WORKFLOW_SLUG;
  if (workflowSlug === undefined || workflowSlug === '') {
    throw new Error(
      'triggerRemotionRender: RENDER_WORKFLOW_SLUG is required to call the Remotion render workflow task'
    );
  }

  const client = getRenderClient();
  const taskIdentifier = `${workflowSlug}/renderRemotionVideo`;

  const handle = await client.workflows.startTask(taskIdentifier, [
    {
      assetId: input.assetId,
      version: input.version,
      compositionId: input.compositionId,
      inputProps: input.inputProps,
      variant: input.variant ?? 'visual',
      ...(input.cacheSeed !== undefined ? { cacheSeed: input.cacheSeed } : {}),
    },
  ]);

  // `handle.get()` blocks until the task run reaches a terminal
  // state. Under normal operation a `renderRemotionVideo` run
  // settles inside the task's own 600-second timeout, but if the
  // orchestrator never delivers a terminal event (network
  // partition, task process killed mid-run without a clean
  // status write), the promise would hang forever and the web
  // dyno would hold the HTTP connection open until the client
  // disconnects. Race against a deadline slightly longer than
  // the task-side timeout so a stuck run surfaces as a
  // structured 502 instead of an indefinite hang. Caught by the
  // local code-reviewer pass on PR #63.
  const TASK_SETTLE_TIMEOUT_MS = 660_000; // 11 minutes
  const details = await Promise.race([
    handle.get(),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `triggerRemotionRender: task run did not settle within ${String(
              TASK_SETTLE_TIMEOUT_MS / 1000
            )}s — check the Render Workflows dashboard for orphaned runs`
          )
        );
      }, TASK_SETTLE_TIMEOUT_MS).unref();
    }),
  ]);

  if (details.status !== 'succeeded' && details.status !== 'completed') {
    throw new Error(
      `triggerRemotionRender: task run ${details.id} finished with status ${details.status}${
        details.error !== undefined ? ` — ${details.error}` : ''
      }`
    );
  }

  // The SDK surfaces `results` as `unknown[]` — the task returns a
  // single object at slot 0. Guard the length check explicitly so
  // a `canceled` or `paused` run that somehow slips past the status
  // check above surfaces as a clear "empty results" error instead
  // of a confusing Zod parse failure on `undefined`. Parse the
  // first slot through Zod at the boundary so the caller gets a
  // typed payload and a drift between our task return type and
  // the caller's expectations surfaces as a runtime error here,
  // not as a silent wrong redirect downstream.
  if (details.results.length === 0) {
    throw new Error(
      `triggerRemotionRender: task run ${details.id} returned no results (status=${details.status})`
    );
  }
  const firstResult = details.results[0];
  const parsed = RenderRemotionVideoResultSchema.safeParse(firstResult);
  if (!parsed.success) {
    throw new Error(
      `triggerRemotionRender: task run ${details.id} returned a malformed result: ${parsed.error.message}`
    );
  }

  return {
    url: parsed.data.url,
    key: parsed.data.key,
    cached: parsed.data.cached,
    sizeBytes: parsed.data.sizeBytes,
    taskRunId: details.id,
  };
}
