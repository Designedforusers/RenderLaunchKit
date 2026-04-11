// Pure filename helper tests for the Remotion renderer.
//
// The full `createRemotionRenderer` factory cannot be unit-tested
// because it transitively pulls in `@remotion/bundler`,
// `@remotion/renderer`, a real webpack compile, and a puppeteer-
// launched Chromium instance — none of which run inside node:test
// without blowing up. The filename helpers were hoisted into a
// separate `filename-helpers.ts` file specifically so tests can
// cover the cache-key and Content-Disposition logic directly
// without importing anything Chrome-adjacent.
//
// See `refactor: expose test seams for renderer, trigger helpers,
// parsers` for the hoist rationale and the `CompositionId` drift
// guard that keeps the literal union in lockstep with the full
// `RemotionCompositionId` union in `remotion-renderer.ts`.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

// ── getRenderedVideoFilename ──────────────────────────────────────

test('getRenderedVideoFilename: visual variant omits the narrated suffix', async () => {
  const { getRenderedVideoFilename } = await import(
    '../packages/video/dist/lib/filename-helpers.js'
  );
  assert.equal(
    getRenderedVideoFilename('asset-abc', 3, 'visual'),
    'launchkit-asset-abc-v3.mp4'
  );
});

test('getRenderedVideoFilename: narrated variant appends -narrated', async () => {
  const { getRenderedVideoFilename } = await import(
    '../packages/video/dist/lib/filename-helpers.js'
  );
  assert.equal(
    getRenderedVideoFilename('asset-abc', 3, 'narrated'),
    'launchkit-asset-abc-v3-narrated.mp4'
  );
});

test('getRenderedVideoFilename: variant defaults to visual when omitted', async () => {
  const { getRenderedVideoFilename } = await import(
    '../packages/video/dist/lib/filename-helpers.js'
  );
  assert.equal(
    getRenderedVideoFilename('asset-xyz', 7),
    'launchkit-asset-xyz-v7.mp4'
  );
});

// ── buildRenderBasename ───────────────────────────────────────────

test('buildRenderBasename: legacy LaunchKitProductVideo layout preserves pre-Phase-4 filenames', async () => {
  const { buildRenderBasename } = await import(
    '../packages/video/dist/lib/filename-helpers.js'
  );
  // Legacy layout: `<assetId>-v<version>-<variant>` with no
  // composition id. Tests depend on this exact shape because
  // existing cached files on disk use it.
  assert.equal(
    buildRenderBasename({
      assetId: 'asset-abc',
      version: 2,
      variant: 'visual',
      compositionId: 'LaunchKitProductVideo',
    }),
    'asset-abc-v2-visual'
  );
});

test('buildRenderBasename: new compositions embed the composition id between assetId and version', async () => {
  const { buildRenderBasename } = await import(
    '../packages/video/dist/lib/filename-helpers.js'
  );
  // New composition layout: embeds composition id so renders for
  // the same asset id never collide across compositions.
  assert.equal(
    buildRenderBasename({
      assetId: 'asset-abc',
      version: 2,
      variant: 'visual',
      compositionId: 'LaunchKitVerticalVideo',
    }),
    'asset-abc-LaunchKitVerticalVideo-v2-visual'
  );
});

test('buildRenderBasename: cacheSeed appends a stable 12-char sha1 suffix', async () => {
  const { buildRenderBasename } = await import(
    '../packages/video/dist/lib/filename-helpers.js'
  );
  // Same cacheSeed → same suffix. Stable sha1-12 output.
  const first = buildRenderBasename({
    assetId: 'asset-abc',
    version: 1,
    variant: 'narrated',
    compositionId: 'LaunchKitProductVideo',
    cacheSeed: 'voice-elevenlabs-premade-rachel-hello-world',
  });
  const second = buildRenderBasename({
    assetId: 'asset-abc',
    version: 1,
    variant: 'narrated',
    compositionId: 'LaunchKitProductVideo',
    cacheSeed: 'voice-elevenlabs-premade-rachel-hello-world',
  });
  assert.equal(first, second);
  // Shape: `<assetId>-v<version>-<variant>-<12 hex chars>`
  assert.match(first, /^asset-abc-v1-narrated-[0-9a-f]{12}$/);
});

test('buildRenderBasename: different cacheSeeds produce different suffixes', async () => {
  const { buildRenderBasename } = await import(
    '../packages/video/dist/lib/filename-helpers.js'
  );
  const a = buildRenderBasename({
    assetId: 'asset-abc',
    version: 1,
    variant: 'narrated',
    compositionId: 'LaunchKitProductVideo',
    cacheSeed: 'seed-one',
  });
  const b = buildRenderBasename({
    assetId: 'asset-abc',
    version: 1,
    variant: 'narrated',
    compositionId: 'LaunchKitProductVideo',
    cacheSeed: 'seed-two',
  });
  assert.notEqual(a, b);
});
