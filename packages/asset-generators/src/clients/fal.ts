import { fal } from '@fal-ai/client';
import {
  computeFalImageCostCents,
  computeFalVideoCostCents,
} from '@launchkit/shared';
import { recordCost } from '../cost-tracker.js';
import {
  FluxImageResponseSchema,
  NanoBananaResponseSchema,
  KlingVideoResponseSchema,
  SeedanceVideoResponseSchema,
} from './schemas/fal.js';
import {
  enhanceImagePrompt,
  enhanceVideoPrompt,
} from '../lib/prompt-enhancer.js';

/**
 * Factory-constructed fal.ai media client. The consumer app (worker,
 * workflows, …) builds one of these at startup with its own API key
 * and passes the returned object to `createAssetGenerators({ fal })`.
 *
 * When `apiKey` is `null`, the client is intentionally left in an
 * unconfigured state: `isConfigured` returns `false`, `generateImage`
 * returns a placeholder URL, and `generateVideo` returns an empty
 * string (legacy behavior the product-video agent depends on via its
 * `if (fal.isConfigured)` branch). The factory never throws on a
 * missing key — the degraded-but-working path is the same as it was
 * when the worker hosted this code directly.
 */

export interface FalMediaClientConfig {
  /** fal.ai API key, or `null` to run the client in placeholder mode. */
  apiKey: string | null;
}

export interface FalImageResult {
  url: string;
  prompt: string;
}

export interface FalVideoResult {
  url: string;
  prompt: string;
  duration: number;
}

export type FalImageModel = 'flux-pro-ultra' | 'nano-banana-pro';

export interface FalImageOptions {
  aspectRatio?: string;
  style?: string;
  /** Which image model to use. Defaults to `'flux-pro-ultra'`. */
  model?: FalImageModel;
  /** Run the model-specific prompt enhancer. Defaults to `true`. */
  enhance?: boolean;
}

export type FalVideoModel = 'kling-v3' | 'seedance-2';

export interface FalVideoOptions {
  imageUrl?: string;
  duration?: number;
  generateAudio?: boolean;
  /** Which video model to use. Defaults to `'kling-v3'`. */
  model?: FalVideoModel;
  /** Run the model-specific prompt enhancer. Defaults to `true`. */
  enhance?: boolean;
}

export interface FalMediaClient {
  /**
   * `true` when the client was constructed with a real API key. Agents
   * branching on whether to call the upstream (e.g. the product-video
   * agent skipping the Kling render in local dev) read this flag
   * instead of poking at env vars directly.
   */
  readonly isConfigured: boolean;

  generateImage(
    prompt: string,
    options?: FalImageOptions
  ): Promise<FalImageResult>;

  generateVideo(
    prompt: string,
    options?: FalVideoOptions
  ): Promise<FalVideoResult>;
}

