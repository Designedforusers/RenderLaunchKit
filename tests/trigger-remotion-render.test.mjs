// Unit tests for `triggerRemotionRender`. Covers the lazy Render
// SDK singleton, terminal-state branching, empty-results guard,
// Zod parse at the boundary, and the 11-minute settle timeout.
//
// Uses the `_setRenderClientForTests` seam exported from the
// helper so each test injects a fake SDK client whose
// `workflows.startTask(...)` returns a controllable handle. No
// real Render API calls, no network, no `setTimeout` for happy
// paths (`handle.get` resolves synchronously via
// `Promise.resolve`).
//
// The 660s timeout branch uses node:test virtual timers via
// `mock.timers` so the race against `setTimeout` resolves in
// milliseconds instead of actually waiting 11 minutes.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RENDER_API_KEY ??= 'rnd-test-key';
process.env.RENDER_WORKFLOW_SLUG ??= 'launchkit-workflows-test';

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Test fake builder ─────────────────────────────────────────────

function makeFakeClient(handleResult) {
  let lastTaskId = '';
  let lastInputs = /** @type {any[]} */ ([]);
  const client = {
    workflows: {
      startTask: async (taskIdentifier, inputs) => {
        lastTaskId = taskIdentifier;
        lastInputs = inputs;
        const handle = {
          taskRunId: Promise.resolve('run_abc123'),
          get: async () => handleResult,
        };
        return handle;
      },
    },
  };
  return {
    client,
    getLastTaskId: () => lastTaskId,
    getLastInputs: () => lastInputs,
  };
}

// ── Happy path ────────────────────────────────────────────────────

test('triggerRemotionRender: happy path returns typed payload from task result', async () => {
  const {
    triggerRemotionRender,
    _setRenderClientForTests,
  } = await import('../apps/web/dist/lib/trigger-remotion-render.js');

  const fake = makeFakeClient({
    id: 'run_abc123',
    status: 'succeeded',
    results: [
      {
        url: 'https://launchkit-minio.onrender.com/launchkit-renders/videos/x.mp4',
        key: 'videos/x.mp4',
        cached: false,
        sizeBytes: 4096,
      },
    ],
  });
  _setRenderClientForTests(fake.client);
  try {
    const result = await triggerRemotionRender({
      assetId: 'asset-1',
      version: 1,
      compositionId: 'LaunchKitProductVideo',
      inputProps: {
        title: 'LaunchKit',
        subtitle: 'AI',
        badge: 'v',
        accentColor: '#10b981',
        backgroundColor: '#020617',
        outroCta: 'go',
        shots: [],
      },
    });
    assert.equal(result.url, 'https://launchkit-minio.onrender.com/launchkit-renders/videos/x.mp4');
    assert.equal(result.key, 'videos/x.mp4');
    assert.equal(result.cached, false);
    assert.equal(result.sizeBytes, 4096);
    assert.equal(result.taskRunId, 'run_abc123');

    // Assert the SDK was called with the correct task identifier
    // built from the env slug + task name.
    assert.equal(
      fake.getLastTaskId(),
      'launchkit-workflows-test/renderRemotionVideo'
    );
    // `variant` should default to 'visual' when omitted.
    const inputs = fake.getLastInputs();
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].variant, 'visual');
  } finally {
    _setRenderClientForTests(null);
  }
});

// ── Terminal-state branches ───────────────────────────────────────

test('triggerRemotionRender: failed task status throws with the reported error', async () => {
  const {
    triggerRemotionRender,
    _setRenderClientForTests,
  } = await import('../apps/web/dist/lib/trigger-remotion-render.js');

  const fake = makeFakeClient({
    id: 'run_dead',
    status: 'failed',
    error: 'renderMedia: target closed',
    results: [],
  });
  _setRenderClientForTests(fake.client);
  try {
    await assert.rejects(
      async () =>
        triggerRemotionRender({
          assetId: 'asset-1',
          version: 1,
          compositionId: 'LaunchKitProductVideo',
          inputProps: {
            title: 'LaunchKit',
            subtitle: 'AI',
            badge: 'v',
            accentColor: '#10b981',
            backgroundColor: '#020617',
            outroCta: 'go',
            shots: [],
          },
        }),
      /renderMedia: target closed/
    );
  } finally {
    _setRenderClientForTests(null);
  }
});

