import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, desc, eq, ne } from 'drizzle-orm';
import { LaunchKitVideoPropsSchema } from '@launchkit/video';
import type { LaunchKitVideoProps } from '@launchkit/video';
import { database } from '../lib/database.js';
import { expensiveRouteRateLimit } from '../middleware/rate-limit.js';
import {
  buildElevenLabsCacheKey,
  getElevenLabsConfig,
  synthesizeSpeechWithTimestamps,
} from '../lib/elevenlabs.js';
import {
  alignmentToCaptions,
  audioBufferToDataUri,
  buildNarratedCacheSeed,
  buildNarratedVideoProps,
  mapNarrationToHeaderValue,
} from '../lib/narration.js';
import type { NarrationAudioSourceHeader } from '../lib/narration.js';
import { enqueueEmbedFeedbackEvent } from '../lib/job-queue-clients.js';
import { triggerWorkflowGeneration } from '../lib/trigger-workflow-generation.js';
import { triggerRemotionRender } from '../lib/trigger-remotion-render.js';
import { fileToWebStream } from '../lib/stream-utils.js';
import {
  AssetFeedbackEventRequestSchema,
  assetFeedbackEvents,
  assets,
  isParsedVoiceoverScript,
  parseVoiceoverScript,
  projects,
} from '@launchkit/shared';
import type { FeedbackAction } from '@launchkit/shared';
import {
  parseUuidParam,
  invalidUuidResponse,
} from '../lib/validate-uuid.js';

const assetApiRoutes = new Hono();

// Resolve paths relative to the monorepo root, not `process.cwd()`.
// `tsx watch` and `node dist/` both set cwd inside `apps/web/`,
// so anchoring paths off `import.meta.url` keeps the cache lookups
// consistent across dev and prod without per-request re-computation.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);


/**
 * Type guard for the Remotion video composition props pulled from
 * `assets.metadata.remotionProps`. Backed by the Zod schema in
 * `@launchkit/video` rather than a hand-rolled `value && typeof
 * candidate.title === 'string' && ...` chain — same name, same
 * call sites, but now structured errors and type-safety guarantees
 * come from the schema.
 */
function isLaunchKitVideoProps(value: unknown): value is LaunchKitVideoProps {
  return LaunchKitVideoPropsSchema.safeParse(value).success;
}

function getRequestedVariant(value: string | undefined): 'visual' | 'narrated' {
  return value === 'narrated' ? 'narrated' : 'visual';
}

function getParsedVoiceoverScriptFromAsset(
  metadata: Record<string, unknown> | null,
  content: string | null
) {
  if (isParsedVoiceoverScript(metadata)) {
    return metadata;
  }

  if (!content) {
    return null;
  }

  try {
    return parseVoiceoverScript(content);
  } catch {
    return null;
  }
}

// ── GET /api/assets/:id — Get a single asset ──

assetApiRoutes.get('/:id', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  const asset = await database.query.assets.findFirst({
    where: eq(assets.id, id),
  });

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  return c.json({
    id: asset.id,
    projectId: asset.projectId,
    type: asset.type,
    status: asset.status,
    content: asset.content,
    mediaUrl: asset.mediaUrl,
    metadata: asset.metadata,
    qualityScore: asset.qualityScore,
    reviewNotes: asset.reviewNotes,
    userApproved: asset.userApproved,
    userEdited: asset.userEdited,
    userEditedContent: asset.userEditedContent,
    version: asset.version,
    costCents: asset.costCents,
    costBreakdown: asset.costBreakdown,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  });
});

