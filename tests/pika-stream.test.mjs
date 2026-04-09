// Smoke tests for the Pika video-meeting integration.
//
// These tests do not hit the upstream API or burn Pika credits —
// they exercise the load-bearing units of the integration (Zod
// schemas, cost pricing, subprocess exit-code → error class
// mapping, and the per-project system prompt builder) so a
// regression surfaces before the prepush gate finishes.
//
// A real end-to-end test against the Pika API requires a funded
// Developer Key, a live Google Meet, and ~90 seconds per join; that
// is a manual deploy-time integration check, not this file.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Pricing helpers ─────────────────────────────────────────────────

test('computePikaMeetingCostCents: 60s at $0.275/min = 28 cents (ceil)', async () => {
  const { computePikaMeetingCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );
  // 60 seconds = 1 minute × 27.5 cents = 27.5 → ceil → 28
  assert.equal(computePikaMeetingCostCents(60), 28);
});

test('computePikaMeetingCostCents: 0s returns 0 (never-started guard)', async () => {
  const { computePikaMeetingCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );
  assert.equal(computePikaMeetingCostCents(0), 0);
});

test('computePikaMeetingCostCents: negative duration returns 0', async () => {
  const { computePikaMeetingCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );
  // Shouldn't happen in practice, but a negative duration from a
  // clock skew between insert and leave must never produce a
  // negative cost.
  assert.equal(computePikaMeetingCostCents(-30), 0);
});

test('computePikaMeetingCostCents: 5 minutes lands at the documented $1.375 ≈ 138 cents', async () => {
  const { computePikaMeetingCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );
  // 5 minutes × 27.5 = 137.5 → ceil → 138 cents
  assert.equal(computePikaMeetingCostCents(5 * 60), 138);
});

test('computePikaMeetingCostCents: 30-minute ceiling lands at 825 cents', async () => {
  const { computePikaMeetingCostCents } = await import(
    '../packages/shared/dist/pricing.js'
  );
  // 30 minutes × 27.5 = 825 cents exactly
  assert.equal(computePikaMeetingCostCents(30 * 60), 825);
});

// ── Zod schemas at the subprocess boundary ───────────────────────────

test('PikaSessionUpdateSchema parses the initial "created" line from join', async () => {
  const { PikaSessionUpdateSchema } = await import(
    '../packages/shared/dist/schemas/pika.js'
  );
  // Verbatim from vendor/pikastream-video-meeting/scripts/
  // pikastreaming_videomeeting.py:288.
  const created = {
    session_id: 'sess_01HF2X8NZK3Q2W5VJ1R4T8P6YB',
    platform: 'google_meet',
    status: 'created',
  };
  const result = PikaSessionUpdateSchema.safeParse(created);
  assert.equal(result.success, true);
  assert.equal(result.data.session_id, 'sess_01HF2X8NZK3Q2W5VJ1R4T8P6YB');
  assert.equal(result.data.status, 'created');
  assert.equal(result.data.platform, 'google_meet');
});

test('PikaSessionUpdateSchema parses the terminal "ready" progress line', async () => {
  const { PikaSessionUpdateSchema } = await import(
    '../packages/shared/dist/schemas/pika.js'
  );
  // Verbatim from pikastreaming_videomeeting.py:310 — the poll
  // loop prints this shape on every status change.
  const ready = {
    session_id: 'sess_01HF2X8NZK3Q2W5VJ1R4T8P6YB',
    status: 'ready',
    video: true,
    bot: true,
  };
  const result = PikaSessionUpdateSchema.safeParse(ready);
  assert.equal(result.success, true);
  assert.equal(result.data.video, true);
  assert.equal(result.data.bot, true);
});

test('PikaSessionUpdateSchema rejects a line missing session_id', async () => {
  const { PikaSessionUpdateSchema } = await import(
    '../packages/shared/dist/schemas/pika.js'
  );
  const malformed = { status: 'ready', video: true, bot: true };
  const result = PikaSessionUpdateSchema.safeParse(malformed);
  assert.equal(result.success, false);
});

