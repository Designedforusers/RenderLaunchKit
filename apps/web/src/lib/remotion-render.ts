import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import type { WebpackOverrideFn } from '@remotion/bundler';
import {
  ensureBrowser,
  makeCancelSignal,
  openBrowser,
  renderMedia,
  selectComposition,
} from '@remotion/renderer';
import type {
  LaunchKitVideoProps,
  PodcastWaveformProps,
  VerticalVideoProps,
  VoiceCommercialProps,
} from '@launchkit/video';
import { env } from '../env.js';

// Resolve paths relative to the monorepo root, not process.cwd().
// `tsx watch` sets cwd to `apps/web/` which breaks the
// `process.cwd()` + relative path approach. In production the
// `start:web` script also runs from `apps/web/dist/`, so the same
// issue applies. Using import.meta.url anchors paths to this file's
// location on disk regardless of cwd.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..'
);

const REMOTION_ENTRY = path.resolve(
  REPO_ROOT,
  'packages/video/src/remotion.ts'
);
const REMOTION_ROOT_DIR = path.resolve(REPO_ROOT, 'packages/video');
const REMOTION_CACHE_DIR = path.resolve(REPO_ROOT, '.cache/remotion-renders');

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
    }
  | {
      compositionId: 'LaunchKitVerticalVideo';
      inputProps: VerticalVideoProps;
    };

export type RemotionCompositionId = RemotionRenderInput['compositionId'];

let bundlePromise: Promise<string> | null = null;
const renderJobs = new Map<string, Promise<string>>();

// Reuse a single browser instance across renders to avoid the
// overhead of launching and closing Chrome for every request.
// Remotion recommends this pattern for SSR deployments.
type Browser = Awaited<ReturnType<typeof openBrowser>>;
let browserPromise: Promise<Browser> | null = null;

const CHROMIUM_OPTIONS = {
  enableMultiProcessOnLinux: true,
} as const;

/**
 * Invalidate the cached browser so the next `getBrowser()` call
 * launches a fresh one. Safe to call multiple times — a no-op if
 * the cache is already empty.
 */
function invalidateBrowser(): void {
  const stale = browserPromise;
  browserPromise = null;
  if (stale) {
    // Best-effort close on the old browser. If it's already dead
    // this throws, which we swallow — we only care that the cache
    // slot is clear so the next render rebuilds.
    stale
      .then((browser) => browser.close({ silent: true }))
      .catch(() => undefined);
  }
}

/**
 * Race a promise against a timeout. Used to fail fast when a cached
 * browser is dead — Chrome's CDP WebSocket can hang for the full
 * renderMedia `timeoutInMilliseconds` (120s) before throwing, which
 * would tie up the HTTP request for two minutes on a single crash.
 * Wrapping `selectComposition` in a 15-second race catches dead
 * browsers in seconds instead of minutes.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(ms)}ms — browser likely crashed`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function getBrowser(): Promise<Browser> {
  browserPromise ??= (async () => {
    await ensureBrowser({ logLevel: 'error' });
    const browser = await openBrowser('chrome', {
      chromiumOptions: CHROMIUM_OPTIONS,
      logLevel: 'error',
    });
    // Chrome can die unexpectedly (OOM, segfault, forced kill).
    // Listen for both close events so a dead browser doesn't sit
    // in the cache forever — the next `getBrowser()` call will
    // relaunch a fresh one. Without this, a single Chrome crash
    // would brick every subsequent render until the dyno restarts.
    browser.on('closed', () => {
      if (browserPromise) {
        browserPromise = null;
      }
    });
    browser.on('closed-silent', () => {
      if (browserPromise) {
        browserPromise = null;
      }
    });
    return browser;
  })().catch((err: unknown) => {
    browserPromise = null;
    throw err instanceof Error ? err : new Error(String(err));
  });

  return browserPromise;
}

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
  abortSignal?: AbortSignal;
}): Promise<{ outputPath: string; cached: boolean }> {
  return renderRemotionComposition({
    assetId: input.assetId,
    version: input.version,
    compositionId: 'LaunchKitProductVideo',
    inputProps: input.inputProps,
    ...(input.variant !== undefined ? { variant: input.variant } : {}),
    ...(input.cacheSeed !== undefined ? { cacheSeed: input.cacheSeed } : {}),
    ...(input.abortSignal !== undefined ? { abortSignal: input.abortSignal } : {}),
  });
}

/**
 * Render any registered Remotion composition. The
 * `compositionId` discriminates the `inputProps` type so callers
 * cannot pass the wrong props shape for a given composition.
 *
 * Reliability features following Remotion's SSR recommendations:
 * - Browser instance reused across renders via `openBrowser()`
 * - `ensureBrowser()` called before first render to pre-download Chrome
 * - `enableMultiProcessOnLinux` for faster parallel frame rendering
 * - Lazy bundle with retry-on-failure
 * - In-flight dedup prevents concurrent renders of the same output
 */
