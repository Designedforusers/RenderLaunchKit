// Smoke test for the Phase 6 trend matcher.
//
// Module-load surface only — `findRelevantTrendsForCommit` opens a real
// Postgres connection and calls Voyage, both of which require live
// infrastructure. The full pgvector-on-real-rows test runs at deploy
// time, not in this CI suite. Same approach as Phase 5's
// `influencer-matcher.test.mjs`.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('trend-matcher module loads and exposes findRelevantTrendsForCommit', async () => {
  const mod = await import(
    '../apps/worker/dist/lib/trend-matcher.js'
  );
  assert.equal(
    typeof mod.findRelevantTrendsForCommit,
    'function',
    'findRelevantTrendsForCommit must be a function'
  );
});
