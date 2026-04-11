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
} from '../types.js';
import { buildRenderBasename } from './filename-helpers.js';

/**
 * Self-contained Remotion renderer extracted from the web service
 * so the Render Workflows service can reuse the exact same browser
 * pool + bundle cache + retry logic without forking the code. The
 * web service keeps importing this module for local dev and legacy
 * sync rendering; the workflows service imports it from its
 * `renderRemotionVideo` task for async rendering that uploads
 * finished bytes to MinIO.
 *
 * The entry point and root dir for Remotion's bundler are resolved
 * relative to THIS file's on-disk location via `import.meta.url`,
 * so the same module works identically whether the caller is
 * running compiled `dist/lib/remotion-renderer.js` or
 * `tsx src/lib/remotion-renderer.ts` — both resolve the package
 * root two directories up.
 *
 * Reliability features baked in:
 *
 * - Single browser instance reused across renders via the
 *   `openBrowser('chrome')` memoization.
 * - `ensureBrowser()` called before first render to pre-download
 *   the Chrome binary into node_modules so the first render does
 *   not pay a cold-start download penalty.
 * - `enableMultiProcessOnLinux` for faster parallel frame rendering.
 * - Lazy bundle with retry-on-failure so a transient webpack hiccup
 *   does not brick every subsequent render until the process
 *   restarts.
 * - `closed` / `closed-silent` browser event listeners that
 *   invalidate the cached browser when Chrome dies, so the next
 *   render rebuilds a fresh one instead of hitting a stale CDP
 *   connection.
 * - `selectComposition` wrapped in a 15-second timeout race because
 *   Chrome's CDP WebSocket can hang for the full `renderMedia`
 *   120-second timeout before throwing when the browser is dead.
 * - In-flight dedup: concurrent renders of the same output are
 *   coalesced into a single render via a `renderJobs` map.
 * - One-shot retry on errors that look like browser connection
 *   failures (`target closed`, `protocol error`, ...).
 * - `AbortSignal` bridged to Remotion's proprietary cancel token so
 *   client disconnects stop the render immediately instead of
 *   wasting CPU on output nobody will read.
 * - Atomic writes via a `.tmp` file + rename so a crashed render
 *   leaves no half-finished file for the cache-hit check.
 */

// ── Path resolution ──────────────────────────────────────────────
//
// Resolve entry point and root dir relative to THIS file, not
// `process.cwd()`. Both values are stable across compiled and
// source layouts (`packages/video/dist/lib/` vs
// `packages/video/src/lib/`): the package root is always two
// directories up.
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const REMOTION_ENTRY = path.resolve(PACKAGE_ROOT, 'src', 'remotion.ts');
const REMOTION_ROOT_DIR = PACKAGE_ROOT;

// ── Public types ─────────────────────────────────────────────────

/**
 * Discriminated union of every Remotion composition the renderer
 * knows about. The composition id narrows `inputProps` to the
 * matching props type, so callers cannot accidentally feed voice
 * commercial props to the product video composition (or vice
 * versa) without TypeScript catching it at the call site.
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

export interface RemotionRendererConfig {
  /**
   * Absolute path where rendered MP4 files land. The renderer
   * creates it on first render if it does not exist. Different
   * consumers pick different directories: the web service uses
   * `<repoRoot>/.cache/remotion-renders/` for local dev, and the
   * workflows service uses `/tmp/remotion-renders` on its pro
   * dyno because `/tmp` survives the task run and is the only
   * writable path.
   */
  cacheDir: string;

  /**
   * Concurrency passed straight through to
   * `@remotion/renderer`'s `renderMedia`. Accepts any value the
   * library accepts — a CPU-core count (`4`), or a percentage
   * string (`'50%'`). Defaults to `'50%'` when omitted.
   */
  concurrency?: string | number;
}

export interface RenderRequest {
  assetId: string;
  version: number;
  variant?: 'visual' | 'narrated';
  cacheSeed?: string;
  abortSignal?: AbortSignal;
}

export interface RenderResult {
  outputPath: string;
  cached: boolean;
}

