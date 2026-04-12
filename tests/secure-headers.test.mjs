// Verifies that security headers are present on responses from the
// Hono `secureHeaders()` middleware. Constructs a minimal app with
// the same middleware stack as `apps/web/src/index.ts` to avoid
// importing the full server (which connects to Postgres/Redis).

import test from 'node:test';
import assert from 'node:assert/strict';

test('secureHeaders middleware sets X-Content-Type-Options: nosniff', async () => {
  const { Hono } = await import('hono');
  const { secureHeaders } = await import('hono/secure-headers');

  const app = new Hono();
  app.use('*', secureHeaders());
  app.get('/health', (c) => c.json({ status: 'ok' }));

  const res = await app.request('/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('secureHeaders middleware sets X-Frame-Options: SAMEORIGIN', async () => {
  const { Hono } = await import('hono');
  const { secureHeaders } = await import('hono/secure-headers');

  const app = new Hono();
  app.use('*', secureHeaders());
  app.get('/health', (c) => c.json({ status: 'ok' }));

  const res = await app.request('/health');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
});

test('secureHeaders middleware sets Strict-Transport-Security', async () => {
  const { Hono } = await import('hono');
  const { secureHeaders } = await import('hono/secure-headers');

  const app = new Hono();
  app.use('*', secureHeaders());
  app.get('/health', (c) => c.json({ status: 'ok' }));

  const res = await app.request('/health');
  const hsts = res.headers.get('strict-transport-security');
  assert.ok(hsts, 'Strict-Transport-Security header must be present');
  assert.ok(hsts.includes('max-age='), 'HSTS must include max-age directive');
});
