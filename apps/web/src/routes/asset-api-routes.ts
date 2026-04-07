import { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
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
import { assetGenerationJobQueue } from '../lib/job-queue-clients.js';
import {
  getRenderedVideoFilename,
  renderLaunchVideoAsset,
} from '../lib/remotion-render.js';
import {
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

  const metadata = (asset.metadata as Record<string, unknown> | null) || null;
  const remotionProps = metadata?.remotionProps;

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
      (voiceoverAsset.metadata as Record<string, unknown> | null) || null,
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
  // responses would OOM the web process. `createReadStream` + `Readable.toWeb`
  // hands the bytes to the platform fetch implementation as a chunked stream
  // so memory stays bounded regardless of file size.
  const fileStat = await stat(rendered.outputPath);
  const nodeStream = createReadStream(rendered.outputPath);
  const webStream = Readable.toWeb(nodeStream) as NodeReadableStream<Uint8Array>;
  const shouldDownload = c.req.query('download') === '1';
  const filename = getRenderedVideoFilename(asset.id, asset.version, variant);

  return new Response(webStream as unknown as ReadableStream<Uint8Array>, {
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

  return c.json({ id: updated.id, userApproved: false });
});

// ── PUT /api/assets/:id/content — Edit asset content ──

assetApiRoutes.put('/:id/content', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  if (!body.content || typeof body.content !== 'string') {
    return c.json({ error: 'Content is required and must be a string' }, 400);
  }

  const [updated] = await database
    .update(assets)
    .set({
      userEdited: true,
      userEditedContent: body.content,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  return c.json({ id: updated.id, userEdited: true });
});

// ── POST /api/assets/:id/regenerate — Regenerate an asset ──

assetApiRoutes.post('/:id/regenerate', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

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

  // Update asset status
  await database
    .update(assets)
    .set({
      status: 'regenerating',
      version: asset.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, id));

  // Enqueue regeneration job
  const jobName = `generate-${asset.type.replace(/_/g, '-')}`;
  await assetGenerationJobQueue.add(jobName, {
    projectId: asset.projectId,
    assetId: asset.id,
    assetType: asset.type,
    generationInstructions:
      body.instructions || 'Regenerate with improvements based on previous feedback',
    repoName: project.repoName,
    repoAnalysis: project.repoAnalysis,
    research: project.research,
    strategy: project.strategy,
    pastInsights: [],
    revisionInstructions: body.instructions,
  }, {
    jobId: `manual__${asset.projectId}__${asset.id}__${asset.version + 1}`,
  });

  return c.json({ id: asset.id, status: 'regenerating', version: asset.version + 1 });
});

export default assetApiRoutes;
