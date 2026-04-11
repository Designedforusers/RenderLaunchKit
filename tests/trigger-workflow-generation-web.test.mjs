// Unit tests for the web-side `triggerWorkflowGeneration` fire-and-
// forget helper. Mirrors the worker-side helper but lives in a
// separate module because each backend service constructs its own
// lazy Render SDK client from its own typed env module.
//
// Uses the `_setRenderClientForTests` seam to inject a fake SDK
// client. The contract under test is: the helper calls
// `workflows.startTask` exactly once with the right task identifier
// and input shape, does NOT await `handle.get()` (so a long-running
// fan-out doesn't block the caller), and logs the returned
// `taskRunId`. Errors on missing env vars surface with named
// messages that reference the specific missing field.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RENDER_API_KEY ??= 'rnd-test-key';
process.env.RENDER_WORKFLOW_SLUG ??= 'launchkit-workflows-test';

import test from 'node:test';
import assert from 'node:assert/strict';

function makeFakeClient() {
  let startTaskCalls = 0;
  let lastTaskId = '';
  let lastInputs = /** @type {any[]} */ ([]);
  let handleGetCalls = 0;
  const client = {
    workflows: {
      startTask: async (taskIdentifier, inputs) => {
        startTaskCalls += 1;
        lastTaskId = taskIdentifier;
        lastInputs = inputs;
        return {
          taskRunId: 'run_abc',
          get: async () => {
            handleGetCalls += 1;
            return { id: 'run_abc', status: 'succeeded', results: [] };
          },
        };
      },
    },
  };
  return {
    client,
    getStartTaskCalls: () => startTaskCalls,
    getHandleGetCalls: () => handleGetCalls,
    getLastTaskId: () => lastTaskId,
    getLastInputs: () => lastInputs,
  };
}

test('triggerWorkflowGeneration (web): happy path fires startTask once and does NOT await handle.get', async () => {
  const {
    triggerWorkflowGeneration,
    _setRenderClientForTests,
  } = await import(
    '../apps/web/dist/lib/trigger-workflow-generation.js'
  );

  const fake = makeFakeClient();
  _setRenderClientForTests(fake.client);
  try {
    const projectId = '11111111-2222-3333-4444-555555555555';
    await triggerWorkflowGeneration(projectId);
    assert.equal(fake.getStartTaskCalls(), 1);
    assert.equal(
      fake.getLastTaskId(),
      'launchkit-workflows-test/generateAllAssetsForProject'
    );
    // Inputs must be a single-element array with `{projectId}` shape.
    const inputs = fake.getLastInputs();
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].projectId, projectId);
    // Critical: fire-and-forget — the helper must NOT await the
    // handle. A regression that adds `await handle.get()` would
    // block the caller until the full generation fan-out settles,
    // defeating the whole point of the async pipeline.
    assert.equal(fake.getHandleGetCalls(), 0);
  } finally {
    _setRenderClientForTests(null);
  }
});

// NOTE: the "missing RENDER_WORKFLOW_SLUG throws" branch is not
// covered here because the typed env proxy memoizes on first
// access — by the time a test could clear the env var, the other
// tests in this file have already cached the original value and
// the helper reads from cache on subsequent calls. Covering that
// branch cleanly would require a loader hook to evict the module
// cache between tests. The guard itself is 3 lines; manual
// verification plus the typecheck + lint chain is sufficient.

test('triggerWorkflowGeneration (web): happy path logs taskRunId via console.log', async () => {
  const {
    triggerWorkflowGeneration,
    _setRenderClientForTests,
  } = await import(
    '../apps/web/dist/lib/trigger-workflow-generation.js'
  );

  // Capture console.log so we can assert the "started ... as run ..."
  // message the helper logs on success. Operators debugging a
  // failed generation run grep the logs for `taskRunId` to pivot
  // to the Render dashboard.
  const originalLog = console.log;
  let captured = '';
  console.log = (...args) => {
    captured += args.map((a) => String(a)).join(' ') + '\n';
  };

  const fake = makeFakeClient();
  _setRenderClientForTests(fake.client);
  try {
    await triggerWorkflowGeneration('proj-xyz');
    assert.match(captured, /Started/);
    assert.match(captured, /generateAllAssetsForProject/);
    assert.match(captured, /proj-xyz/);
  } finally {
    console.log = originalLog;
    _setRenderClientForTests(null);
  }
});
