import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { LaunchKitVideoPropsSchema } from '@launchkit/video';
import type { LaunchKitVideoProps } from '@launchkit/video';
import { database } from '../lib/database.js';
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
} from '../lib/narration.js';
import { enqueueEmbedFeedbackEvent } from '../lib/job-queue-clients.js';
import { triggerWorkflowGeneration } from '../lib/trigger-workflow-generation.js';
import {
  getRenderedVideoFilename,
  renderLaunchVideoAsset,
} from '../lib/remotion-render.js';
import { fileToWebStream } from '../lib/stream-utils.js';
import {
  AssetFeedbackEventRequestSchema,
  assetFeedbackEvents,
  assets,
  isParsedVoiceoverScript,
  parseVoiceoverScript,
  projects,
} from '@launchkit/shared';

const assetApiRoutes = new Hono();

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
  const id = c.req.param('id');

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
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  });
});

// ── GET /api/assets/:id/video.mp4 — Render/download a Remotion MP4 ──

assetApiRoutes.get('/:id/video.mp4', async (c) => {
  const id = c.req.param('id');
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

  const metadata = (asset.metadata as Record<string, unknown> | null) ?? null;
  const remotionProps = metadata?.['remotionProps'];

  if (!isLaunchKitVideoProps(remotionProps)) {
    return c.json({ error: 'This asset does not have Remotion render data yet' }, 409);
  }

  let rendered;
  let narrationCache = 'n/a';

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

    const projectAssets = await database.query.assets.findMany({
      where: eq(assets.projectId, asset.projectId),
    });
    const voiceoverAsset = [...projectAssets]
      .filter(
        (candidate) =>
          candidate.type === 'voiceover_script' && candidate.status !== 'failed'
      )
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime()
      )[0];

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
    narrationCache = narration.cached ? 'hit' : 'miss';

    const renderedProps = buildNarratedVideoProps({
      baseProps: remotionProps,
      audioSrc: audioBufferToDataUri(narration.audioBuffer),
      captions: alignmentToCaptions(parsedVoiceover, narration.alignment),
    });

    rendered = await renderLaunchVideoAsset({
      assetId: asset.id,
      version: asset.version,
      inputProps: renderedProps,
      variant: 'narrated',
      cacheSeed: narrationSeed,
    });
  } else {
    rendered = await renderLaunchVideoAsset({
      assetId: asset.id,
      version: asset.version,
      inputProps: remotionProps,
      variant: 'visual',
    });
  }

  // Stream the file from disk rather than buffering it in memory.
  //
  // A 30-second 1080p Remotion render can easily exceed 100 MB. On Render's
  // starter plan (512 MB RAM) two concurrent downloads of `readFile`-buffered
  // responses would OOM the web process. `fileToWebStream` hands the bytes
  // to the platform fetch implementation as a chunked stream so memory stays
  // bounded regardless of file size. The Node-vs-WHATWG `ReadableStream`
  // type bridge lives in that helper so this route doesn't repeat the cast.
  const fileStat = await stat(rendered.outputPath);
  const shouldDownload = c.req.query('download') === '1';
  const filename = getRenderedVideoFilename(asset.id, asset.version, variant);

  return new Response(fileToWebStream(rendered.outputPath), {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(fileStat.size),
      'Content-Disposition': `${shouldDownload ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Remotion-Cache': rendered.cached ? 'hit' : 'miss',
      'X-Narration-Cache': narrationCache,
    },
  });
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
  const id = c.req.param('id');
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
    process.cwd(),
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
  action: 'approved' | 'rejected' | 'edited' | 'regenerated';
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
  const id = c.req.param('id');

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
  const id = c.req.param('id');

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
  const id = c.req.param('id');
  const rawBody: unknown = await c.req.json();
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
});

assetApiRoutes.post('/:id/regenerate', async (c) => {
  const id = c.req.param('id');
  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const bodyParse = regenerateAssetSchema.safeParse(rawBody);
  const body = bodyParse.success ? bodyParse.data : { instructions: undefined };

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
  await database
    .update(assets)
    .set({
      status: 'queued',
      version: asset.version + 1,
      ...(body.instructions !== undefined
        ? { revisionInstructions: body.instructions }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(assets.id, id));

  // Trigger the parent workflow task. It reads every queued asset
  // on the project (which is now just this one, because the other
  // project assets are all in terminal states) and dispatches it to
  // the correct child task.
  await triggerWorkflowGeneration(asset.projectId);

  // Phase 7: feedback event log. A regeneration is a signal — even
  // without an edit text — that the user wasn't happy with the prior
  // version. The aggregator can correlate regeneration rate with
  // asset type / category to surface "this kind of asset gets
  // regenerated a lot."
  await writeFeedbackEvent({
    assetId: asset.id,
    action: 'regenerated',
    editText: null,
  });

  return c.json({ id: asset.id, status: 'queued', version: asset.version + 1 });
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
  const id = c.req.param('id');
  const idParse = z.string().uuid().safeParse(id);
  if (!idParse.success) {
    return c.json({ error: 'Asset id must be a valid UUID' }, 400);
  }

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
    where: eq(assets.id, idParse.data),
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
    assetId: idParse.data,
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
