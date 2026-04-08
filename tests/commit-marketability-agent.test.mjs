// Smoke test for the Phase 6 commit-marketability agent.
//
// Module-load surface only — `evaluateCommitMarketability` calls
// `generateJSON` which costs Anthropic credits. CI verifies that the
// rename from `webhook-relevance-agent` → `commit-marketability-agent`
// landed cleanly and the new export name is callable.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('commit-marketability-agent module loads and exposes evaluateCommitMarketability', async () => {
  const mod = await import(
    '../apps/worker/dist/agents/commit-marketability-agent.js'
  );
  assert.equal(
    typeof mod.evaluateCommitMarketability,
    'function',
    'evaluateCommitMarketability must be a function'
  );
});
