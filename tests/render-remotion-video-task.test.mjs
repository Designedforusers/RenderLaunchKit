// Unit tests for the pure helpers inside the `renderRemotionVideo`
// workflow task.
//
// The full task body requires a real `createRemotionRenderer`
// (which needs Chrome + webpack), a real Postgres via drizzle
// (which needs a live DB with a real asset row), `fs.readFile`
// against a real temp file on disk, and a live MinIO upload. All
// four are covered end-to-end by the Playwright suite in Phase 5
// where the real click → workflow dispatch → render → upload path
// runs against the local dev stack.
//
// The test seams from Phase 3a (`_setRendererFactoryForTests`)
// let us get most of the way to a unit-level body test, but
// stubbing drizzle's chained `db.select().from().where()` surface
// without a real connection requires either a loader hook or a
// bespoke driver stub — neither is worth the complexity for a
// task body that is itself just dispatch glue.
//
// What we CAN and DO test at the unit layer:
//
//   - `parseCompositionInput` — the discriminated-union parser
//     that routes `inputProps: unknown` through the matching
//     Zod schema based on `compositionId`. This is the boundary
//     where a malformed task payload becomes a typed error.
//   - `readRenderedVideoSizeBytes` — the tolerant jsonb reader
//     that backs the cache-hit sizeBytes return. Covers every
//     failure mode the `unknown`-typed blob can surface.
//   - `isRecord` — type guard used by the metadata
//     read-modify-write path.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

// ── isRecord ──────────────────────────────────────────────────────

test('isRecord: plain object is a record', async () => {
  const { isRecord } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ foo: 'bar' }), true);
});

test('isRecord: array is NOT a record (would index numeric keys)', async () => {
  const { isRecord } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  assert.equal(isRecord([]), false);
  assert.equal(isRecord([1, 2, 3]), false);
});

test('isRecord: null / undefined / primitives are NOT records', async () => {
  const { isRecord } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  assert.equal(isRecord(null), false);
  assert.equal(isRecord(undefined), false);
  assert.equal(isRecord('string'), false);
  assert.equal(isRecord(42), false);
  assert.equal(isRecord(true), false);
});

// ── readRenderedVideoSizeBytes ────────────────────────────────────

test('readRenderedVideoSizeBytes: happy path reads the stored number', async () => {
  const { readRenderedVideoSizeBytes } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  assert.equal(
    readRenderedVideoSizeBytes({ renderedVideoSizeBytes: 12345 }),
    12345
  );
  // Preserves other metadata fields — read-modify-write round-trips.
  assert.equal(
    readRenderedVideoSizeBytes({
      someOtherField: 'ignored',
      renderedVideoSizeBytes: 999,
      nested: { unrelated: true },
    }),
    999
  );
});

test('readRenderedVideoSizeBytes: missing key returns 0 (legacy row)', async () => {
  const { readRenderedVideoSizeBytes } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  // Legacy rows predate the size-persist feature; the cache-hit
  // branch still has to produce a return value. 0 is the tolerant
  // default — callers filter on `cached === true` before summing.
  assert.equal(readRenderedVideoSizeBytes({ someOtherField: 'x' }), 0);
});

test('readRenderedVideoSizeBytes: non-object metadata returns 0', async () => {
  const { readRenderedVideoSizeBytes } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  assert.equal(readRenderedVideoSizeBytes(null), 0);
  assert.equal(readRenderedVideoSizeBytes(undefined), 0);
  assert.equal(readRenderedVideoSizeBytes('a string'), 0);
  assert.equal(readRenderedVideoSizeBytes(42), 0);
  assert.equal(readRenderedVideoSizeBytes([1, 2, 3]), 0);
});

test('readRenderedVideoSizeBytes: non-numeric or negative value returns 0', async () => {
  const { readRenderedVideoSizeBytes } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  assert.equal(
    readRenderedVideoSizeBytes({ renderedVideoSizeBytes: 'not a number' }),
    0
  );
  assert.equal(readRenderedVideoSizeBytes({ renderedVideoSizeBytes: -1 }), 0);
  assert.equal(
    readRenderedVideoSizeBytes({ renderedVideoSizeBytes: NaN }),
    0
  );
  assert.equal(
    readRenderedVideoSizeBytes({ renderedVideoSizeBytes: Infinity }),
    0
  );
});

// ── parseCompositionInput ─────────────────────────────────────────

test('parseCompositionInput: LaunchKitProductVideo routes through LaunchKitVideoPropsSchema', async () => {
  const { parseCompositionInput } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  const input = {
    title: 'LaunchKit',
    subtitle: 'AI teammate',
    badge: 'Product video',
    accentColor: '#10b981',
    backgroundColor: '#020617',
    outroCta: 'Paste a repo',
    shots: [],
  };
  const parsed = parseCompositionInput('LaunchKitProductVideo', input);
  assert.equal(parsed.compositionId, 'LaunchKitProductVideo');
  assert.equal(parsed.inputProps.title, 'LaunchKit');
});

test('parseCompositionInput: LaunchKitVerticalVideo routes through VerticalVideoPropsSchema', async () => {
  const { parseCompositionInput } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  const input = {
    productName: 'LaunchKit',
    tagline: 'AI teammate',
    accentColor: '#10b981',
    backgroundColor: '#020617',
    heroImageUrl: 'https://example.com/hero.png',
    shots: [],
    outroCta: 'go',
  };
  const parsed = parseCompositionInput('LaunchKitVerticalVideo', input);
  assert.equal(parsed.compositionId, 'LaunchKitVerticalVideo');
  assert.equal(parsed.inputProps.productName, 'LaunchKit');
});

test('parseCompositionInput: malformed props for declared composition throws at the Zod boundary', async () => {
  const { parseCompositionInput } = await import(
    '../apps/workflows/dist/tasks/render-remotion-video.js'
  );
  // `LaunchKitProductVideo` requires `title`; passing an empty
  // object fails the Zod parse and throws with a named field.
  assert.throws(
    () => parseCompositionInput('LaunchKitProductVideo', {}),
    /title/
  );
});
