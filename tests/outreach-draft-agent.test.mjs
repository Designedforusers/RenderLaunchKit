// Smoke tests for the Phase 5 outreach-draft agent.
//
// Tests `hasContactableChannel()` (pure function, no API call) and the
// module-load surface. The actual `generateOutreachDrafts()` call burns
// Anthropic credits and is the responsibility of a deploy-time
// integration check.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('outreach-draft-agent module loads and exposes generateOutreachDrafts + hasContactableChannel', async () => {
  const mod = await import(
    '../apps/worker/dist/agents/outreach-draft-agent.js'
  );
  assert.equal(typeof mod.generateOutreachDrafts, 'function');
  assert.equal(typeof mod.hasContactableChannel, 'function');
});

test('hasContactableChannel returns true when at least one platform is set', async () => {
  const { hasContactableChannel } = await import(
    '../apps/worker/dist/agents/outreach-draft-agent.js'
  );

  // Twitter only — twitter_dm channel is viable
  assert.equal(
    hasContactableChannel({ platforms: { twitter: 'tjholowaychuk' } }),
    true
  );

  // Website only — email channel is viable
  assert.equal(
    hasContactableChannel({ platforms: { website: 'https://tjholowaychuk.com' } }),
    true
  );

  // GitHub only — comment channel is viable (GitHub discussion)
  assert.equal(
    hasContactableChannel({ platforms: { github: 'tj' } }),
    true
  );

  // HN only — comment channel is viable (HN reply)
  assert.equal(
    hasContactableChannel({ platforms: { hackernews: 'pg' } }),
    true
  );

  // dev.to only — comment channel is viable (dev.to comment)
  assert.equal(
    hasContactableChannel({ platforms: { devto: 'someone' } }),
    true
  );

  // Reddit only — comment channel is viable (Reddit reply)
  assert.equal(
    hasContactableChannel({ platforms: { reddit: 'someuser' } }),
    true
  );

  // Multiple platforms set — viable
  assert.equal(
    hasContactableChannel({
      platforms: {
        twitter: 'tjholowaychuk',
        github: 'tj',
        website: 'https://tjholowaychuk.com',
      },
    }),
    true
  );
});

test('hasContactableChannel returns false when no platforms are set', async () => {
  const { hasContactableChannel } = await import(
    '../apps/worker/dist/agents/outreach-draft-agent.js'
  );

  assert.equal(hasContactableChannel({ platforms: {} }), false);

  // producthunt alone is NOT a viable contact channel — Phase 5 has
  // no producthunt outreach support, so an influencer with only that
  // platform handle is uncontactable.
  assert.equal(
    hasContactableChannel({ platforms: { producthunt: 'maker' } }),
    false
  );
});

test('OutreachDraftInsertSchema validates the persistable shape', async () => {
  const { OutreachDraftInsertSchema } = await import(
    '../packages/shared/dist/schemas/outreach-draft.js'
  );

  const valid = {
    commitMarketingRunId: '11111111-1111-4111-8111-111111111111',
    influencerId: '22222222-2222-4222-8222-222222222222',
    channel: 'twitter_dm',
    draftText: 'Hey, your post on Express resonated — built something similar.',
  };
  const parsed = OutreachDraftInsertSchema.parse(valid);
  assert.equal(parsed.status, 'drafted'); // schema default

  // Empty draftText is rejected
  assert.throws(() =>
    OutreachDraftInsertSchema.parse({ ...valid, draftText: '' })
  );

  // Non-UUID commitMarketingRunId is rejected
  assert.throws(() =>
    OutreachDraftInsertSchema.parse({
      ...valid,
      commitMarketingRunId: 'not-a-uuid',
    })
  );

  // Invalid channel is rejected
  assert.throws(() =>
    OutreachDraftInsertSchema.parse({ ...valid, channel: 'discord_dm' })
  );
});
