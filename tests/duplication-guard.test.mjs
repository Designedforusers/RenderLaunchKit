// Smoke test for the Phase 6 duplication guard.
//
// Module-load surface only — `checkCommitDuplication` opens a real
// Postgres connection. The full integration test (insert two
// near-duplicate commits, verify the second is rejected) runs at
// deploy time, not in CI.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('duplication-guard module loads and exposes checkCommitDuplication', async () => {
  const mod = await import(
    '../apps/worker/dist/lib/duplication-guard.js'
  );
  assert.equal(
    typeof mod.checkCommitDuplication,
    'function',
    'checkCommitDuplication must be a function'
  );
});
