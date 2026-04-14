// Tests the auth middleware boundary: 401 on missing/wrong tokens
// when API_KEY is set, pass-through when unset.
//
// Constructs a minimal Hono app with the auth middleware wired in,
// so these tests need no database or Redis connection.

// The auth middleware reads `env.API_KEY`, which triggers the lazy
// env proxy to validate the whole web env schema — including
// DATABASE_URL. That field is `z.string().min(1)` with no default,
// so without a dummy value the first `env.API_KEY` access throws
// and the test file fails to run in CI (where DATABASE_URL is
// unset). Matches the pattern already used by every other test
// that imports web-process modules.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';

import test from 'node:test';
import assert from 'node:assert/strict';

// Set the API_KEY before any auth module import so the lazy env
// proxy picks it up. Cleaned up in the `after` hook so subsequent
// test files in the same process don't see a stale key.
process.env.API_KEY = 'test-secret-key';
test.after(() => { delete process.env.API_KEY; });

test('auth middleware: rejects missing Authorization header when API_KEY is set', async () => {
  const { Hono } = await import('hono');
  const { authMiddleware } = await import(
    '../apps/web/dist/middleware/auth.js'
  );

  const app = new Hono();
  app.use('*', authMiddleware);
  app.get('/test', (c) => c.json({ ok: true }));

  const res = await app.request('/test');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.error.toLowerCase().includes('authorization'));
});

test('auth middleware: rejects wrong Bearer token when API_KEY is set', async () => {
  const { Hono } = await import('hono');
  const { authMiddleware } = await import(
    '../apps/web/dist/middleware/auth.js'
  );

  const app = new Hono();
  app.use('*', authMiddleware);
  app.get('/test', (c) => c.json({ ok: true }));

  const res = await app.request('/test', {
    headers: { Authorization: 'Bearer wrong-key' },
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(body.error.toLowerCase().includes('invalid'));
});

test('auth middleware: accepts correct Bearer token when API_KEY is set', async () => {
  const { Hono } = await import('hono');
  const { authMiddleware } = await import(
    '../apps/web/dist/middleware/auth.js'
  );

  const app = new Hono();
  app.use('*', authMiddleware);
  app.get('/test', (c) => c.json({ ok: true }));

  const res = await app.request('/test', {
    headers: { Authorization: 'Bearer test-secret-key' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
});