test('PikaLeaveResponseSchema parses the leave success line', async () => {
  const { PikaLeaveResponseSchema } = await import(
    '../packages/shared/dist/schemas/pika.js'
  );
  // Verbatim from pikastreaming_videomeeting.py:572.
  const leaveOk = {
    session_id: 'sess_01HF2X8NZK3Q2W5VJ1R4T8P6YB',
    closed: true,
  };
  const result = PikaLeaveResponseSchema.safeParse(leaveOk);
  assert.equal(result.success, true);
});

test('PikaLeaveResponseSchema rejects closed=false (structural fail)', async () => {
  const { PikaLeaveResponseSchema } = await import(
    '../packages/shared/dist/schemas/pika.js'
  );
  // The leave subcommand only emits the terminal line on exit 0,
  // and the Python source hardcodes `"closed": True`. A `false`
  // here means the upstream contract has drifted — we want the
  // schema to fail loudly rather than silently accepting a
  // non-terminal response.
  const malformed = {
    session_id: 'sess_01HF2X8NZK3Q2W5VJ1R4T8P6YB',
    closed: false,
  };
  const result = PikaLeaveResponseSchema.safeParse(malformed);
  assert.equal(result.success, false);
});

test('PikaNeedsTopupPayloadSchema parses the insufficient-credits payload', async () => {
  const { PikaNeedsTopupPayloadSchema } = await import(
    '../packages/shared/dist/schemas/pika.js'
  );
  // Verbatim from pikastreaming_videomeeting.py:182-189.
  const payload = {
    status: 'needs_topup',
    balance: 0,
    product: 'Starter Pack',
    credits: 1000,
    checkout_url: 'https://pika.me/checkout/abc123',
    message: 'Open the checkout URL to purchase Starter Pack. Waiting for payment...',
  };
  const result = PikaNeedsTopupPayloadSchema.safeParse(payload);
  assert.equal(result.success, true);
  assert.equal(result.data.checkout_url, 'https://pika.me/checkout/abc123');
});

test('PikaExitCodeSchema accepts every documented code and rejects others', async () => {
  const { PikaExitCodeSchema } = await import(
    '../packages/shared/dist/schemas/pika.js'
  );
  for (const code of [0, 1, 2, 3, 4, 5, 6]) {
    assert.equal(
      PikaExitCodeSchema.safeParse(code).success,
      true,
      `exit code ${code} must be valid`
    );
  }
  assert.equal(PikaExitCodeSchema.safeParse(7).success, false);
  assert.equal(PikaExitCodeSchema.safeParse(-1).success, false);
  assert.equal(PikaExitCodeSchema.safeParse('0').success, false);
});

test('PikaSessionStatusSchema enforces the six-state lifecycle', async () => {
  const { PikaSessionStatusSchema } = await import(
    '../packages/shared/dist/schemas/pika.js'
  );
  for (const status of [
    'pending',
    'joining',
    'active',
    'ending',
    'ended',
    'failed',
  ]) {
    assert.equal(PikaSessionStatusSchema.safeParse(status).success, true);
  }
  assert.equal(PikaSessionStatusSchema.safeParse('closed').success, false);
  assert.equal(PikaSessionStatusSchema.safeParse('').success, false);
});

test('PikaInviteRequestSchema requires a URL-shaped meetUrl', async () => {
  const { PikaInviteRequestSchema } = await import(
    '../packages/shared/dist/schemas/pika.js'
  );
  assert.equal(
    PikaInviteRequestSchema.safeParse({
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    }).success,
    true
  );
  assert.equal(
    PikaInviteRequestSchema.safeParse({ meetUrl: 'not a url' }).success,
    false
  );
  assert.equal(
    PikaInviteRequestSchema.safeParse({
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      botName: 'LaunchKit Teammate',
    }).success,
    true
  );
});

// ── Subprocess wrapper: exit code → error class mapping ─────────────

