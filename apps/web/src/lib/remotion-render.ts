import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import type { WebpackOverrideFn } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type {
  LaunchKitVideoProps,
  PodcastWaveformProps,
  VoiceCommercialProps,
} from '@launchkit/video';
import { env } from '../env.js';

const REMOTION_ENTRY = path.resolve(
  process.cwd(),
  'packages/video/src/remotion.ts'
);
const REMOTION_ROOT_DIR = path.resolve(process.cwd(), 'packages/video');
const REMOTION_CACHE_DIR = path.resolve(
  process.cwd(),
  '.cache/remotion-renders'
);

/**
 * Discriminated union of every Remotion composition the renderer
 * knows about. The composition id narrows `inputProps` to the
 * matching props type, so callers cannot accidentally feed voice
 * commercial props to the product video composition (or vice versa)
 * without TypeScript catching it at the call site.
 */
export type RemotionRenderInput =
  | {
      compositionId: 'LaunchKitProductVideo';
      inputProps: LaunchKitVideoProps;
    }
  | {
      compositionId: 'LaunchKitVoiceCommercial';
      inputProps: VoiceCommercialProps;
    }
  | {
      compositionId: 'LaunchKitPodcastWaveform';
      inputProps: PodcastWaveformProps;
    };

export type RemotionCompositionId = RemotionRenderInput['compositionId'];

let bundlePromise: Promise<string> | null = null;
const renderJobs = new Map<string, Promise<string>>();

const webpackOverride: WebpackOverrideFn = (config) => {
  return {
    ...config,
    resolve: {
      ...config.resolve,
      extensionAlias: {
        ...config.resolve?.extensionAlias,
        '.js': ['.ts', '.tsx', '.js'],
        '.mjs': ['.mts', '.mjs'],
        '.cjs': ['.cts', '.cjs'],
      },
    },
  };
};

/**
 * Lazily build (and memoize) the Remotion bundle on first render.
 *
 * If the bundle promise rejects, the cached promise is cleared so the
 * next render attempt can retry. Without this, a single transient failure
 * (webpack hiccup, missing dep, full disk) would brick every subsequent
 * render until the process restarts — and the failure mode is silent
 * because the rejected promise just keeps rethrowing the original error.
 */
async function getBundle(): Promise<string> {
  bundlePromise ??= bundle({
    entryPoint: REMOTION_ENTRY,
    rootDir: REMOTION_ROOT_DIR,
    enableCaching: true,
    webpackOverride,
  }).catch((err: unknown) => {
    bundlePromise = null;
    throw err instanceof Error ? err : new Error(String(err));
  });

  return bundlePromise;
}

function buildRenderBasename(input: {
  assetId: string;
  version: number;
  variant: 'visual' | 'narrated';
  compositionId: RemotionCompositionId;
  cacheSeed?: string;
}): string {
  const suffix = input.cacheSeed
    ? `-${createHash('sha1').update(input.cacheSeed).digest('hex').slice(0, 12)}`
    : '';

  // The product video composition predates Phase 4 and its cache
  // filenames are stable, so we keep the legacy layout for it. New
  // compositions embed the composition id in the basename so renders
  // for the same asset id never collide across compositions.
  if (input.compositionId === 'LaunchKitProductVideo') {
    return `${input.assetId}-v${input.version}-${input.variant}${suffix}`;
  }

  return `${input.assetId}-${input.compositionId}-v${input.version}-${input.variant}${suffix}`;
}

function buildOutputLocation(basename: string): string {
  return path.join(REMOTION_CACHE_DIR, `${basename}.mp4`);
}

export function getRenderedVideoFilename(
  assetId: string,
  version: number,
  variant: 'visual' | 'narrated' = 'visual'
): string {
  return `launchkit-${assetId}-v${version}${variant === 'narrated' ? '-narrated' : ''}.mp4`;
}

export async function renderLaunchVideoAsset(input: {
  assetId: string;
  version: number;
  inputProps: LaunchKitVideoProps;
  variant?: 'visual' | 'narrated';
  cacheSeed?: string;
}): Promise<{ outputPath: string; cached: boolean }> {
  return renderRemotionComposition({
    assetId: input.assetId,
    version: input.version,
    compositionId: 'LaunchKitProductVideo',
    inputProps: input.inputProps,
    ...(input.variant !== undefined ? { variant: input.variant } : {}),
    ...(input.cacheSeed !== undefined ? { cacheSeed: input.cacheSeed } : {}),
  });
}

/**
 * Render any registered Remotion composition. The
 * `compositionId` discriminates the `inputProps` type so callers
 * cannot pass the wrong props shape for a given composition.
 *
 * The two new Phase 4 compositions (`LaunchKitVoiceCommercial`,
 * `LaunchKitPodcastWaveform`) default to the `'visual'` variant —
 * the `'narrated'` variant is product-video specific and only
 * `renderLaunchVideoAsset` exposes it as a parameter.
 */
export async function renderRemotionComposition(
  input: RemotionRenderInput & {
    assetId: string;
    version: number;
    variant?: 'visual' | 'narrated';
    cacheSeed?: string;
  }
): Promise<{ outputPath: string; cached: boolean }> {
  const basename = buildRenderBasename({
    assetId: input.assetId,
    version: input.version,
    variant: input.variant ?? 'visual',
    compositionId: input.compositionId,
    ...(input.cacheSeed !== undefined ? { cacheSeed: input.cacheSeed } : {}),
  });
  const outputPath = buildOutputLocation(basename);

  if (existsSync(outputPath)) {
    return { outputPath, cached: true };
  }

  const inFlight = renderJobs.get(outputPath);
  if (inFlight) {
    await inFlight;
    return { outputPath, cached: true };
  }

  const renderPromise = (async () => {
    await mkdir(REMOTION_CACHE_DIR, { recursive: true });

    const tempPath = path.join(
      REMOTION_CACHE_DIR,
      `${basename}.${Date.now()}.tmp.mp4`
    );

    try {
      const serveUrl = await getBundle();
      const composition = await selectComposition({
        serveUrl,
        id: input.compositionId,
        inputProps: input.inputProps,
        logLevel: 'error',
      });

      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: tempPath,
        inputProps: input.inputProps,
        concurrency: env.REMOTION_CONCURRENCY,
        timeoutInMilliseconds: 120000,
        overwrite: true,
        logLevel: 'error',
      });

      await rename(tempPath, outputPath);
      return outputPath;
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  })();

  renderJobs.set(outputPath, renderPromise);

  try {
    const completedPath = await renderPromise;
    return { outputPath: completedPath, cached: false };
  } finally {
    renderJobs.delete(outputPath);
  }
}
