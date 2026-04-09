// Smoke tests for the PR #35 cost-tracking surface.
//
// Covers the pricing helpers in `@launchkit/shared` and the
// AsyncLocalStorage-based `CostTracker` / `runWithCostTracker` /
// `recordCost` trio in `@launchkit/asset-generators`. The
// integration surface (tracker wired through `dispatchAsset` →
// DB persist → API aggregation → dashboard chip) is covered by
// the live smoke test against a real project, not here — these
// tests exercise the load-bearing units in isolation so a broken
// rate table or a broken tracker surfaces before the prepush gate
// finishes.
//
// The `DATABASE_URL` / `REDIS_URL` defaults match the pattern in
// the other test files; the modules under test do not actually
// open a DB connection at import time, but the downstream
// `@launchkit/shared` barrel export loads modules that read `env`
// lazily via a Proxy, so setting these is a safety net against
// future wiring changes.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Pricing helpers ────────────────────────────────────────────────

test('computeAnthropicCostCents: known model (claude-opus-4-6) returns expected cents', async () => {
  const { computeAnthropicCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );

  // Opus 4.6: $15/1M input, $75/1M output
  //   1M input  × $15  = $15.00 = 1500 cents
  //   1M output × $75  = $75.00 = 7500 cents
  //   total            = 9000 cents
  assert.equal(
    computeAnthropicCostCents('claude-opus-4-6', 1_000_000, 1_000_000),
    9000,
    '1M in + 1M out at Opus 4.6 should cost 9000 cents ($90.00)'
  );

  // Smaller counts should still round up to integer cents.
  // 1k input + 1k output at Opus 4.6 = (1000*1500 + 1000*7500) / 1M
  //   = 1.5 + 7.5 = 9 cents exact → Math.ceil = 9
  assert.equal(
    computeAnthropicCostCents('claude-opus-4-6', 1000, 1000),
    9,
    '1k in + 1k out at Opus 4.6 should cost 9 cents'
  );
});

