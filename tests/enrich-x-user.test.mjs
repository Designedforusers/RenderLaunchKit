// Smoke test for the Phase 5 X API enrichment tool.
//
// Verifies the no-token soft-fail contract: when X_API_BEARER_TOKEN is
// unset (which it is in CI by default), `enrichXUser({ handle })` MUST
// return `null` without making any network call. This is the gate that
// keeps the cron's enrichment loop from blowing up on a free-tier
// deploy that doesn't pay for X API credits.
//
// The real X API call path requires `X_API_BEARER_TOKEN` to be set
// AND a real handle to enrich, both of which are deploy-time concerns
// not CI concerns.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
// Explicitly delete X_API_BEARER_TOKEN so the test runs in the no-token
// branch even on a developer machine that has the env var set in their
// shell. The test asserts the soft-fail contract, not the live path.
delete process.env.X_API_BEARER_TOKEN;

import test from 'node:test';
import assert from 'node:assert/strict';

test('enrich-x-user module loads and exposes enrichXUser', async () => {
  const mod = await import(
    '../apps/worker/dist/tools/enrich-x-user.js'
  );
  assert.equal(typeof mod.enrichXUser, 'function');
});

test('enrichXUser returns null when X_API_BEARER_TOKEN is unset', async () => {
  const { enrichXUser } = await import(
    '../apps/worker/dist/tools/enrich-x-user.js'
  );

  // No X_API_BEARER_TOKEN — must short-circuit to null without an
  // upstream call. We can't directly assert "no fetch call happened"
  // without monkey-patching global fetch, but the function returning
  // null synchronously (within the same microtask tick) is strong
  // evidence the upstream call was skipped.
  const result = await enrichXUser({ handle: 'jack' });
  assert.equal(result, null, 'enrichXUser must return null when env unset');

  // Calling it twice in a row also returns null without spamming logs.
  // (The function uses a module-level guard to log the disabled
  // warning exactly once per process — we can't easily verify the
  // log count from here, but the second call still returning null is
  // the contract under test.)
  const result2 = await enrichXUser({ handle: 'elonmusk' });
  assert.equal(result2, null);
});

test('influencer-enrichment-types module loads and exposes the shared schemas', async () => {
  const mod = await import(
    '../apps/worker/dist/tools/influencer-enrichment-types.js'
  );
  assert.equal(typeof mod.InfluencerProfileSchema, 'object');
  assert.equal(typeof mod.EnrichmentSourceSchema, 'object');
  assert.equal(typeof mod.readEnrichmentCache, 'function');
  assert.equal(typeof mod.writeEnrichmentCache, 'function');
  assert.equal(typeof mod.rehydrateEnrichmentCache, 'function');
});