test('mapExitCodeToError maps every documented exit code to its typed error class', async () => {
  const {
    mapExitCodeToError,
    PikaMissingKeyError,
    PikaValidationError,
    PikaHttpError,
    PikaSessionError,
    PikaTimeoutError,
    PikaInsufficientCreditsError,
    PikaSubprocessError,
  } = await import('../apps/worker/dist/lib/pika-stream.js');

  const ctx = { stdout: '', stderr: '', checkoutUrl: null };

  assert.ok(
    mapExitCodeToError(1, 'missing key', ctx) instanceof PikaMissingKeyError,
    'exit 1 → PikaMissingKeyError'
  );
  assert.ok(
    mapExitCodeToError(2, 'bad input', ctx) instanceof PikaValidationError,
    'exit 2 → PikaValidationError'
  );
  assert.ok(
    mapExitCodeToError(3, 'http', ctx) instanceof PikaHttpError,
    'exit 3 → PikaHttpError'
  );
  assert.ok(
    mapExitCodeToError(4, 'session', ctx) instanceof PikaSessionError,
    'exit 4 → PikaSessionError'
  );
  assert.ok(
    mapExitCodeToError(5, 'timeout', ctx) instanceof PikaTimeoutError,
    'exit 5 → PikaTimeoutError'
  );
  assert.ok(
    mapExitCodeToError(6, 'credits', ctx) instanceof
      PikaInsufficientCreditsError,
    'exit 6 → PikaInsufficientCreditsError'
  );

  // Unknown exit code falls back to the base class (not null, not
  // thrown) so the caller always has a structured failure.
  const unknown = mapExitCodeToError(99, 'mystery', ctx);
  assert.ok(unknown instanceof PikaSubprocessError);
  assert.equal(unknown.exitCode, 99);
});

test('PikaInsufficientCreditsError carries the checkout_url through the mapper', async () => {
  const { mapExitCodeToError, PikaInsufficientCreditsError } = await import(
    '../apps/worker/dist/lib/pika-stream.js'
  );
  const err = mapExitCodeToError(6, 'credits', {
    stdout: '',
    stderr: '',
    checkoutUrl: 'https://pika.me/checkout/abc123',
  });
  assert.ok(err instanceof PikaInsufficientCreditsError);
  assert.equal(err.checkoutUrl, 'https://pika.me/checkout/abc123');
});

test('every Pika error class preserves stderr / stdout / exitCode for triage', async () => {
  const { mapExitCodeToError } = await import(
    '../apps/worker/dist/lib/pika-stream.js'
  );
  const err = mapExitCodeToError(3, 'HTTP 500', {
    stdout: '{"session_id":"x","status":"created"}\n',
    stderr: 'Error: HTTP 500: internal server error\n',
    checkoutUrl: null,
  });
  assert.equal(err.exitCode, 3);
  assert.match(err.stdout, /session_id/);
  assert.match(err.stderr, /HTTP 500/);
});

// ── Per-project system prompt builder ───────────────────────────────

test('buildPikaSystemPrompt produces a minimal prompt from a bare project', async () => {
  const { buildPikaSystemPrompt } = await import(
    '../apps/worker/dist/lib/pika-system-prompt-builder.js'
  );
  const prompt = buildPikaSystemPrompt({
    project: {
      repoOwner: 'excalidraw',
      repoName: 'excalidraw',
      repoUrl: 'https://github.com/excalidraw/excalidraw',
      repoAnalysis: null,
      research: null,
      strategy: null,
    },
    assets: [],
    botName: 'Excalidraw Teammate',
  });
  assert.match(prompt, /Excalidraw Teammate/);
  assert.match(prompt, /excalidraw\/excalidraw/);
  assert.match(prompt, /Repo URL: https:\/\/github\.com\/excalidraw\/excalidraw/);
});

