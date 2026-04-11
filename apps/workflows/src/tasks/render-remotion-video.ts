import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { task } from '@renderinc/sdk/workflows';
import { eq } from 'drizzle-orm';
import { assets } from '@launchkit/shared';
import {
  LaunchKitVideoPropsSchema,
  PodcastWaveformPropsSchema,
  VerticalVideoPropsSchema,
  VoiceCommercialPropsSchema,
} from '@launchkit/video';
import {
  createRemotionRenderer,
  type RemotionRenderer,
  type RemotionRenderInput,
} from '@launchkit/video/renderer';
import { createObjectStorageClient } from '@launchkit/asset-generators';
import { database as db } from '../lib/database.js';
import { env } from '../env.js';
import {
  RenderRemotionVideoInputSchema,
  type RenderRemotionVideoInput,
  type RenderRemotionVideoResult,
} from './input-schemas.js';

/**
 * Remotion render task — heavy compute, pro plan, 10 minute timeout.
 *
 * Called synchronously by the web service's `/api/assets/:id/video.mp4`
 * handler via `triggerRemotionRender` when the asset row has no
 * `rendered_video_url` yet. The web handler blocks on the task
 * run result and then 302-redirects the client to the returned
 * public URL.
 *
 * Flow:
 *
 *   1. Validate the input payload through its Zod schema and then
 *      the composition-specific props schema (routed by
 *      `compositionId`). Both parses are hard boundary checks —
 *      a malformed input fails here with a named field instead
 *      of deep inside the Remotion bundler.
 *
 *   2. Re-read the `assets` row to check for an already-rendered
 *      URL. The caller can also check this before calling, but
 *      the task's own idempotent check avoids wasting a render
 *      if the row was populated by a concurrent call between
 *      the caller's check and the task start.
 *
 *   3. Create a process-lifetime singleton `RemotionRenderer`
 *      with its cache directory in `/tmp/remotion-renders` — the
 *      only writable path on Render's pro dyno that survives
 *      the task run. Concurrency comes from `env.REMOTION_CONCURRENCY`
 *      (defaults to `'50%'`).
 *
 *   4. Render the composition. The renderer's built-in browser
 *      pool + retry logic handle transient Chrome crashes; a
 *      hard failure bubbles up as the task's error.
 *
 *   5. Read the rendered MP4 bytes into memory and upload them
 *      to MinIO via the shared `createObjectStorageClient`
 *      wrapper. Key pattern is
 *      `videos/<assetId>-v<version>-<variant>.mp4` so a future
 *      re-render of the same asset+version+variant overwrites
 *      the previous upload instead of leaking orphaned objects.
 *
 *   6. Persist the resulting public URL and storage key on the
 *      `assets` row so subsequent calls short-circuit on the
 *      cache-hit check in step 2.
 *
 *   7. Return `{url, key, cached, sizeBytes}` to the caller. The
 *      web handler redirects the browser to `url`.
 *
 * Partial-failure story: a render crash marks the asset row
 * unchanged (no `rendered_video_url` written) and throws. The
 * Render Workflows retry policy handles transient browser
 * failures; persistent failures surface to the user as a 502
 * from the web route, which is a better UX than silently
 * showing a half-finished video.
 */

// Process-lifetime singleton — the task process lives only as
// long as one invocation on Render Workflows, but the same
// process may serve multiple chained calls if the SDK batches
// runs. Sharing the renderer across calls keeps the browser
// pool warm for the (rare) second render in the same task
// instance.
let rendererInstance: RemotionRenderer | null = null;
function getRenderer(): RemotionRenderer {
  rendererInstance ??= createRemotionRenderer({
    // Render's pro dyno exposes `/tmp` as the only writable
    // path that survives the task run. The renderer creates
    // the directory on first render so there is no bootstrap
    // step needed in the task body.
    cacheDir: '/tmp/remotion-renders',
    concurrency: env.REMOTION_CONCURRENCY,
  });
  return rendererInstance;
}

function parseCompositionInput(
  compositionId: RenderRemotionVideoInput['compositionId'],
  inputProps: unknown
): RemotionRenderInput {
  switch (compositionId) {
    case 'LaunchKitProductVideo':
      return {
        compositionId,
        inputProps: LaunchKitVideoPropsSchema.parse(inputProps),
      };
    case 'LaunchKitVoiceCommercial':
      return {
        compositionId,
        inputProps: VoiceCommercialPropsSchema.parse(inputProps),
      };
    case 'LaunchKitPodcastWaveform':
      return {
        compositionId,
        inputProps: PodcastWaveformPropsSchema.parse(inputProps),
      };
    case 'LaunchKitVerticalVideo':
      return {
        compositionId,
        inputProps: VerticalVideoPropsSchema.parse(inputProps),
      };
  }
}

export const renderRemotionVideo = task<
  [RenderRemotionVideoInput],
  RenderRemotionVideoResult
