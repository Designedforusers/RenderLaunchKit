// Smoke test for the Phase 6 commit-marketing-run processor.
//
// Module-load surface only — `processCommitMarketingRun` orchestrates
// the entire pipeline (DB, Voyage, Claude, the commit-marketability
// agent, BullMQ) and is end-to-end testable only against live
// infrastructure. The CI smoke test confirms the module loads and
// exports the expected symbol.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('process-commit-marketing-run module loads and exposes processCommitMarketingRun', async () => {
  const mod = await import(
    '../apps/worker/dist/processors/process-commit-marketing-run.js'
  );
  assert.equal(
    typeof mod.processCommitMarketingRun,
    'function',
    'processCommitMarketingRun must be a function'
  );
});
