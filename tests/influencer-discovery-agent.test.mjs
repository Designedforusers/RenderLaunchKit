// Smoke tests for the Phase 5 influencer-discovery agent.
//
// These tests do NOT call the Claude Agent SDK or any upstream API —
// they exercise the import surface, the schema-derived types, and the
// pure helpers (`harvestCandidateHandles`, `profileFragment`) that the
// agent exposes for direct test access. A real end-to-end test against
// the agent loop requires `ANTHROPIC_API_KEY` and is the responsibility
// of a deploy-time integration check.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('influencer-discovery-agent module loads and exposes runInfluencerDiscoveryAgent', async () => {
  const mod = await import(
    '../apps/worker/dist/agents/influencer-discovery-agent.js'
  );
  assert.equal(
    typeof mod.runInfluencerDiscoveryAgent,
    'function',
    'runInfluencerDiscoveryAgent must be a function'
  );
  assert.equal(
    typeof mod.harvestCandidateHandles,
    'function',
    'harvestCandidateHandles helper must be exported for tests'
  );
  assert.equal(
    typeof mod.profileFragment,
    'function',
    'profileFragment helper must be exported for tests'
  );
});

test('InfluencerCandidateSchema enforces shape and bounds', async () => {
  const { InfluencerCandidateSchema } = await import(
    '../packages/shared/dist/schemas/influencer-candidate.js'
  );

  // Valid candidate parses cleanly
  const valid = {
    handle: 'tj',
    platforms: { github: 'tj', twitter: 'tjholowaychuk' },
    categories: ['library', 'framework'],
    bio: 'Built Express, Koa, Mocha.',
    audienceSize: 50000,
    recentTopics: ['nodejs', 'express'],
    matchReasoning: 'Author of Express, perfect fit for a web framework launch.',
    matchScore: 0.92,
  };
  const parsed = InfluencerCandidateSchema.parse(valid);
  assert.equal(parsed.handle, 'tj');
  assert.equal(parsed.matchScore, 0.92);

  // matchScore out of bounds [0, 1] is rejected
  assert.throws(() =>
    InfluencerCandidateSchema.parse({ ...valid, matchScore: 1.5 })
  );

  // Empty matchReasoning is rejected
  assert.throws(() =>
    InfluencerCandidateSchema.parse({ ...valid, matchReasoning: '' })
  );

  // Negative audienceSize is rejected
  assert.throws(() =>
    InfluencerCandidateSchema.parse({ ...valid, audienceSize: -5 })
  );
});

test('profileFragment maps source to platform key correctly', async () => {
  const { profileFragment } = await import(
    '../apps/worker/dist/agents/influencer-discovery-agent.js'
  );

  // GitHub profile → github platform key, real follower count
  const github = profileFragment({
    source: 'github_user',
    handle: 'tj',
    displayName: 'TJ',
    bio: 'Maintainer',
    followers: 12345,
    additionalMetrics: { publicRepos: 200 },
  });
  assert.equal(github.platformKey, 'github');
  assert.equal(github.followers, 12345);
  assert.equal(github.bio, 'Maintainer');

  // HN profile → hackernews platform key, karma fallback for followers
  const hn = profileFragment({
    source: 'hn_user',
    handle: 'pg',
    displayName: null,
    bio: null,
    followers: null,
    additionalMetrics: { karma: 50000 },
  });
  assert.equal(hn.platformKey, 'hackernews');
  assert.equal(hn.followers, 50000); // karma fallback

  // dev.to profile → devto platform key, post_count × 100 fallback
  const devto = profileFragment({
    source: 'devto_user',
    handle: 'someone',
    displayName: 'Someone',
    bio: 'Writes about Rust',
    followers: null,
    additionalMetrics: { postCount: 30 },
  });
  assert.equal(devto.platformKey, 'devto');
  assert.equal(devto.followers, 3000); // 30 × 100

  // X profile → twitter platform key
  const x = profileFragment({
    source: 'x_user',
    handle: 'gergely',
    displayName: 'Gergely Orosz',
    bio: 'Software engineer',
    followers: 250000,
    additionalMetrics: { followingCount: 500, verified: true },
  });
  assert.equal(x.platformKey, 'twitter');
  assert.equal(x.followers, 250000);
});