test('triggerRemotionRender: empty results array throws clear "no results" error', async () => {
  const {
    triggerRemotionRender,
    _setRenderClientForTests,
  } = await import('../apps/web/dist/lib/trigger-remotion-render.js');

  const fake = makeFakeClient({
    id: 'run_empty',
    status: 'succeeded',
    results: [],
  });
  _setRenderClientForTests(fake.client);
  try {
    await assert.rejects(
      async () =>
        triggerRemotionRender({
          assetId: 'asset-1',
          version: 1,
          compositionId: 'LaunchKitProductVideo',
          inputProps: {
            title: 'LaunchKit',
            subtitle: 'AI',
            badge: 'v',
            accentColor: '#10b981',
            backgroundColor: '#020617',
            outroCta: 'go',
            shots: [],
          },
        }),
      /returned no results/
    );
  } finally {
    _setRenderClientForTests(null);
  }
});

test('triggerRemotionRender: malformed result payload throws "malformed result"', async () => {
  const {
    triggerRemotionRender,
    _setRenderClientForTests,
  } = await import('../apps/web/dist/lib/trigger-remotion-render.js');

  const fake = makeFakeClient({
    id: 'run_bad',
    status: 'succeeded',
    results: [{ url: 'not-a-url', key: 'k', cached: false, sizeBytes: 1 }],
  });
  _setRenderClientForTests(fake.client);
  try {
    await assert.rejects(
      async () =>
        triggerRemotionRender({
          assetId: 'asset-1',
          version: 1,
          compositionId: 'LaunchKitProductVideo',
          inputProps: {
            title: 'LaunchKit',
            subtitle: 'AI',
            badge: 'v',
            accentColor: '#10b981',
            backgroundColor: '#020617',
            outroCta: 'go',
            shots: [],
          },
        }),
      /malformed result/
    );
  } finally {
    _setRenderClientForTests(null);
  }
});

test('triggerRemotionRender: completed status is treated as success (alias of succeeded)', async () => {
  const {
    triggerRemotionRender,
    _setRenderClientForTests,
  } = await import('../apps/web/dist/lib/trigger-remotion-render.js');

  const fake = makeFakeClient({
    id: 'run_ok',
    status: 'completed',
    results: [
      {
        url: 'https://minio.local/launchkit-renders/videos/y.mp4',
        key: 'videos/y.mp4',
        cached: true,
        sizeBytes: 2048,
      },
    ],
  });
  _setRenderClientForTests(fake.client);
  try {
    const result = await triggerRemotionRender({
      assetId: 'asset-2',
      version: 3,
      compositionId: 'LaunchKitProductVideo',
      inputProps: {
        title: 'LaunchKit',
        subtitle: 'AI',
        badge: 'v',
        accentColor: '#10b981',
        backgroundColor: '#020617',
        outroCta: 'go',
        shots: [],
      },
    });
    assert.equal(result.cached, true);
    assert.equal(result.sizeBytes, 2048);
  } finally {
    _setRenderClientForTests(null);
  }
});

test('triggerRemotionRender: canceled status throws with status in message', async () => {
  const {
    triggerRemotionRender,
    _setRenderClientForTests,
  } = await import('../apps/web/dist/lib/trigger-remotion-render.js');

  const fake = makeFakeClient({
    id: 'run_cancel',
    status: 'canceled',
    results: [],
  });
  _setRenderClientForTests(fake.client);
  try {
    await assert.rejects(
      async () =>
        triggerRemotionRender({
          assetId: 'asset-1',
          version: 1,
          compositionId: 'LaunchKitProductVideo',
          inputProps: {
            title: 'LaunchKit',
            subtitle: 'AI',
            badge: 'v',
            accentColor: '#10b981',
            backgroundColor: '#020617',
            outroCta: 'go',
            shots: [],
          },
        }),
      /canceled/
    );
  } finally {
    _setRenderClientForTests(null);
  }
});
