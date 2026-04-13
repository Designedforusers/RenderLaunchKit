import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { assets, composeMinioEndpoint } from '@launchkit/shared';
import { createObjectStorageClient } from '@launchkit/asset-generators';
import {
  createRemotionRenderer,
  type RemotionRenderer,
} from '@launchkit/video/renderer';
import { database as db } from './lib/database.js';
import { env } from './env.js';
import {
  RenderRemotionVideoInputSchema,
} from './tasks/input-schemas.js';
import {
  parseCompositionInput,
  isRecord,
  readRenderedVideoSizeBytes,
} from './tasks/render-remotion-video.js';

/**
 * Standalone HTTP server for Remotion video rendering.
 *
 * Deployed as a Docker-based web service (`launchkit-renderer`) with
 * Chrome system libraries installed in the Dockerfile. The Render
 * Workflows service cannot install system packages (read-only FS in
 * beta), so this dedicated service handles the one task that needs
 * headless Chrome while the 6 generation tasks stay on Workflows.
 *
 * The web service's `triggerRemotionRender` helper calls
 * `POST /render` on this service instead of the Workflows SDK.
 * Same logic, same Remotion renderer, same MinIO upload — just
 * HTTP instead of the Workflows task protocol.
 */

const app = new Hono();

// ── Singleton renderer (browser pool + webpack bundle cache) ──

let renderer: RemotionRenderer | null = null;

function getRenderer(): RemotionRenderer {
  renderer ??= createRemotionRenderer({
    cacheDir: '/tmp/remotion-renders',
    concurrency: env.REMOTION_CONCURRENCY,
  });
  return renderer;
}

// ── Health check ──

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'launchkit-renderer' })
);

// ── POST /render ──

const RenderRequestSchema = RenderRemotionVideoInputSchema;

app.post('/render', async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parse = RenderRequestSchema.safeParse(rawBody);
  if (!parse.success) {
    return c.json(
      { error: 'Invalid request', issues: parse.error.issues },
      400
    );
  }
  const parsed = parse.data;

  // Cache-hit check (visual variant only)
  const [existing] = await db
    .select({
      renderedVideoUrl: assets.renderedVideoUrl,
      renderedVideoKey: assets.renderedVideoKey,
      version: assets.version,
      metadata: assets.metadata,
    })
    .from(assets)
    .where(eq(assets.id, parsed.assetId));

  if (!existing) {
    return c.json({ error: `Asset ${parsed.assetId} not found` }, 404);
  }

  const cacheIsStale = existing.version !== parsed.version;

  if (
    parsed.variant === 'visual' &&
    !cacheIsStale &&
    existing.renderedVideoUrl !== null &&
    existing.renderedVideoKey !== null
  ) {
    const cachedSizeBytes = readRenderedVideoSizeBytes(existing.metadata);
    return c.json({
      url: existing.renderedVideoUrl,
      key: existing.renderedVideoKey,
      cached: true,
      sizeBytes: cachedSizeBytes,
    });
  }

  // Render
  const compositionInput = parseCompositionInput(
    parsed.compositionId,
    parsed.inputProps
  );

  const r = getRenderer();
  const { outputPath } = await r.render({
    ...compositionInput,
    assetId: parsed.assetId,
    version: parsed.version,
    variant: parsed.variant,
    ...(parsed.cacheSeed !== undefined
      ? { cacheSeed: parsed.cacheSeed }
      : {}),
  });

  // Upload to MinIO
  const endpoint = composeMinioEndpoint(env.MINIO_ENDPOINT_HOST);
  if (
    endpoint === null ||
    env.MINIO_ROOT_USER === undefined ||
    env.MINIO_ROOT_PASSWORD === undefined
  ) {
    return c.json(
      { error: 'MinIO config missing — set MINIO_ENDPOINT_HOST, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD' },
      503
    );
  }

  const storage = createObjectStorageClient({
    endpoint,
    bucket: env.MINIO_BUCKET,
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD,
  });

  const basename = path.basename(outputPath);
  const key = `videos/${parsed.assetId}-v${String(parsed.version)}-${parsed.variant}-${basename}`;
  const bytes = await readFile(outputPath);
  const uploaded = await storage.uploadVideo(key, bytes, 'video/mp4');

  // Persist cache (visual only)
  if (parsed.variant === 'visual') {
    const existingMetadata = isRecord(existing.metadata)
      ? existing.metadata
      : {};
    await db
      .update(assets)
      .set({
        renderedVideoUrl: uploaded.url,
        renderedVideoKey: uploaded.key,
        metadata: {
          ...existingMetadata,
          renderedVideoSizeBytes: uploaded.sizeBytes,
        },
        updatedAt: new Date(),
      })
      .where(eq(assets.id, parsed.assetId));
  }

  return c.json({
    url: uploaded.url,
    key: uploaded.key,
    cached: false,
    sizeBytes: uploaded.sizeBytes,
  });
});

// ── Start ──

const port = Number(process.env['PORT'] ?? 10000);

console.log(`
╔══════════════════════════════════════════╗
║  LaunchKit Renderer Service             ║
║  Port: ${String(port).padEnd(33)}║
║  Env: ${env.NODE_ENV.padEnd(34)}║
╚══════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port });
