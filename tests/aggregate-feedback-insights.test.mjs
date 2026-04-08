// Smoke test for the Phase 7 aggregate-feedback-insights cron
// extension.
//
// Module-load surface only — `aggregateFeedbackInsights` opens a real
// Postgres connection and runs the full pipeline (3 legacy
// aggregations + 3 new Phase 7 aggregations). The full integration
// test runs at deploy time against a populated database.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('aggregate-feedback-insights module loads and exposes aggregateFeedbackInsights', async () => {
  const mod = await import(
    '../apps/cron/dist/aggregate-feedback-insights.js'
  );
  assert.equal(
    typeof mod.aggregateFeedbackInsights,
    'function',
    'aggregateFeedbackInsights must be a function'
  );
});
