import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import type { WebpackOverrideFn } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { LaunchKitVideoProps } from '@launchkit/video';

const REMOTION_ENTRY = path.resolve(
  process.cwd(),
  'packages/video/src/remotion.ts'
);
const REMOTION_ROOT_DIR = path.resolve(process.cwd(), 'packages/video');
const REMOTION_CACHE_DIR = path.resolve(
  process.cwd(),
  '.cache/remotion-renders'
);
const REMOTION_COMPOSITION_ID = 'LaunchKitProductVideo';

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
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: REMOTION_ENTRY,
      rootDir: REMOTION_ROOT_DIR,
      enableCaching: true,
      webpackOverride,
    }).catch((err) => {
      bundlePromise = null;
      throw err;
    });
  }

  return bundlePromise;
}

function buildRenderBasename(input: {
  assetId: string;
  version: number;
  variant: 'visual' | 'narrated';
  cacheSeed?: string;
}): string {
  const suffix = input.cacheSeed
    ? `-${createHash('sha1').update(input.cacheSeed).digest('hex').slice(0, 12)}`
    : '';

  return `${input.assetId}-v${input.version}-${input.variant}${suffix}`;
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
  const basename = buildRenderBasename({
    assetId: input.assetId,
    version: input.version,
    variant: input.variant || 'visual',
    cacheSeed: input.cacheSeed,
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
        id: REMOTION_COMPOSITION_ID,
        inputProps: input.inputProps,
        logLevel: 'error',
      });

      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: tempPath,
        inputProps: input.inputProps,
        concurrency: process.env.REMOTION_CONCURRENCY || '50%',
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