export interface RemotionRenderer {
  /**
   * Render a Remotion composition. The result's `outputPath` is
   * an absolute path inside the configured `cacheDir`; `cached` is
   * true when the output already existed on disk and the render
   * was skipped.
   */
  render(input: RemotionRenderInput & RenderRequest): Promise<RenderResult>;

  /**
   * Convenience wrapper for the main `LaunchKitProductVideo`
   * composition. Exists so the web service's existing call sites
   * keep working with a typed `inputProps` surface without
   * specifying `compositionId: 'LaunchKitProductVideo'` at every
   * call.
   */
  renderLaunchVideoAsset(
    input: RenderRequest & { inputProps: LaunchKitVideoProps }
  ): Promise<RenderResult>;
}

/**
 * Re-exported pure filename helpers. The canonical definitions live
 * in `./filename-helpers.ts` so the browser-safe top-level
 * `@launchkit/video` export can surface them without dragging
 * `@remotion/bundler` and `@remotion/renderer` into the dashboard
 * bundle. Kept re-exported here so existing import sites
 * (`@launchkit/video/renderer`) keep working unchanged.
 */
export {
  getRenderedVideoFilename,
  buildRenderBasename,
} from './filename-helpers.js';

// Static assertion that the `CompositionId` literal union in
// `filename-helpers.ts` stays in lockstep with `RemotionCompositionId`.
// Any addition to the discriminated union in this file must also
// appear in `filename-helpers.ts` or TypeScript will fail this check
// at compile time — preventing silent drift between the two.
import type { CompositionId } from './filename-helpers.js';
type _AssertCompositionIdMatch = RemotionCompositionId extends CompositionId
  ? CompositionId extends RemotionCompositionId
    ? true
    : never
  : never;
// Pure type-level assertion — the value is the compile-time witness.
// `_` prefix matches ESLint's `argsIgnorePattern: '^_'` so unused is OK.
const _compositionIdAssert: _AssertCompositionIdMatch = true;
void _compositionIdAssert;

// ── Factory ──────────────────────────────────────────────────────

/**
 * Build a Remotion renderer bound to a specific cache directory
 * and concurrency. Each call creates an independent browser pool
 * and bundle cache — typical apps create exactly one at startup
 * and reuse it for every render.
 */
