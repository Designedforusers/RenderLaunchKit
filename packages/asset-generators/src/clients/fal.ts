import { fal } from '@fal-ai/client';
import {
  FluxImageResponseSchema,
  KlingVideoResponseSchema,
} from './schemas/fal.js';

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

export interface FalImageOptions {
  aspectRatio?: string;
  style?: string;
}

export interface FalVideoOptions {
  imageUrl?: string;
  duration?: number;
  generateAudio?: boolean;
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

    const result = await fal.subscribe('fal-ai/flux-pro/v1.1-ultra', {
      input: {
        prompt: options?.style ? `${prompt}. Style: ${options.style}` : prompt,
        aspect_ratio: options?.aspectRatio ?? '16:9',
        output_format: 'png',
        safety_tolerance: '5',
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log(`[fal.ai] Image generation in progress...`);
        }
      },
    });

    // Validate the fal.ai response shape rather than blind-asserting it
    // with `(result.data as any)?.images?.[0]?.url`. If the upstream API
    // shape changes, the parser fails fast with a structured error
    // naming the missing field instead of returning a confusing
    // `undefined` from the chained optional access.
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
    const imageUrl = firstImage.url;

    return { url: imageUrl, prompt };
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

    const endpoint = options?.imageUrl
      ? 'fal-ai/kling-video/v2/standard/image-to-video'
      : 'fal-ai/kling-video/v2/standard/text-to-video';

    const result = await fal.subscribe(endpoint, {
      input: {
        prompt,
        ...(options?.imageUrl ? { image_url: options.imageUrl } : {}),
        duration: String(options?.duration ?? 5),
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log(`[fal.ai] Video generation in progress...`);
        }
      },
    });

    // Same boundary-validation discipline as the image path above.
    const parsed = KlingVideoResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new Error(
        `fal.ai Kling response did not match expected shape: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`
      );
    }
    const videoUrl = parsed.data.video.url;

    return { url: videoUrl, prompt, duration: options?.duration ?? 5 };
  }

  return {
    isConfigured,
    generateImage,
    generateVideo,
  };
}
