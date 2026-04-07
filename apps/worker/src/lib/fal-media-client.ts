import { fal } from '@fal-ai/client';
import {
  FluxImageResponseSchema,
  KlingVideoResponseSchema,
} from './schemas/fal.js';
import { env } from '../env.js';

// Configure fal.ai client
if (env.FAL_API_KEY) {
  fal.config({ credentials: env.FAL_API_KEY });
}

/**
 * Generate an image using FLUX.2 Pro via fal.ai.
 */
export async function generateImage(
  prompt: string,
  options?: {
    aspectRatio?: string;
    style?: string;
  }
): Promise<{ url: string; prompt: string }> {
  if (!env.FAL_API_KEY) {
    console.warn('[fal.ai] No API key configured, returning placeholder');
    return {
      url: `https://placehold.co/1200x630/1e293b/10b981?text=${encodeURIComponent('LaunchKit')}`,
      prompt,
    };
  }

  const result = await fal.subscribe('fal-ai/flux-pro/v1.1-ultra', {
    input: {
      prompt: options?.style
        ? `${prompt}. Style: ${options.style}`
        : prompt,
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

/**
 * Generate a video using Kling 3.0 via fal.ai.
 */
export async function generateVideo(
  prompt: string,
  options?: {
    imageUrl?: string;
    duration?: number;
    generateAudio?: boolean;
  }
): Promise<{ url: string; prompt: string; duration: number }> {
  if (!env.FAL_API_KEY) {
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