export function createFalMediaClient(
  config: FalMediaClientConfig
): FalMediaClient {
  const { apiKey } = config;
  const isConfigured = apiKey !== null && apiKey !== '';

  // The fal SDK exposes a single module-level configuration surface
  // (`fal.config`) that the whole process shares. Calling it here with
  // the consumer's key is consistent with the previous worker-hosted
  // behavior (`if (env.FAL_API_KEY) fal.config(...)` at module init).
  // Consumers that construct multiple fal clients in the same process
  // will clobber each other — we do not do that today and this file
  // documents the constraint.
  if (isConfigured && apiKey !== null) {
    fal.config({ credentials: apiKey });
  }

  async function generateImage(
    prompt: string,
    options?: FalImageOptions
  ): Promise<FalImageResult> {
    if (!isConfigured) {
      console.warn('[fal.ai] No API key configured, returning placeholder');
      return {
        url: `https://placehold.co/1200x630/1e293b/10b981?text=${encodeURIComponent('LaunchKit')}`,
        prompt,
      };
    }

    const model: FalImageModel = options?.model ?? 'flux-pro-ultra';

    if (model === 'nano-banana-pro') {
      return generateNanoBananaImage(prompt, options);
    }
    return generateFluxImage(prompt, options);
  }

  async function generateFluxImage(
    prompt: string,
    options?: FalImageOptions
  ): Promise<FalImageResult> {
    const enhanced = options?.enhance === false
      ? (options?.style ? `${prompt}. Style: ${options.style}` : prompt)
      : enhanceImagePrompt(prompt, 'flux-pro-ultra', {
          ...(options?.style !== undefined ? { style: options.style } : {}),
          ...(options?.aspectRatio !== undefined ? { aspectRatio: options.aspectRatio } : {}),
        });

    const result = await fal.subscribe('fal-ai/flux-pro/v1.1-ultra', {
      input: {
        prompt: enhanced,
        aspect_ratio: options?.aspectRatio ?? '16:9',
        output_format: 'png',
        safety_tolerance: '5',
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log(`[fal.ai] FLUX image generation in progress...`);
        }
      },
    });

    const parsed = FluxImageResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new Error(
        `fal.ai FLUX response did not match expected shape: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`
      );
    }
    const firstImage = parsed.data.images[0];
    if (!firstImage) {
      throw new Error('fal.ai FLUX response contained no images');
    }

    recordCost({
      provider: 'fal',
      operation: 'flux-pro-ultra-image',
      costCents: computeFalImageCostCents('flux-pro-ultra-image'),
      metadata: {
        ...(options?.aspectRatio !== undefined
          ? { aspectRatio: options.aspectRatio }
          : {}),
        ...(options?.style !== undefined ? { style: options.style } : {}),
      },
    });

    return { url: firstImage.url, prompt };
  }

  async function generateNanoBananaImage(
    prompt: string,
    options?: FalImageOptions
  ): Promise<FalImageResult> {
    // Nano Banana Pro supports: auto, 21:9, 16:9, 3:2, 4:3, 5:4,
    // 1:1, 4:5, 3:4, 2:3, 9:16. The SDK types the field as a strict
    // union; we narrow the dynamic string via the `satisfies` pattern.
    const aspectRatio = (options?.aspectRatio ?? '16:9') as
      | '16:9' | '1:1' | '9:16' | '4:3' | '3:4' | '21:9' | '3:2' | '2:3' | '5:4' | '4:5';

    const enhanced = options?.enhance === false
      ? (options?.style ? `${prompt}. Style: ${options.style}` : prompt)
      : enhanceImagePrompt(prompt, 'nano-banana-pro', {
          ...(options?.style !== undefined ? { style: options.style } : {}),
          ...(options?.aspectRatio !== undefined ? { aspectRatio: options.aspectRatio } : {}),
        });

    const result = await fal.subscribe('fal-ai/nano-banana-pro', {
      input: {
        prompt: enhanced,
        aspect_ratio: aspectRatio,
        output_format: 'png' as const,
        resolution: '1K' as const,
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log(`[fal.ai] Nano Banana Pro image generation in progress...`);
        }
      },
    });

    const parsed = NanoBananaResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new Error(
        `fal.ai Nano Banana Pro response did not match expected shape: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`
      );
    }
    const firstImage = parsed.data.images[0];
    if (!firstImage) {
      throw new Error('fal.ai Nano Banana Pro response contained no images');
    }

    recordCost({
      provider: 'fal',
      operation: 'nano-banana-pro-image',
      costCents: computeFalImageCostCents('nano-banana-pro-image'),
      metadata: {
        ...(options?.aspectRatio !== undefined
          ? { aspectRatio: options.aspectRatio }
          : {}),
        ...(options?.style !== undefined ? { style: options.style } : {}),
      },
    });

    return { url: firstImage.url, prompt };
  }

  async function generateVideo(
    prompt: string,
    options?: FalVideoOptions
  ): Promise<FalVideoResult> {
    if (!isConfigured) {
      console.warn('[fal.ai] No API key configured, returning placeholder');
      return {
        url: '',
        prompt,
        duration: options?.duration ?? 5,
      };
    }

    const model: FalVideoModel = options?.model ?? 'kling-v3';
    const durationSeconds = options?.duration ?? 5;

    if (model === 'seedance-2') {
      return generateSeedanceVideo(prompt, durationSeconds, options);
    }
    return generateKlingV3Video(prompt, durationSeconds, options);
  }

  async function generateKlingV3Video(
    prompt: string,
    durationSeconds: number,
    options?: FalVideoOptions
  ): Promise<FalVideoResult> {
    const enhanced = options?.enhance === false
      ? { prompt, negativePrompt: undefined, cfgScale: undefined }
      : enhanceVideoPrompt(prompt, 'kling-v3', {
          duration: durationSeconds,
          hasImageUrl: options?.imageUrl !== undefined,
        });

    // Kling v3 uses `start_image_url` (not `image_url`) for i2v.
    const endpoint = options?.imageUrl
      ? 'fal-ai/kling-video/v3/standard/image-to-video'
      : 'fal-ai/kling-video/v3/standard/text-to-video';

    const result = await fal.subscribe(endpoint, {
      input: {
        prompt: enhanced.prompt,
        ...(options?.imageUrl
          ? { start_image_url: options.imageUrl }
          : {}),
        duration: String(durationSeconds),
        ...(enhanced.negativePrompt !== undefined
          ? { negative_prompt: enhanced.negativePrompt }
          : {}),
        ...(enhanced.cfgScale !== undefined
          ? { cfg_scale: enhanced.cfgScale }
          : {}),
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log(`[fal.ai] Kling v3 video generation in progress...`);
        }
      },
    });

    const parsed = KlingVideoResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new Error(
        `fal.ai Kling v3 response did not match expected shape: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`
      );
    }

    const pricingKey = 'kling-v3-standard-per-second';
    recordCost({
      provider: 'fal',
      operation: 'kling-v3-standard',
      outputUnits: durationSeconds,
      costCents: computeFalVideoCostCents(pricingKey, durationSeconds),
      metadata: {
        endpoint,
        hasImageUrl: options?.imageUrl !== undefined,
      },
    });

    return { url: parsed.data.video.url, prompt, duration: durationSeconds };
  }

  async function generateSeedanceVideo(
    prompt: string,
    durationSeconds: number,
    options?: FalVideoOptions
  ): Promise<FalVideoResult> {
    const enhanced = options?.enhance === false
      ? { prompt }
      : enhanceVideoPrompt(prompt, 'seedance-2', {
          duration: durationSeconds,
          hasImageUrl: options?.imageUrl !== undefined,
        });

    const endpoint = options?.imageUrl
      ? 'bytedance/seedance-2.0/fast/image-to-video'
      : 'bytedance/seedance-2.0/fast/text-to-video';

    const result = await fal.subscribe(endpoint, {
      input: {
        prompt: enhanced.prompt,
        ...(options?.imageUrl ? { image_url: options.imageUrl } : {}),
        duration: String(durationSeconds),
        aspect_ratio: '16:9',
        resolution: '720p',
        generate_audio: options?.generateAudio ?? false,
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log(`[fal.ai] Seedance 2.0 video generation in progress...`);
        }
      },
    });

    const parsed = SeedanceVideoResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new Error(
        `fal.ai Seedance 2.0 response did not match expected shape: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`
      );
    }

    const pricingKey = 'seedance-2-fast-per-second';
    recordCost({
      provider: 'fal',
      operation: 'seedance-2-fast',
      outputUnits: durationSeconds,
      costCents: computeFalVideoCostCents(pricingKey, durationSeconds),
      metadata: {
        endpoint,
        seed: parsed.data.seed,
        hasImageUrl: options?.imageUrl !== undefined,
      },
    });

    return { url: parsed.data.video.url, prompt, duration: durationSeconds };
  }

  return {
    isConfigured,
    generateImage,
    generateVideo,
  };
}
