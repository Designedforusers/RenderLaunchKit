// Smoke test for the Phase 7 embed-feedback-event processor.
//
// Module-load surface only — `processEmbedFeedbackEvent` opens a real
// Postgres connection and calls Voyage. The full integration test
// (insert a feedback row, fire the job, verify the embedding lands)
// runs at deploy time, not in CI.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('embed-feedback-event module loads and exposes processEmbedFeedbackEvent', async () => {
  const mod = await import(
    '../apps/worker/dist/processors/embed-feedback-event.js'
  );
  assert.equal(
    typeof mod.processEmbedFeedbackEvent,
    'function',
    'processEmbedFeedbackEvent must be a function'
  );
});

test('EmbedFeedbackEventJobDataSchema validates the wakeup payload shape', async () => {
  const { EmbedFeedbackEventJobDataSchema } = await import(
    '../packages/shared/dist/schemas/job-data.js'
  );

  // Valid UUID parses cleanly
  const valid = EmbedFeedbackEventJobDataSchema.parse({
    feedbackEventId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(valid.feedbackEventId, '11111111-1111-4111-8111-111111111111');

  // Non-UUID string is rejected — protects the worker from a malformed
  // wakeup payload that would otherwise reach the database.
  assert.throws(() =>
    EmbedFeedbackEventJobDataSchema.parse({ feedbackEventId: 'not-a-uuid' })
  );

  // Missing field is rejected
  assert.throws(() => EmbedFeedbackEventJobDataSchema.parse({}));
});