test('buildPikaSystemPrompt includes repo facts when repoAnalysis parses', async () => {
  const { buildPikaSystemPrompt } = await import(
    '../apps/worker/dist/lib/pika-system-prompt-builder.js'
  );
  const prompt = buildPikaSystemPrompt({
    project: {
      repoOwner: 'bun',
      repoName: 'bun',
      repoUrl: 'https://github.com/oven-sh/bun',
      repoAnalysis: {
        readme: '# Bun\n\nA fast JavaScript runtime.',
        description: 'A fast JavaScript runtime built with Zig.',
        language: 'Zig',
        techStack: ['Zig', 'JavaScriptCore', 'C++'],
        framework: null,
        stars: 70000,
        forks: 2500,
        topics: ['javascript', 'runtime'],
        license: 'MIT',
        hasTests: true,
        hasCi: true,
        recentCommits: [
          {
            sha: 'abc123',
            message: 'feat: faster startup',
            date: '2026-04-08',
            author: 'jarred',
          },
        ],
        fileTree: ['src/', 'packages/'],
        packageDeps: {},
        category: 'devtool',
      },
      research: null,
      strategy: null,
    },
    assets: [],
    botName: 'Bun Teammate',
  });
  assert.match(prompt, /A fast JavaScript runtime built with Zig/);
  assert.match(prompt, /Zig/);
  assert.match(prompt, /jarred: feat: faster startup/);
});

test('buildPikaSystemPrompt caps output at 4 KB even with a huge readme', async () => {
  const { buildPikaSystemPrompt } = await import(
    '../apps/worker/dist/lib/pika-system-prompt-builder.js'
  );
  const huge = 'x'.repeat(200);
  const assets = Array.from({ length: 50 }, (_, i) => ({
    type: 'blog_post',
    content: huge + ` asset ${i}`,
    metadata: { title: `Title ${i} ${huge}` },
  }));
  const prompt = buildPikaSystemPrompt({
    project: {
      repoOwner: 'foo',
      repoName: 'bar',
      repoUrl: 'https://github.com/foo/bar',
      repoAnalysis: {
        readme: huge.repeat(50),
        description: huge,
        language: 'TypeScript',
        techStack: Array.from({ length: 20 }, (_, i) => `tool-${i}-${huge}`),
        framework: null,
        stars: 1,
        forks: 0,
        topics: [],
        license: null,
        hasTests: false,
        hasCi: false,
        recentCommits: Array.from({ length: 20 }, (_, i) => ({
          sha: `sha${i}`,
          message: `commit ${i} ${huge}`,
          date: '2026-04-01',
          author: `author${i}`,
        })),
        fileTree: [],
        packageDeps: {},
        category: 'web_app',
      },
      research: null,
      strategy: null,
    },
    assets,
    botName: 'Foo Bot',
  });
  // 4 KB cap enforced by MAX_PROMPT_BYTES in the builder.
  assert.ok(
    Buffer.byteLength(prompt, 'utf-8') <= 4 * 1024,
    `prompt exceeded 4 KB cap: ${Buffer.byteLength(prompt, 'utf-8')} bytes`
  );
  // Header + core facts are load-bearing and must never be
  // dropped by the cap logic.
  assert.match(prompt, /Foo Bot/);
  assert.match(prompt, /foo\/bar/);
});

test('buildPikaSystemPrompt degrades gracefully when repoAnalysis fails Zod parse', async () => {
  const { buildPikaSystemPrompt } = await import(
    '../apps/worker/dist/lib/pika-system-prompt-builder.js'
  );
  // Deliberately wrong shape — a string where an object is
  // expected. The builder must not throw; the section just gets
  // omitted.
  const prompt = buildPikaSystemPrompt({
    project: {
      repoOwner: 'tldraw',
      repoName: 'tldraw',
      repoUrl: 'https://github.com/tldraw/tldraw',
      repoAnalysis: 'not an object at all',
      research: null,
      strategy: null,
    },
    assets: [],
    botName: 'Tldraw Bot',
  });
  assert.match(prompt, /Tldraw Bot/);
  // No repoAnalysis-specific facts should be present.
  assert.ok(!/Primary language/.test(prompt));
});