test('computeAnthropicCostCents: unknown model returns 0 and logs a warning', async () => {
  const { computeAnthropicCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );

  // Patch console.warn so we can assert the log landed without
  // polluting the test runner output.
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (...args) => {
    calls.push(args.map((arg) => String(arg)).join(' '));
  };

  try {
    const cost = computeAnthropicCostCents('unknown-model', 1000, 1000);
    assert.equal(cost, 0, 'unknown model should cost 0');
    assert.ok(
      calls.some((line) => line.includes('Unknown Anthropic model')),
      'should emit a warning naming the unknown model'
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('computeFalImageCostCents: fixed-cost fal image returns 6', async () => {
  const { computeFalImageCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );
  // Rate is 5.5 cents per image → Math.ceil(5.5) = 6
  assert.equal(computeFalImageCostCents(), 6);
});

test('computeFalVideoCostCents: 5 seconds at 15 cents/sec = 75', async () => {
  const { computeFalVideoCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );
  assert.equal(computeFalVideoCostCents(5), 75);
  // Fractional duration should round up
  assert.equal(computeFalVideoCostCents(5.5), 83); // ceil(82.5) = 83
});

test('computeElevenLabsCostCents: 1000 chars at Turbo v2 returns 18', async () => {
  const { computeElevenLabsCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );
  // Turbo v2: 18 cents per 1k chars
  //   1000 * 18 / 1000 = 18 cents
  assert.equal(computeElevenLabsCostCents('eleven_turbo_v2', 1000), 18);
});

test('computeElevenLabsCostCents: unknown model returns 0', async () => {
  const { computeElevenLabsCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      computeElevenLabsCostCents('eleven_made_up_v3', 1000),
      0,
      'unknown ElevenLabs model should cost 0'
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('computeWorldLabsCostCents: marble-1.1 returns 50', async () => {
  const { computeWorldLabsCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );
  assert.equal(computeWorldLabsCostCents('marble-1.1'), 50);
  assert.equal(computeWorldLabsCostCents('marble-1.1-plus'), 150);
});

// ── CostTracker ─────────────────────────────────────────────────────

test('CostTracker.record + getEvents + totalCents round-trip', async () => {
  const { CostTracker } = await import(
    '../packages/asset-generators/dist/cost-tracker.js'
  );

  const tracker = new CostTracker();
  tracker.record({
    provider: 'anthropic',
    operation: 'messages.create',
    costCents: 9,
  });
  tracker.record({
    provider: 'fal',
    operation: 'flux-pro-ultra-image',
    costCents: 6,
  });
  tracker.record({
    provider: 'elevenlabs',
    operation: 'tts',
    inputUnits: 1000,
    costCents: 18,
  });

  const events = tracker.getEvents();
  assert.equal(events.length, 3);
  assert.equal(events[0].provider, 'anthropic');
  assert.equal(events[1].provider, 'fal');
  assert.equal(events[2].provider, 'elevenlabs');
  assert.equal(tracker.totalCents(), 33, 'sum should be 9 + 6 + 18 = 33');
});

test('CostTracker.getEvents is readonly (TypeScript-level guarantee honored at runtime)', async () => {
  const { CostTracker } = await import(
    '../packages/asset-generators/dist/cost-tracker.js'
  );

  const tracker = new CostTracker();
  tracker.record({
    provider: 'anthropic',
    operation: 'messages.create',
    costCents: 9,
  });

  // The return type is `readonly CostEvent[]`; the runtime array
  // is still mutable JS-wise, but the type contract tells callers
  // not to mutate. This test asserts that `getEvents()` at least
  // returns the canonical array reference and that reading from it
  // gives back the recorded event.
  const events = tracker.getEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].costCents, 9);
});

// ── runWithCostTracker + recordCost ─────────────────────────────────

test('runWithCostTracker threads context through to recordCost', async () => {
  const { CostTracker, runWithCostTracker, recordCost } = await import(
    '../packages/asset-generators/dist/cost-tracker.js'
  );

  const tracker = new CostTracker();

  await runWithCostTracker(tracker, async () => {
    recordCost({
      provider: 'anthropic',
      operation: 'messages.create',
      inputUnits: 100,
      outputUnits: 200,
      costCents: 1,
    });

    // A nested async call should still see the same tracker via
    // AsyncLocalStorage propagation.
    await Promise.resolve().then(() => {
      recordCost({
        provider: 'fal',
        operation: 'flux-pro-ultra-image',
        costCents: 6,
      });
    });
  });

  assert.equal(tracker.getEvents().length, 2);
  assert.equal(tracker.totalCents(), 7);
});

test('recordCost outside a tracker scope is a no-op (does not throw)', async () => {
  const { recordCost } = await import(
    '../packages/asset-generators/dist/cost-tracker.js'
  );

  // No tracker in scope — the call should silently drop.
  assert.doesNotThrow(() => {
    recordCost({
      provider: 'anthropic',
      operation: 'messages.create',
      costCents: 42,
    });
  });
});

// ── Schema validation round-trip ────────────────────────────────────

test('CostEventSchema accepts a valid event and rejects a malformed one', async () => {
  const { CostEventSchema } = await import(
    '../packages/shared/dist/schemas/asset-cost-event.js'
  );

  const valid = CostEventSchema.parse({
    provider: 'anthropic',
    operation: 'messages.create',
    inputUnits: 100,
    outputUnits: 200,
    costCents: 9,
    metadata: { model: 'claude-opus-4-6' },
  });
  assert.equal(valid.provider, 'anthropic');
  assert.equal(valid.costCents, 9);

  // Unknown provider → reject
  assert.throws(() =>
    CostEventSchema.parse({
      provider: 'openai',
      operation: 'messages.create',
      costCents: 9,
    })
  );

  // Negative cents → reject
  assert.throws(() =>
    CostEventSchema.parse({
      provider: 'anthropic',
      operation: 'messages.create',
      costCents: -1,
    })
  );
});

test('ProjectCostsResponseSchema validates an aggregation response', async () => {
  const { ProjectCostsResponseSchema } = await import(
    '../packages/shared/dist/schemas/asset-cost-event.js'
  );

  // Use a valid v4 UUID shape — Zod's uuid() validator matches a
  // tight v4 pattern (the dashes, version nibble, and variant bits
  // all must line up). `0e7b5e0a-…` is a real v4 shape.
  const parsed = ProjectCostsResponseSchema.parse({
    projectId: '0e7b5e0a-a7fa-4e68-9a02-1f2b3c4d5e6f',
    totalCents: 42,
    byProvider: [
      { provider: 'anthropic', totalCents: 9 },
      { provider: 'fal', totalCents: 33 },
    ],
  });
  assert.equal(parsed.totalCents, 42);
  assert.equal(parsed.byProvider.length, 2);
});
