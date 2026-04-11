// Unit tests for the pure helpers inside search-google-trends.
//
// `searchGoogleTrends` itself dynamic-imports the CJS
// `google-trends-api` package at call time; stubbing that dynamic
// import cleanly would require either a loader hook or a
// `require.cache` override keyed off the resolved path, neither of
// which is worth the complexity for a thin wrapper. Instead, this
// test file covers the three pure helpers the wrapper delegates to
// — `parseInterestOverTime`, `parseRelatedQueries`, and
// `withTimeout` — which were hoisted to exported symbols
// specifically so unit tests could reach them directly.
//
// The top-level `searchGoogleTrends` happy path + "import failed"
// branch are covered indirectly through the `/api/trends/search`
// route tests (Phase 4d) where the whole module gets swapped out
// via the Hono in-memory `app.request()` pattern.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

// ── parseInterestOverTime ─────────────────────────────────────────

test('parseInterestOverTime: parses valid Google Trends JSON shape', async () => {
  const { parseInterestOverTime } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  // `TimelinePointSchema` requires `time`, `formattedTime`, and a
  // single-element `value` tuple. The wrapper only surfaces
  // `formattedTime` + `value[0]` but the schema parses the full
  // upstream shape, so every field must be present.
  const raw = JSON.stringify({
    default: {
      timelineData: [
        { time: '1736640000', formattedTime: 'Jan 12, 2026', value: [57] },
        { time: '1737244800', formattedTime: 'Jan 19, 2026', value: [82] },
        { time: '1737849600', formattedTime: 'Jan 26, 2026', value: [41] },
      ],
    },
  });
  const fulfilled = { status: 'fulfilled', value: raw };
  const result = parseInterestOverTime(fulfilled);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { date: 'Jan 12, 2026', value: 57 });
  assert.deepEqual(result[1], { date: 'Jan 19, 2026', value: 82 });
  assert.deepEqual(result[2], { date: 'Jan 26, 2026', value: 41 });
});

test('parseInterestOverTime: rejected settled result returns empty array', async () => {
  const { parseInterestOverTime } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  const rejected = { status: 'rejected', reason: new Error('boom') };
  assert.deepEqual(parseInterestOverTime(rejected), []);
});

test('parseInterestOverTime: malformed JSON returns empty array', async () => {
  const { parseInterestOverTime } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  const fulfilled = { status: 'fulfilled', value: 'not json at all {' };
  assert.deepEqual(parseInterestOverTime(fulfilled), []);
});

test('parseInterestOverTime: schema-mismatched JSON returns empty array', async () => {
  const { parseInterestOverTime } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  // Valid JSON but missing the `default.timelineData` shape.
  const fulfilled = { status: 'fulfilled', value: '{"foo":"bar"}' };
  assert.deepEqual(parseInterestOverTime(fulfilled), []);
});

// ── parseRelatedQueries ───────────────────────────────────────────

test('parseRelatedQueries: extracts top and rising queries with their scores', async () => {
  const { parseRelatedQueries } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  // Schema is flat at `rankedList`, NOT nested under `default`.
  // Google Trends API returns both shapes depending on endpoint;
  // the related-queries endpoint is flat.
  const raw = JSON.stringify({
    rankedList: [
      {
        rankedKeyword: [
          { query: 'top one', value: 100 },
          { query: 'top two', value: 80 },
        ],
      },
      {
        rankedKeyword: [
          { query: 'rising one', value: 500 },
          { query: 'rising two', value: 300 },
        ],
      },
    ],
  });
  const fulfilled = { status: 'fulfilled', value: raw };
  const { topQueries, risingQueries } = parseRelatedQueries(fulfilled);
  assert.equal(topQueries.length, 2);
  assert.equal(topQueries[0].query, 'top one');
  assert.equal(topQueries[0].value, 100);
  assert.equal(risingQueries.length, 2);
  assert.equal(risingQueries[0].query, 'rising one');
  assert.equal(risingQueries[0].value, 500);
});

test('parseRelatedQueries: rejected settled result returns empty arrays', async () => {
  const { parseRelatedQueries } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  const rejected = { status: 'rejected', reason: new Error('boom') };
  const result = parseRelatedQueries(rejected);
  assert.deepEqual(result.topQueries, []);
  assert.deepEqual(result.risingQueries, []);
});

test('parseRelatedQueries: slices to 10 per list even when upstream returns more', async () => {
  const { parseRelatedQueries } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  const many = Array.from({ length: 15 }, (_, i) => ({
    query: `q${String(i)}`,
    value: 100 - i,
  }));
  const raw = JSON.stringify({
    rankedList: [{ rankedKeyword: many }, { rankedKeyword: many }],
  });
  const fulfilled = { status: 'fulfilled', value: raw };
  const { topQueries, risingQueries } = parseRelatedQueries(fulfilled);
  assert.equal(topQueries.length, 10);
  assert.equal(risingQueries.length, 10);
});

// ── withTimeout ───────────────────────────────────────────────────

test('withTimeout: resolves when the inner promise settles before the timeout', async () => {
  const { withTimeout } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  const result = await withTimeout(Promise.resolve('fast'), 1000);
  assert.equal(result, 'fast');
});

test('withTimeout: rejects when the inner promise is slower than the timeout', async () => {
  const { withTimeout } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  const slow = new Promise((resolve) => {
    setTimeout(() => resolve('slow'), 200);
  });
  await assert.rejects(
    async () => withTimeout(slow, 20),
    /Timeout after 20ms/
  );
});

test('withTimeout: propagates inner-promise rejection verbatim', async () => {
  const { withTimeout } = await import(
    '../apps/web/dist/lib/search-google-trends.js'
  );

  const inner = Promise.reject(new Error('underlying failure'));
  await assert.rejects(
    async () => withTimeout(inner, 1000),
    /underlying failure/
  );
});