// ── GET /api/assets/:id/video.mp4 — Dispatch a Remotion render ──
//
// The rendering itself lives in the `renderRemotionVideo` task on
// the Render Workflows service (see `apps/workflows/src/tasks/
// render-remotion-video.ts`). This handler is a thin dispatcher:
//
//   1. Look up the asset row. Return 404 / 400 / 409 on any
//      structural precondition failure.
//   2. If the row already carries `rendered_video_url` and the
//      version matches, 302-redirect straight to MinIO — zero
//      workflow traffic for cache hits.
//   3. Build narrated props (via ElevenLabs) when the narrated
//      variant is requested. The narration step stays on the web
//      service so voice synthesis is not on the hot path of a
//      pro-dyno workflow run — it is I/O-bound against ElevenLabs
//      and runs fine on the web service's starter dyno. The
//      narrated `audioSrc` is embedded in the task payload; see
//      the payload-size caveat in `tasks/input-schemas.ts`.
//   4. Call `triggerRemotionRender` to invoke the workflow task.
//      The helper awaits the run to completion and parses the
//      result through a Zod schema so the returned URL is typed.
//   5. 302-redirect to the public URL the workflows task
//      persisted on the asset row. When `?download=1` is set,
//      proxy the response through the web dyno with a
//      Content-Disposition header so the browser downloads
//      instead of navigating (avoids cross-origin CORS issues
//      with the MinIO service).
assetApiRoutes.get('/:id/video.mp4', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  const variant = getRequestedVariant(c.req.query('variant'));
  const asset = await database.query.assets.findFirst({
    where: eq(assets.id, id),
  });

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  if (asset.type !== 'product_video') {
    return c.json({ error: 'Only product video assets can be rendered as MP4' }, 400);
  }

  // Fast-path cache hit on a previously-rendered URL. The
  // workflows task is idempotent-ish on `(assetId, version)` —
  // rendering the same version twice just overwrites the upload
  // — so a row that already carries a URL is trustworthy as long
  // as the version matches. `?variant=narrated` uses a separate
  // `rendered_video_url` cache slot is a future enhancement;
  // today the single column stores the most recent render
  // regardless of variant, and cross-variant requests fall
  // through to the workflow call which produces a fresh upload.
  if (
    variant === 'visual' &&
    asset.renderedVideoUrl !== null &&
    asset.renderedVideoUrl !== ''
  ) {
    // Download proxy for the fast-path cache hit too.
    if (c.req.query('download') === '1') {
      const upstream = await fetch(asset.renderedVideoUrl);
      if (!upstream.ok) {
        return c.json({ error: 'Failed to fetch video from storage' }, 502);
      }
      const filename = `${asset.projectId}-visual.mp4`;
      c.header('Content-Type', 'video/mp4');
      c.header('Content-Disposition', `attachment; filename="${filename}"`);
      const contentLength = upstream.headers.get('content-length');
      if (contentLength !== null) {
        c.header('Content-Length', contentLength);
      }
      if (!upstream.body) {
        return c.json({ error: 'Storage returned empty body' }, 502);
      }
      return c.body(upstream.body);
    }
    return c.redirect(asset.renderedVideoUrl, 302);
  }

  const metadata = (asset.metadata as Record<string, unknown> | null) ?? null;
  const remotionProps = metadata?.['remotionProps'];

  if (!isLaunchKitVideoProps(remotionProps)) {
    return c.json({ error: 'This asset does not have Remotion render data yet' }, 409);
  }

  // Narrated variant: synthesize the voiceover on the web service
  // (I/O-bound ElevenLabs call, cheap on a starter dyno). The
  // synthesis function owns a three-tier cache (local disk →
  // MinIO → ElevenLabs API), so by the time it returns the audio
  // is already in every durable location we have and the route
  // just needs to decide what shape to pass through to the
  // workflow task. Visual variant skips this branch.
  let taskInputProps: LaunchKitVideoProps = remotionProps;
  let cacheSeed: string | undefined;
  let narrationCache = 'n/a';
  // The `X-Narration-Audio-Src` response header lets operators
  // debugging cost drift or missing renders distinguish a
  // deploy-surviving MinIO read hit (`minio-read-hit`) from a
  // cold ElevenLabs call that uploaded successfully (`minio`),
  // a cold ElevenLabs call where the MinIO upload threw
  // (`minio-failed`), or a MinIO-less fallback to a data URI
  // (`data-uri`). The mapping itself lives in
  // `mapNarrationToHeaderValue`.
  let narrationAudioSourceHeader: NarrationAudioSourceHeader = 'n/a';

  if (variant === 'narrated') {
    const config = getElevenLabsConfig();
    if (!config) {
      return c.json(
        {
          error:
            'Narrated video requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID',
        },
        409
      );
    }

    const voiceoverAsset = await database.query.assets.findFirst({
      where: and(
        eq(assets.projectId, asset.projectId),
        eq(assets.type, 'voiceover_script'),
        ne(assets.status, 'failed')
      ),
      orderBy: [desc(assets.updatedAt)],
    });

    if (!voiceoverAsset) {
      return c.json({ error: 'No usable voiceover script exists for this project' }, 409);
    }

    const parsedVoiceover = getParsedVoiceoverScriptFromAsset(
      (voiceoverAsset.metadata as Record<string, unknown> | null) ?? null,
      voiceoverAsset.content
    );

    if (!parsedVoiceover || parsedVoiceover.segmentCount === 0) {
      return c.json(
        { error: 'The current voiceover script is not in a usable structured format' },
        409
      );
    }

    const narrationSeed = buildNarratedCacheSeed({
      assetId: asset.id,
      assetVersion: asset.version,
      voiceoverAssetId: voiceoverAsset.id,
      voiceoverVersion: voiceoverAsset.version,
      voiceId: config.voiceId,
      modelId: config.modelId,
      plainText: parsedVoiceover.plainText,
      remotionProps,
    });
    const narration = await synthesizeSpeechWithTimestamps({
      cacheKey: buildElevenLabsCacheKey(narrationSeed),
      text: parsedVoiceover.plainText,
    });

    // `X-Narration-Cache` stays tri-state for backward compat: the
    // dashboard reads 'hit' | 'miss' | 'n/a'. Tier-1 and tier-2
    // both count as a hit because neither spent ElevenLabs credit.
    narrationCache = narration.cacheSource === 'api' ? 'miss' : 'hit';

    // Pick the audioSrc shape for the workflow task payload. When
    // synthesis returned a MinIO URL we pass it through — a
    // ~200-byte string instead of a ~3-5 MB data URI — otherwise
    // we fall back to inlining the buffer. Both shapes are
    // accepted by Remotion's `<Audio src={...}>` unchanged.
    const narrationAudioSrc =
      narration.minioUrl ?? audioBufferToDataUri(narration.audioBuffer);

    narrationAudioSourceHeader = mapNarrationToHeaderValue(narration);

    taskInputProps = buildNarratedVideoProps({
      baseProps: remotionProps,
      audioSrc: narrationAudioSrc,
      captions: alignmentToCaptions(parsedVoiceover, narration.alignment),
    });
    cacheSeed = narrationSeed;
  }

  // Dispatch to the workflow task and wait for it to finish. The
  // task handles render + MinIO upload + asset row update; the
  // helper blocks until the task reaches a terminal state and
  // parses the result through a Zod schema.
  const rendered = await triggerRemotionRender({
    assetId: asset.id,
    version: asset.version,
    compositionId: 'LaunchKitProductVideo',
    inputProps: taskInputProps,
    variant,
    ...(cacheSeed !== undefined ? { cacheSeed } : {}),
  });

  const redirectUrl = rendered.url;
  c.header('X-Remotion-Cache', rendered.cached ? 'hit' : 'miss');
  c.header('X-Narration-Cache', narrationCache);
  c.header('X-Narration-Audio-Src', narrationAudioSourceHeader);
  c.header('X-Task-Run-Id', rendered.taskRunId);

  // When `?download=1` is set, proxy the video through the web dyno
  // with Content-Disposition so the browser triggers a download. A
  // plain 302 to MinIO fails for fetch-based downloads because the
  // dashboard and MinIO are on different origins (no CORS).
  const wantsDownload = c.req.query('download') === '1';
  if (wantsDownload) {
    const upstream = await fetch(redirectUrl);
    if (!upstream.ok) {
      return c.json({ error: 'Failed to fetch video from storage' }, 502);
    }
    const filename = `${asset.projectId}-${variant}.mp4`;
    c.header('Content-Type', 'video/mp4');
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength !== null) {
      c.header('Content-Length', contentLength);
    }
    if (!upstream.body) {
      return c.json({ error: 'Storage returned empty body' }, 502);
    }
    return c.body(upstream.body);
  }

  // Default: 302 redirect to the public MinIO URL. The workflow task
  // has already persisted the URL on `assets.renderedVideoUrl`, so
  // subsequent requests short-circuit on the fast-path check above.
  return c.redirect(redirectUrl, 302);
});

