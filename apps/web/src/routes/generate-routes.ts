import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  CostTracker,
  runWithCostTracker,
  enhanceImagePrompt,
  enhanceVideoPrompt,
} from '@launchkit/asset-generators';
import { fileToWebStream } from '../lib/stream-utils.js';
import {
  getFalClient,
  getElevenLabsClient,
  getWorldLabsClient,
} from '../lib/generation-clients.js';

/**
 * Direct generation endpoints — user writes the prompt, provider
 * generates. No Claude in the loop. Mounted at `/api/generate`.
 *
 * Cost tracking: each endpoint wraps the provider call in a
 * `CostTracker` and returns `costCents` in the response. Costs are
 * display-only — NOT persisted to `asset_cost_events` because there
 * is no asset row to attach to. A future `direct_generation_cost_events`
 * table can be added when usage analytics are needed.
 */

export const generateRoutes = new Hono();

// ── Helpers ────────────────────────────────────────────────────────

function serviceUnavailable(err: unknown) {
  const message =
    err instanceof Error ? err.message : 'Service not configured';
  return { error: message };
}

// ── POST /api/generate/image ───────────────────────────────────────

const GenerateImageSchema = z.object({
  prompt: z.string().min(1),
  model: z
    .enum(['flux-pro-ultra', 'nano-banana-pro'])
    .default('flux-pro-ultra'),
  aspectRatio: z
    .enum([
      '16:9', '1:1', '9:16', '4:3', '3:4',
      '21:9', '3:2', '2:3', '5:4', '4:5',
    ])
    .default('16:9'),
  style: z.string().optional(),
  enhance: z.boolean().default(true),
});

generateRoutes.post('/image', async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parse = GenerateImageSchema.safeParse(rawBody);
  if (!parse.success) {
    return c.json(
      { error: 'Invalid request', issues: parse.error.issues },
      400
    );
  }
  const { prompt, model, aspectRatio, style, enhance } = parse.data;

  let fal;
  try {
    fal = getFalClient();
  } catch (err) {
    return c.json(serviceUnavailable(err), 503);
  }

  const tracker = new CostTracker();

  const enhancedPrompt = enhance
    ? enhanceImagePrompt(prompt, model, {
        ...(style !== undefined ? { style } : {}),
        ...(aspectRatio !== undefined ? { aspectRatio } : {}),
      })
    : null;

  const result = await runWithCostTracker(tracker, () =>
    fal.generateImage(prompt, {
      model,
      aspectRatio,
      ...(style !== undefined ? { style } : {}),
      enhance,
    })
  );

  return c.json({
    url: result.url,
    prompt,
    enhancedPrompt,
    model,
    aspectRatio,
    costCents: tracker.totalCents(),
  });
});

// ── POST /api/generate/video ───────────────────────────────────────

const GenerateVideoSchema = z.object({
  prompt: z.string().min(1),
  model: z.enum(['kling-v3', 'seedance-2']).default('kling-v3'),
  duration: z.number().int().min(3).max(15).default(5),
  imageUrl: z.string().url().optional(),
  generateAudio: z.boolean().default(false),
  enhance: z.boolean().default(true),
});

generateRoutes.post('/video', async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parse = GenerateVideoSchema.safeParse(rawBody);
  if (!parse.success) {
    return c.json(
      { error: 'Invalid request', issues: parse.error.issues },
      400
    );
  }
  const { prompt, model, duration, imageUrl, generateAudio, enhance } =
    parse.data;

  let fal;
  try {
    fal = getFalClient();
  } catch (err) {
    return c.json(serviceUnavailable(err), 503);
  }

  const tracker = new CostTracker();

  const enhancedResult = enhance
    ? enhanceVideoPrompt(prompt, model, {
        ...(duration !== undefined ? { duration } : {}),
        ...(imageUrl !== undefined ? { hasImageUrl: true } : {}),
      })
    : null;

  const result = await runWithCostTracker(tracker, () =>
    fal.generateVideo(prompt, {
      model,
      duration,
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      generateAudio,
      enhance,
    })
  );

  return c.json({
    url: result.url,
    prompt,
    enhancedPrompt: enhancedResult?.prompt ?? null,
    model,
    duration: result.duration,
    costCents: tracker.totalCents(),
  });
});

