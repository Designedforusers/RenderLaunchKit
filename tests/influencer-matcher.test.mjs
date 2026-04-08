// Smoke test for the Phase 5 influencer matcher.
//
// Module-load surface only — `findInfluencersForCommit` opens a real
// Postgres connection and calls Voyage, both of which require live
// infrastructure. The full pgvector-on-real-rows test runs at deploy
// time, not in this CI suite.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('influencer-matcher module loads and exposes findInfluencersForCommit', async () => {
  const mod = await import(
    '../apps/worker/dist/lib/influencer-matcher.js'
  );
  assert.equal(
    typeof mod.findInfluencersForCommit,
    'function',
    'findInfluencersForCommit must be a function'
  );
});

test('AudienceBreakdownSchema accepts the per-source shapes the cron writes', async () => {
  const { AudienceBreakdownSchema } = await import(
    '../packages/shared/dist/schemas/dev-influencer.js'
  );

  // All four platforms present
  const full = AudienceBreakdownSchema.parse({
    twitter: { followers: 250000, verified: true, tweetCount: 5000 },
    github: { followers: 12000, publicRepos: 200 },
    devto: { postCount: 30 },
    hn: { karma: 50000 },
  });
  assert.equal(full.twitter?.followers, 250000);
  assert.equal(full.hn?.karma, 50000);

  // Sparse — only one platform present is valid (most influencers)
  const sparse = AudienceBreakdownSchema.parse({
    github: { followers: 500 },
  });
  assert.equal(sparse.github?.followers, 500);
  assert.equal(sparse.twitter, undefined);

  // Empty object is valid (a freshly-seeded row before any cron run)
  const empty = AudienceBreakdownSchema.parse({});
  assert.deepEqual(empty, {});

  // Negative followers is rejected
  assert.throws(() =>
    AudienceBreakdownSchema.parse({
      github: { followers: -1 },
    })
  );

  // Missing the required `followers` inside `twitter` is rejected
  assert.throws(() =>
    AudienceBreakdownSchema.parse({
      twitter: { verified: true },
    })
  );
});