export async function renderRemotionComposition(
  input: RemotionRenderInput & {
    assetId: string;
    version: number;
    variant?: 'visual' | 'narrated';
    cacheSeed?: string;
    abortSignal?: AbortSignal;
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

    // One-shot retry on browser failures. If Chrome crashes or the
    // WebSocket connection drops, the first attempt throws something
    // like "Target closed" or "Protocol error" — we invalidate the
    // cached browser and rebuild. User errors (invalid props, missing
    // images, render timeouts) don't benefit from retry and would
    // just waste another full render cycle, so we only retry on
    // errors that look like browser connection failures.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const tempPath = path.join(
        REMOTION_CACHE_DIR,
        `${basename}.${Date.now()}.tmp.mp4`
      );

      try {
        // Bridge the standard AbortSignal (from the HTTP request) to
        // Remotion's proprietary cancel token so a client disconnect
        // stops the render immediately instead of wasting CPU.
        const remotionCancel = input.abortSignal
          ? makeCancelSignal()
          : undefined;
        if (input.abortSignal && remotionCancel) {
          if (input.abortSignal.aborted) {
            remotionCancel.cancel();
          } else {
            input.abortSignal.addEventListener(
              'abort',
              () => remotionCancel.cancel(),
              { once: true }
            );
          }
        }

        const [serveUrl, browser] = await Promise.all([
          getBundle(),
          getBrowser(),
        ]);

        // Fail fast if the browser is dead: normally selectComposition
        // takes well under a second; 15 seconds is a generous ceiling
        // that catches dead CDP connections without false-positiving
        // on a cold JIT'd bundle load.
        const composition = await withTimeout(
          selectComposition({
            serveUrl,
            id: input.compositionId,
            inputProps: input.inputProps,
            puppeteerInstance: browser,
            logLevel: 'error',
          }),
          15000,
          'selectComposition'
        );

        await renderMedia({
          composition,
          serveUrl,
          codec: 'h264',
          outputLocation: tempPath,
          inputProps: input.inputProps,
          puppeteerInstance: browser,
          concurrency: env.REMOTION_CONCURRENCY,
          timeoutInMilliseconds: 120000,
          overwrite: true,
          logLevel: 'error',
          ...(remotionCancel ? { cancelSignal: remotionCancel.cancelSignal } : {}),
        });

        await rename(tempPath, outputPath);
        return outputPath;
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        lastError = error;

        // Don't retry user-initiated cancels — the client left,
        // retrying would waste CPU on output nobody wants.
        if (input.abortSignal?.aborted) {
          throw error;
        }

        // Only retry on errors that look like browser connection
        // failures. User errors (invalid props, missing images,
        // render-level timeouts) bubble up immediately on the first
        // attempt. The "browser likely crashed" message is emitted
        // by our own `withTimeout` wrapper when CDP calls hang past
        // the 15-second ceiling — that's a dead-browser signal even
        // though it didn't throw natively.
        const message = error instanceof Error ? error.message : String(error);
        const isBrowserCrash =
          /target closed|protocol error|connection closed|browser.*disconnect|session closed|browser likely crashed/i.test(
            message
          );

        if (!isBrowserCrash || attempt >= 1) {
          throw error;
        }

        // Invalidate the dead browser so the retry rebuilds a
        // fresh one.
        invalidateBrowser();
      }
    }

    // Unreachable in practice — the loop either returns or throws —
    // but TypeScript's flow analysis needs a terminal throw.
    throw lastError instanceof Error
      ? lastError
      : new Error('Remotion render failed after retry');
  })();

  renderJobs.set(outputPath, renderPromise);

  try {
    const completedPath = await renderPromise;
    return { outputPath: completedPath, cached: false };
  } finally {
    renderJobs.delete(outputPath);
  }
}