export function createRemotionRenderer(
  config: RemotionRendererConfig
): RemotionRenderer {
  const concurrency = config.concurrency ?? '50%';

  // Reuse a single browser instance across renders. Remotion
  // recommends this pattern for SSR deployments — launching Chrome
  // is expensive (200-600ms per launch) and there is no reason to
  // pay that cost on every render when the same instance can
  // serve sequential requests.
  type Browser = Awaited<ReturnType<typeof openBrowser>>;
  let browserPromise: Promise<Browser> | null = null;

  // Lazily-built Remotion bundle. Webpack bundling takes 2-5
  // seconds on a cold start; every subsequent render reuses the
  // same bundle.
  let bundlePromise: Promise<string> | null = null;

  // In-flight dedup: concurrent renders targeting the same output
  // file wait on the first one instead of running a second render
  // that would stomp the same tempfile.
  const renderJobs = new Map<string, Promise<string>>();

  function invalidateBrowser(): void {
    const stale = browserPromise;
    browserPromise = null;
    if (stale) {
      // Best-effort close on the old browser. If it's already
      // dead this throws, which we swallow — we only care that
      // the cache slot is clear so the next render rebuilds.
      stale
        .then((browser) => browser.close({ silent: true }))
        .catch(() => undefined);
    }
  }

  async function getBrowser(): Promise<Browser> {
    browserPromise ??= (async () => {
      await ensureBrowser({ logLevel: 'error' });
      const browser = await openBrowser('chrome', {
        chromiumOptions: { enableMultiProcessOnLinux: true },
        logLevel: 'error',
      });
      // Chrome can die unexpectedly (OOM, segfault, forced
      // kill). Listen for both close events so a dead browser
      // doesn't sit in the cache forever — the next
      // `getBrowser()` call will relaunch a fresh one. Without
      // this, a single Chrome crash would brick every subsequent
      // render until the dyno restarts.
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

  const webpackOverride: WebpackOverrideFn = (webpackConfig) => {
    return {
      ...webpackConfig,
      resolve: {
        ...webpackConfig.resolve,
        extensionAlias: {
          ...webpackConfig.resolve?.extensionAlias,
          '.js': ['.ts', '.tsx', '.js'],
          '.mjs': ['.mts', '.mjs'],
          '.cjs': ['.cts', '.cjs'],
        },
      },
    };
  };

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

  function buildOutputLocation(basename: string): string {
    return path.join(config.cacheDir, `${basename}.mp4`);
  }

  async function render(
    input: RemotionRenderInput & RenderRequest
  ): Promise<RenderResult> {
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
      await mkdir(config.cacheDir, { recursive: true });

      // One-shot retry on browser failures. If Chrome crashes
      // or the WebSocket connection drops, the first attempt
      // throws something like "Target closed" or "Protocol
      // error" — we invalidate the cached browser and rebuild.
      // User errors (invalid props, missing images, render
      // timeouts) don't benefit from retry and would just waste
      // another full render cycle, so we only retry on errors
      // that look like browser connection failures.
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        const tempPath = path.join(
          config.cacheDir,
          `${basename}.${String(Date.now())}.tmp.mp4`
        );

        try {
          // Bridge the standard AbortSignal (from the HTTP
          // request or workflow task) to Remotion's proprietary
          // cancel token so a client disconnect stops the render
          // immediately instead of wasting CPU on output nobody
          // will read.
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

          // Fail fast if the browser is dead: normally
          // `selectComposition` takes well under a second; 15
          // seconds is a generous ceiling that catches dead CDP
          // connections without false-positiving on a cold JIT'd
          // bundle load.
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
            concurrency,
            timeoutInMilliseconds: 120000,
            overwrite: true,
            logLevel: 'error',
            ...(remotionCancel
              ? { cancelSignal: remotionCancel.cancelSignal }
              : {}),
          });

          await rename(tempPath, outputPath);
          return outputPath;
        } catch (error) {
          await rm(tempPath, { force: true }).catch(() => undefined);
          lastError = error;

          // Don't retry user-initiated cancels — the client
          // left, retrying would waste CPU on output nobody
          // wants.
          if (input.abortSignal?.aborted) {
            throw error;
          }

          // Only retry on errors that look like browser
          // connection failures. User errors (invalid props,
          // missing images, render-level timeouts) bubble up
          // immediately on the first attempt. The "browser
          // likely crashed" message is emitted by our own
          // `withTimeout` wrapper when CDP calls hang past the
          // 15-second ceiling — that's a dead-browser signal
          // even though it didn't throw natively.
          const message =
            error instanceof Error ? error.message : String(error);
          const isBrowserCrash =
            /target closed|protocol error|connection closed|browser.*disconnect|session closed|browser likely crashed/i.test(
              message
            );

          if (!isBrowserCrash || attempt >= 1) {
            throw error;
          }

          // Invalidate the dead browser so the retry rebuilds
          // a fresh one.
          invalidateBrowser();
        }
      }

      // Unreachable in practice — the loop either returns or
      // throws — but TypeScript's flow analysis needs a terminal
      // throw.
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

  async function renderLaunchVideoAsset(
    input: RenderRequest & { inputProps: LaunchKitVideoProps }
  ): Promise<RenderResult> {
    return render({
      compositionId: 'LaunchKitProductVideo',
      inputProps: input.inputProps,
      assetId: input.assetId,
      version: input.version,
      ...(input.variant !== undefined ? { variant: input.variant } : {}),
      ...(input.cacheSeed !== undefined ? { cacheSeed: input.cacheSeed } : {}),
      ...(input.abortSignal !== undefined
        ? { abortSignal: input.abortSignal }
        : {}),
    });
  }

  return { render, renderLaunchVideoAsset };
}

/**
 * Race a promise against a timeout. Used to fail fast when a
 * cached browser is dead — Chrome's CDP WebSocket can hang for
 * the full `renderMedia` `timeoutInMilliseconds` (120s) before
 * throwing, which would tie up the caller for two minutes on a
 * single crash. Wrapping `selectComposition` in a 15-second race
 * catches dead browsers in seconds instead of minutes.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${String(ms)}ms — browser likely crashed`
        )
      );
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
