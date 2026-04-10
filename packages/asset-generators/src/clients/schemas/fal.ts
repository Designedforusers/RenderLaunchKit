import { z } from 'zod';

/**
 * Zod schemas for the fal.ai API responses we consume in
 * `./clients/fal.ts`.
 *
 * The fal SDK's `fal.subscribe` returns a `result` object whose
 * `data` field shape varies per model. Each model has its own
 * documented schema; we encode just the fields we read here. If fal
 * changes the response shape, the parser fails fast with a structured
 * error instead of silently producing `undefined` from a chained
 * optional access.
 */

// ── FLUX.2 Pro image generation ─────────────────────────────────────
//
// Endpoint: fal-ai/flux-pro/v1.1-ultra
// Response: { images: [{ url, content_type, width, height, ... }] }

export const FluxImageSchema = z
  .object({
    url: z.string(),
  })
  .passthrough();

export const FluxImageResponseSchema = z
  .object({
    images: z.array(FluxImageSchema).min(1),
  })
  .passthrough();
export type FluxImageResponse = z.infer<typeof FluxImageResponseSchema>;

// ── Kling v3 video generation ───────────────────────────────────────
//
// Endpoint: fal-ai/kling-video/v3/standard/text-to-video
//        or fal-ai/kling-video/v3/standard/image-to-video
// Response: { video: { url, content_type, ... } }

export const KlingVideoFileSchema = z
  .object({
    url: z.string(),
  })
  .passthrough();

export const KlingVideoResponseSchema = z
  .object({
    video: KlingVideoFileSchema,
  })
  .passthrough();
export type KlingVideoResponse = z.infer<typeof KlingVideoResponseSchema>;

// ── Seedance 2.0 video generation ──────────────────────────────────
//
// Endpoint: bytedance/seedance-2.0/fast/text-to-video
//        or bytedance/seedance-2.0/fast/image-to-video
// Response: { video: { url, content_type, ... }, seed: number }

export const SeedanceVideoResponseSchema = z
  .object({
    video: KlingVideoFileSchema,
    seed: z.number().int(),
  })
  .passthrough();
export type SeedanceVideoResponse = z.infer<typeof SeedanceVideoResponseSchema>;

// ── Nano Banana Pro (Gemini 3 Pro Image) ───────────────────────────
//
// Endpoint: fal-ai/nano-banana-pro
// Response: { images: [{ url, ... }], description: string }

export const NanoBananaImageSchema = z
  .object({
    url: z.string(),
  })
  .passthrough();

export const NanoBananaResponseSchema = z
  .object({
    images: z.array(NanoBananaImageSchema).min(1),
    description: z.string(),
  })
  .passthrough();
export type NanoBananaResponse = z.infer<typeof NanoBananaResponseSchema>;