// ── GET /api/assets/:id/audio.mp3 — Stream the worker-rendered audio ──
//
// Validation through the inline Zod schema folds two failure modes
// into one rejection path: a missing `audioCacheKey` and a malformed
// one (anything that isn't 16 hex chars) both fail `safeParse` with
// the same 422. The hex regex is the path-traversal defence — combined
// with `path.resolve` against a fixed cache directory, no value that
// passes the schema can escape the cache root.

const audioMetadataSchema = z.object({
  audioCacheKey: z.string().regex(/^[a-f0-9]{16}$/),
});

assetApiRoutes.get('/:id/audio.mp3', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  const asset = await database.query.assets.findFirst({
    where: eq(assets.id, id),
  });

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  if (asset.type !== 'voice_commercial' && asset.type !== 'podcast_script') {
    return c.json(
      { error: 'Only voice_commercial and podcast_script assets can be streamed as audio' },
      400
    );
  }

  // Redirect to durable object storage when available (deployed topology).
  // The workflows service uploads the MP3 to MinIO after ElevenLabs
  // synthesis and stores the public URL on metadata.audioObjectUrl.
  // This short-circuits before the local-disk path so production
  // dynos never 404 on a missing local file. The local-disk fallback
  // below remains for local dev without MinIO.
  const assetMetadata = asset.metadata as Record<string, unknown> | null;
  const audioObjectUrl = assetMetadata?.['audioObjectUrl'];
  if (typeof audioObjectUrl === 'string' && audioObjectUrl.length > 0) {
    return c.redirect(audioObjectUrl, 302);
  }

  const parsed = audioMetadataSchema.safeParse(asset.metadata);
  if (!parsed.success) {
    // Distinct status from the file-missing 404 below: a 422 says
    // "the metadata blob does not look like a worker-rendered audio
    // asset", which usually means the seed shipped a stub or a
    // regeneration is in flight. Surfaces a clearer signal in the
    // dashboard than a generic 409.
    return c.json(
      { error: 'Asset metadata does not contain a valid audioCacheKey' },
      422
    );
  }

  const audioPath = path.resolve(
    REPO_ROOT,
    '.cache/elevenlabs-rendered',
    `${parsed.data.audioCacheKey}.mp3`
  );

  if (!existsSync(audioPath)) {
    return c.json(
      { error: 'Rendered audio file is not available on disk yet' },
      404
    );
  }

  // Stream the file from disk rather than buffering it in memory —
  // same memory-bounded pattern (and same `fileToWebStream` helper)
  // as the video.mp4 route above. The Node-vs-WHATWG ReadableStream
  // type bridge lives in `stream-utils.ts` so this route doesn't
  // need its own cast.
  const fileStat = await stat(audioPath);
  const shouldDownload = c.req.query('download') === '1';
  const filename = `${asset.id}-v${asset.version}-${asset.type}.mp3`;

  return new Response(fileToWebStream(audioPath), {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(fileStat.size),
      'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// ── Phase 7: feedback event log helper ──
//
// Every user action (approve / reject / edit / regenerate) writes a
// row to `asset_feedback_events`. This helper centralises the insert
// + the conditional `EMBED_FEEDBACK_EVENT` enqueue so the four legacy
// routes stay small and the new POST /:id/feedback route can reuse
// the same path. The async work — Voyage embedding — is decoupled
// from the user response so a Voyage hiccup never blocks the route.
//
// `userId` is null for now; per-user auth lands in a future iteration.
//
// Returns a struct so the new POST /:id/feedback route can report
// the actual enqueue outcome to the caller (NOT just "this was an
// edited action so the embedding will probably get queued"). The
// distinction matters: if BullMQ is unavailable when the route
// fires, the event row is committed but the embedding job is not
// queued — the response should reflect that.

interface FeedbackEventResult {
  id: string;
  embeddingQueued: boolean;
}

async function writeFeedbackEvent(input: {
  assetId: string;
  action: FeedbackAction;
  editText: string | null;
}): Promise<FeedbackEventResult | null> {
  // The insert is a side effect for the four legacy routes
  // (approve / reject / content / regenerate) — a Postgres hiccup on
  // the feedback row must NOT 500 an otherwise-successful user action.
  // We swallow the error, log it, and return null. The new
  // POST /:id/feedback route still correctly surfaces a 500 via its
  // existing `result === null` check because the row was never
  // persisted, so callers of the canonical endpoint still know the
  // event did not land.
  let event: { id: string } | undefined;
  try {
    [event] = await database
      .insert(assetFeedbackEvents)
      .values({
        assetId: input.assetId,
        action: input.action,
        editText: input.editText,
      })
      .returning({ id: assetFeedbackEvents.id });
  } catch (err) {
    console.warn(
      `[asset-api] writeFeedbackEvent insert failed for asset ${input.assetId} —`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }

  if (!event) return null;

  let embeddingQueued = false;
  if (input.action === 'edited' && input.editText !== null) {
    try {
      await enqueueEmbedFeedbackEvent(event.id);
      embeddingQueued = true;
    } catch (err) {
      // BullMQ enqueue failed (Redis down, queue unavailable). The
      // event row is already committed and the user action stays
      // successful — this is a non-fatal degradation. Log so an
      // operator notices the missing embeddings; the next BullMQ
      // restart picks up the queue but historical events from this
      // window will not have embeddings until they're reprocessed
      // manually (out of scope for Phase 7).
      console.warn(
        `[asset-api] enqueueEmbedFeedbackEvent failed for ${event.id} —`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return { id: event.id, embeddingQueued };
}

// ── POST /api/assets/:id/approve — Approve an asset ──

assetApiRoutes.post('/:id/approve', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  const [updated] = await database
    .update(assets)
    .set({ userApproved: true, updatedAt: new Date() })
    .where(eq(assets.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  // Phase 7: feedback event side effect. Failure to write the event
  // does not fail the user action — the existing legacy response
  // shape is preserved.
  await writeFeedbackEvent({
    assetId: updated.id,
    action: 'approved',
    editText: null,
  });

  return c.json({ id: updated.id, userApproved: true });
});

// ── POST /api/assets/:id/reject — Reject an asset ──

assetApiRoutes.post('/:id/reject', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  const [updated] = await database
    .update(assets)
    .set({ userApproved: false, updatedAt: new Date() })
    .where(eq(assets.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  await writeFeedbackEvent({
    assetId: updated.id,
    action: 'rejected',
    editText: null,
  });

  return c.json({ id: updated.id, userApproved: false });
});

// ── PUT /api/assets/:id/content — Edit asset content ──

const editAssetContentSchema = z.object({
  content: z.string().min(1, 'Content is required'),
});

assetApiRoutes.put('/:id/content', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = editAssetContentSchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      400
    );
  }

  const [updated] = await database
    .update(assets)
    .set({
      userEdited: true,
      userEditedContent: parsed.data.content,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  // Phase 7: write the feedback event with the edit text. The
  // helper enqueues the background Voyage embedding job because
  // `action === 'edited'` AND `editText !== null`.
  await writeFeedbackEvent({
    assetId: updated.id,
    action: 'edited',
    editText: parsed.data.content,
  });

  return c.json({ id: updated.id, userEdited: true });
});

// ── POST /api/assets/:id/regenerate — Regenerate an asset ──

const regenerateAssetSchema = z.object({
  instructions: z.string().optional(),
  modelPreferences: z
    .object({
      imageModel: z.enum(['auto', 'flux-pro-ultra', 'nano-banana-pro']).optional(),
      videoModel: z.enum(['auto', 'kling-v3', 'seedance-2']).optional(),
    })
    .optional(),
});

assetApiRoutes.post('/:id/regenerate', expensiveRouteRateLimit, async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const bodyParse = regenerateAssetSchema.safeParse(rawBody);
  if (!bodyParse.success) {
    return c.json(
      { error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' },
      400
    );
  }
  const body = bodyParse.data;

  const asset = await database.query.assets.findFirst({
    where: eq(assets.id, id),
  });

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  // Get the parent project for context
  const project = await database.query.projects.findFirst({
    where: eq(projects.id, asset.projectId),
  });

  if (!project) {
    return c.json({ error: 'Parent project not found' }, 404);
  }

  if (!project.repoAnalysis || !project.research || !project.strategy) {
    return c.json({ error: 'Project is not ready for regeneration yet' }, 409);
  }

  // Flip the asset status to `queued` so the workflow parent task's
  // `queued`-asset filter picks it up, and bump the version so the
  // downstream child task's idempotent-retry guard sees this as a
  // fresh attempt. The `regenerating` status the legacy BullMQ path
  // used is no longer observable — the workflow child task flips
  // every queued asset to `generating` as its first DB write, then
  // to `reviewing` on success (or `failed` on error).
  //
  // If the caller passed `body.instructions`, it's persisted to the
  // new `revisionInstructions` column as the "here's what to change"
  // overlay for the next agent run. The asset's original
  // `generationInstructions` (on metadata) is left untouched —
  // `dispatchAsset` in the workflows service reads both at run time
  // and threads them through to the agent as separate prompt inputs,
  // so the original brief stays stable across regeneration cycles
  // while the per-run revision overlay changes.
  const [updated] = await database
    .update(assets)
    .set({
      status: 'queued',
      version: asset.version + 1,
      renderedVideoUrl: null,
      renderedVideoKey: null,
      ...(body.instructions !== undefined
        ? { revisionInstructions: body.instructions }
        : {}),
      ...(body.modelPreferences !== undefined
        ? { metadata: { ...((asset.metadata as Record<string, unknown>) ?? {}), modelPreferences: body.modelPreferences } }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(assets.id, id), eq(assets.version, asset.version)))
    .returning();

  if (!updated) {
    return c.json(
      { error: 'Asset was modified by another request; refresh and retry' },
      409
    );
  }

  // Trigger the parent workflow task. It reads every queued asset
  // on the project (which is now just this one, because the other
  // project assets are all in terminal states) and dispatches it to
  // the correct child task.
  await triggerWorkflowGeneration(asset.projectId, {
    zeroSuccessProjectStatus: project.status,
  });

  // Phase 7: feedback event log. A regeneration is a signal — even
  // without an edit text — that the user wasn't happy with the prior
  // version. The aggregator can correlate regeneration rate with
  // asset type / category to surface "this kind of asset gets
  // regenerated a lot."
  await writeFeedbackEvent({
    assetId: updated.id,
    action: 'regenerated',
    editText: null,
  });

  return c.json({ id: updated.id, status: 'queued', version: updated.version });
});

// ── POST /api/assets/:id/feedback — Unified feedback event log ──
//
// Phase 7. Validates the request body against the discriminated
// union `AssetFeedbackEventRequestSchema` (defined in
// `@launchkit/shared` since Phase 2). Writes one row to
// `asset_feedback_events`. For `'edited'` actions, also enqueues a
// background job to compute the Voyage embedding of the edit text.
//
// The four legacy routes (approve / reject / content / regenerate)
// ALSO write feedback events as a side effect of their existing
// work — this route exists for clients that want a single endpoint,
// for the dashboard's eventual unified action surface, and as the
// canonical "correct" feedback API. The legacy routes will likely
// proxy to this implementation in a future cleanup pass.

assetApiRoutes.post('/:id/feedback', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  const rawBody: unknown = await c.req.json().catch(() => null);
  const bodyParse = AssetFeedbackEventRequestSchema.safeParse(rawBody);
  if (!bodyParse.success) {
    return c.json(
      { error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' },
      400
    );
  }

  // Verify the asset exists before writing the event so we can
  // surface a 404 instead of a confusing FK violation.
  const asset = await database.query.assets.findFirst({
    where: eq(assets.id, id),
  });
  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  // The discriminated union narrows `editText` to a string only on
  // the `'edited'` branch — `bodyParse.data.editText` only exists
  // when the parser proves it's there.
  const editText =
    bodyParse.data.action === 'edited' ? bodyParse.data.editText : null;

  const result = await writeFeedbackEvent({
    assetId: id,
    action: bodyParse.data.action,
    editText,
  });

  if (!result) {
    return c.json({ error: 'Failed to write feedback event' }, 500);
  }

  // `embeddingQueued` reflects the ACTUAL enqueue outcome — true only
  // when the row is an `'edited'` action AND BullMQ accepted the job.
  // A `false` here for an `'edited'` action means the row is in the
  // database but no background embedding job is running.
  return c.json(
    {
      feedbackEventId: result.id,
      action: bodyParse.data.action,
      embeddingQueued: result.embeddingQueued,
    },
    201
  );
});

export default assetApiRoutes;
