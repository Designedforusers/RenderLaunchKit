import { z } from 'zod';
import type {
  LaunchKitVideoProps,
  PodcastWaveformProps,
  VerticalVideoProps,
  VoiceCommercialProps,
} from '@launchkit/video';
import { env } from '../env.js';

/**
 * Triggers a Remotion video render on the dedicated renderer service
 * (`launchkit-renderer`) via HTTP POST. The renderer is a Docker-based
 * web service with Chrome system libraries installed — the Render
 * Workflows service cannot install them (read-only filesystem in beta).
 *
 * The renderer exposes a single POST /render endpoint that accepts the
 * same input shape as the old Workflows task, runs Remotion's
 * `renderMedia`, uploads the MP4 to MinIO, and returns the public URL.
 *
 * This helper blocks until the render completes (typically 30-120s for
 * a 15-30 second video) and returns the typed result. The web route
 * then 302-redirects the browser to the MinIO URL.
 *
 * Environment: `RENDERER_SERVICE_URL` must be set to the renderer
 * service's internal URL (e.g. `https://launchkit-renderer.onrender.com`
 * or `http://localhost:10000` for local dev).
 */

const RenderResultSchema = z.object({
  url: z.string().url(),
  key: z.string().min(1),
  cached: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
});

type TriggerRemotionRenderInputProps =
  | { compositionId: 'LaunchKitProductVideo'; inputProps: LaunchKitVideoProps }
  | {
      compositionId: 'LaunchKitVoiceCommercial';
      inputProps: VoiceCommercialProps;
    }
  | {
      compositionId: 'LaunchKitPodcastWaveform';
      inputProps: PodcastWaveformProps;
    }
  | {
      compositionId: 'LaunchKitVerticalVideo';
      inputProps: VerticalVideoProps;
    };

export type TriggerRemotionRenderInput = {
  assetId: string;
  version: number;
  variant?: 'visual' | 'narrated';
  cacheSeed?: string;
} & TriggerRemotionRenderInputProps;

export interface TriggerRemotionRenderResult {
  url: string;
  key: string;
  cached: boolean;
  sizeBytes: number;
  taskRunId: string;
}

export async function triggerRemotionRender(
  input: TriggerRemotionRenderInput
): Promise<TriggerRemotionRenderResult> {
  const rendererUrl = env.RENDERER_SERVICE_URL;
  if (rendererUrl === undefined || rendererUrl === '') {
    throw new Error(
      'triggerRemotionRender: RENDERER_SERVICE_URL is required — set it to the launchkit-renderer service URL'
    );
  }

  const body = {
    assetId: input.assetId,
    version: input.version,
    compositionId: input.compositionId,
    inputProps: input.inputProps,
    variant: input.variant ?? 'visual',
    ...(input.cacheSeed !== undefined ? { cacheSeed: input.cacheSeed } : {}),
  };

  // The render can take 30-120s for a typical video. Set a generous
  // timeout that exceeds the renderer's own internal limits.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 660_000);

  try {
    const response = await fetch(`${rendererUrl}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error');
      throw new Error(
        `triggerRemotionRender: renderer returned ${String(response.status)}: ${errorBody}`
      );
    }

    const result: unknown = await response.json();
    const parsed = RenderResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error(
        `triggerRemotionRender: renderer returned malformed result: ${parsed.error.message}`
      );
    }

    return {
      url: parsed.data.url,
      key: parsed.data.key,
      cached: parsed.data.cached,
      sizeBytes: parsed.data.sizeBytes,
      taskRunId: 'http-render',
    };
  } finally {
    clearTimeout(timeout);
  }
}