>(
  {
    name: 'renderRemotionVideo',
    plan: 'pro',
    timeoutSeconds: 600,
    retry: {
      maxRetries: 2,
      waitDurationMs: 3000,
      backoffScaling: 2,
    },
  },
  async function renderRemotionVideo(
    input: RenderRemotionVideoInput
  ): Promise<RenderRemotionVideoResult> {
    const parsed = RenderRemotionVideoInputSchema.parse(input);

    // 1. Short-circuit on an existing rendered URL — but ONLY for
    //    the visual variant. The `assets.rendered_video_url` cache
    //    column tracks one slot per asset, so mixing variants would
    //    let a stale narrated URL serve a subsequent visual request
    //    (or vice versa). Visual is the default, deterministic,
    //    and safe to cache; narrated is user-initiated with a
    //    voiceover-specific cacheSeed and renders fresh every time
    //    so the audio data URI stays current against the latest
    //    ElevenLabs synthesis.
    //
    //    Known race: two concurrent `renderRemotionVideo` runs
    //    targeting the same `(assetId, version, 'visual')` can
    //    both reach this check before either has written a URL,
    //    render in parallel, and both upload. The second upload's
    //    DB write overwrites the first — no data corruption, but
    //    the second render wastes a full pro-dyno cycle. We
    //    accept this tradeoff because the alternatives (advisory
    //    lock, DB-level unique constraint with ON CONFLICT, or an
    //    idempotency key on the SDK side) each add cross-service
    //    coordination complexity for a race window we have not
    //    observed in practice. The web route's own cache-hit
    //    check filters most duplicate triggers before the task
    //    even starts; only genuinely simultaneous first-clicks
    //    on a never-rendered asset hit this path.
    const [existing] = await db
      .select({
        renderedVideoUrl: assets.renderedVideoUrl,
        renderedVideoKey: assets.renderedVideoKey,
        version: assets.version,
      })
      .from(assets)
      .where(eq(assets.id, parsed.assetId));

    if (!existing) {
      throw new Error(`Asset ${parsed.assetId} not found`);
    }

    // Version-mismatch detection: the caller passes the version it
    // expected to render for. If the DB version moved forward
    // (e.g. a concurrent regenerate bumped the row), discard the
    // cached URL rather than returning a stale render.
    const cacheIsStale = existing.version !== parsed.version;

    if (
      parsed.variant === 'visual' &&
      !cacheIsStale &&
      existing.renderedVideoUrl !== null &&
      existing.renderedVideoKey !== null
    ) {
      // Trust but verify: if the stored URL is non-empty, assume
      // the object exists in MinIO. We do not round-trip a
      // HeadObject here because the task boots on a fresh Render
      // instance every call and the overhead would dominate the
      // fast path. `sizeBytes` is reported as `0` on cache hits;
      // callers that care about real byte counts should filter
      // on `cached === true` before summing. Persisting the
      // actual byte count on the asset row so cache hits can
      // return the real value is a follow-up — the schema has
      // no column for it today and this path has no consumer
      // that reads it.
      return {
        url: existing.renderedVideoUrl,
        key: existing.renderedVideoKey,
        cached: true,
        sizeBytes: 0,
      };
    }

    // 2. Validate the composition props and render.
    const compositionInput = parseCompositionInput(
      parsed.compositionId,
      parsed.inputProps
    );

    const renderer = getRenderer();
    const { outputPath } = await renderer.render({
      ...compositionInput,
      assetId: parsed.assetId,
      version: parsed.version,
      variant: parsed.variant,
      ...(parsed.cacheSeed !== undefined
        ? { cacheSeed: parsed.cacheSeed }
        : {}),
    });

    // 3. Upload the finished MP4 bytes to MinIO. Config is pulled
    //    from the typed workflows env module; missing fields
    //    throw a structured error so the failure is obvious to
    //    the operator debugging in Render logs.
    if (
      env.MINIO_ENDPOINT_HOST === undefined ||
      env.MINIO_ROOT_USER === undefined ||
      env.MINIO_ROOT_PASSWORD === undefined
    ) {
      throw new Error(
        'renderRemotionVideo requires MinIO config — set MINIO_ENDPOINT_HOST, MINIO_ROOT_USER, and MINIO_ROOT_PASSWORD on the workflows service'
      );
    }

    const storage = createObjectStorageClient({
      endpoint: `https://${env.MINIO_ENDPOINT_HOST}`,
      bucket: env.MINIO_BUCKET,
      accessKeyId: env.MINIO_ROOT_USER,
      secretAccessKey: env.MINIO_ROOT_PASSWORD,
    });

    const basename = path.basename(outputPath);
    const key = `videos/${parsed.assetId}-v${String(parsed.version)}-${parsed.variant}-${basename}`;
    const bytes = await readFile(outputPath);
    const uploaded = await storage.uploadVideo(key, bytes, 'video/mp4');

    // 4. Persist the URL + key on the asset row — but ONLY for the
    //    visual variant. Writing a narrated URL to the cache column
    //    would poison every subsequent visual request, because the
    //    web handler reads `assets.rendered_video_url` and redirects
    //    to whatever is stored there regardless of the original
    //    variant. Keeping the cache column as "visual video cache"
    //    is the simplest invariant that preserves correctness: a
    //    future contributor who wants narrated caching can add a
    //    sibling `rendered_narrated_video_url` column without
    //    touching the read path's branching logic.
    if (parsed.variant === 'visual') {
      await db
        .update(assets)
        .set({
          renderedVideoUrl: uploaded.url,
          renderedVideoKey: uploaded.key,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, parsed.assetId));
    }

    return {
      url: uploaded.url,
      key: uploaded.key,
      cached: false,
      sizeBytes: uploaded.sizeBytes,
    };
  }
);
