import { fal } from '@fal-ai/client';

// Configure fal.ai client
if (process.env.FAL_API_KEY) {
  fal.config({ credentials: process.env.FAL_API_KEY });
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
  if (!process.env.FAL_API_KEY) {
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
      aspect_ratio: options?.aspectRatio || '16:9',
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

  const imageUrl = (result.data as any)?.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error('No image URL returned from fal.ai');
  }

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
  if (!process.env.FAL_API_KEY) {
    console.warn('[fal.ai] No API key configured, returning placeholder');
    return {
      url: '',
      prompt,
      duration: options?.duration || 5,
    };
  }

  const endpoint = options?.imageUrl
    ? 'fal-ai/kling-video/v2/standard/image-to-video'
    : 'fal-ai/kling-video/v2/standard/text-to-video';

  const result = await fal.subscribe(endpoint, {
    input: {
      prompt,
      ...(options?.imageUrl ? { image_url: options.imageUrl } : {}),
      duration: String(options?.duration || 5),
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS') {
        console.log(`[fal.ai] Video generation in progress...`);
      }
    },
  });

  const videoUrl = (result.data as any)?.video?.url;
  if (!videoUrl) {
    throw new Error('No video URL returned from fal.ai');
  }

  return { url: videoUrl, prompt, duration: options?.duration || 5 };
}