// ── POST /api/generate/audio ───────────────────────────────────────

const GenerateAudioSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('single'),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal('dialogue'),
    lines: z
      .array(
        z.object({
          speaker: z.enum(['alex', 'sam']),
          text: z.string().min(1),
        })
      )
      .min(1),
  }),
]);

generateRoutes.post('/audio', async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parse = GenerateAudioSchema.safeParse(rawBody);
  if (!parse.success) {
    return c.json(
      { error: 'Invalid request', issues: parse.error.issues },
      400
    );
  }
  const body = parse.data;

  let el;
  try {
    el = getElevenLabsClient();
  } catch (err) {
    return c.json(serviceUnavailable(err), 503);
  }

  const tracker = new CostTracker();

  if (body.type === 'single') {
    const cacheKey = el.buildAudioCacheKey(`direct:single:${body.text}`);
    const result = await runWithCostTracker(tracker, () =>
      el.synthesizeSingleVoice({ cacheKey, text: body.text })
    );
    return c.json({
      audioUrl: `/api/generate/audio/files/${result.cacheKey}.mp3`,
      cacheKey: result.cacheKey,
      durationSeconds: result.durationSeconds,
      cached: result.cached,
      costCents: tracker.totalCents(),
    });
  }

  // Dialogue
  const seed = body.lines.map((l) => `${l.speaker}:${l.text}`).join('|');
  const cacheKey = el.buildAudioCacheKey(`direct:dialogue:${seed}`);
  const result = await runWithCostTracker(tracker, () =>
    el.synthesizeMultiVoiceDialogue({ cacheKey, lines: body.lines })
  );
  return c.json({
    audioUrl: `/api/generate/audio/files/${result.cacheKey}.mp3`,
    cacheKey: result.cacheKey,
    durationSeconds: result.durationSeconds,
    cached: result.cached,
    costCents: tracker.totalCents(),
  });
});

// ── GET /api/generate/audio/files/:cacheKey.mp3 ────────────────────

const CACHE_KEY_REGEX = /^[a-f0-9]{16}$/;

generateRoutes.get('/audio/files/:filename', async (c) => {
  const filename = c.req.param('filename');
  const match = /^([a-f0-9]{16})\.mp3$/.exec(filename);
  if (!match?.[1] || !CACHE_KEY_REGEX.test(match[1])) {
    return c.json({ error: 'Invalid cache key' }, 400);
  }

  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', '..'
  );
  const audioPath = path.resolve(
    repoRoot,
    '.cache/elevenlabs-rendered',
    `${match[1]}.mp3`
  );

  if (!existsSync(audioPath)) {
    return c.json({ error: 'Audio file not found' }, 404);
  }

  const fileStat = await stat(audioPath);
  const stream = fileToWebStream(audioPath);

  return new Response(stream, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(fileStat.size),
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// ── POST /api/generate/world ───────────────────────────────────────

const GenerateWorldSchema = z.object({
  prompt: z.string().min(1),
  displayName: z.string().min(1).default('Direct Generation'),
  model: z.enum(['marble-1.1', 'marble-1.1-plus']).default('marble-1.1'),
});

generateRoutes.post('/world', async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parse = GenerateWorldSchema.safeParse(rawBody);
  if (!parse.success) {
    return c.json(
      { error: 'Invalid request', issues: parse.error.issues },
      400
    );
  }
  const { prompt, displayName, model } = parse.data;

  let worldLabs;
  try {
    worldLabs = getWorldLabsClient();
  } catch (err) {
    return c.json(serviceUnavailable(err), 503);
  }

  const tracker = new CostTracker();

  const result = await runWithCostTracker(tracker, () =>
    worldLabs.generateWorldScene({
      displayName,
      worldPrompt: prompt,
      model,
    })
  );

  return c.json({
    worldId: result.worldId,
    marbleUrl: result.marbleUrl,
    thumbnailUrl: result.thumbnailUrl,
    prompt,
    model,
    costCents: tracker.totalCents(),
  });
});
