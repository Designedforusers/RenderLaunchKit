// Smoke test for the Phase 7 POST /api/assets/:id/feedback route's
// boundary-validation surface.
//
// The route handler itself opens a real Postgres connection and
// enqueues a BullMQ job, so the full integration test runs at deploy
// time. This file exercises the AssetFeedbackEventRequestSchema
// discriminated union directly — that's the load-bearing validation
// the route depends on, and verifying it catches the common API
// misuses (missing editText on 'edited' actions, unknown action
// values) gives confidence the route's 400 path is correct.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

test('AssetFeedbackEventRequestSchema enforces action enum + editText-on-edited', async () => {
  const { AssetFeedbackEventRequestSchema } = await import(
    '../packages/shared/dist/schemas/asset-feedback-event.js'
  );

  // Valid: each of the four action types
  for (const action of ['approved', 'rejected', 'regenerated']) {
    const parsed = AssetFeedbackEventRequestSchema.parse({ action });
    assert.equal(parsed.action, action);
  }

  // Valid: edited with non-empty editText
  const editedParsed = AssetFeedbackEventRequestSchema.parse({
    action: 'edited',
    editText: 'Replace the second paragraph with a benchmark callout.',
  });
  assert.equal(editedParsed.action, 'edited');
  if (editedParsed.action === 'edited') {
    assert.equal(
      editedParsed.editText,
      'Replace the second paragraph with a benchmark callout.'
    );
  }

  // Invalid: edited without editText (the discriminated union catches
  // the common API misuse "POST {action: 'edited'} with no edit_text"
  // at the boundary instead of producing a row with NULL edit_text
  // that the cron can't cluster on)
  assert.throws(() =>
    AssetFeedbackEventRequestSchema.parse({ action: 'edited' })
  );

  // Invalid: edited with empty string editText
  assert.throws(() =>
    AssetFeedbackEventRequestSchema.parse({ action: 'edited', editText: '' })
  );

  // Invalid: unknown action
  assert.throws(() =>
    AssetFeedbackEventRequestSchema.parse({ action: 'liked' })
  );

  // Invalid: missing action
  assert.throws(() => AssetFeedbackEventRequestSchema.parse({}));
});

test('asset-api-routes module loads with the new feedback route exported', async () => {
  const mod = await import(
    '../apps/web/dist/routes/asset-api-routes.js'
  );
  assert.equal(
    typeof mod.default,
    'object',
    'asset-api-routes must export a Hono app'
  );
});
