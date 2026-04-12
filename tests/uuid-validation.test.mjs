// Tests UUID validation consistency across project and asset routes.
//
// Every route that reads a UUID path param (`:id`, `:projectId`) must
// return 400 on a malformed value BEFORE hitting the database. These
// tests exercise the compiled Hono route apps via `app.request()`.
//
// The UUID check fires first in every handler, so invalid-UUID
// requests never reach Postgres and these tests do not need a live
// database connection. However, the route modules DO connect to
// Postgres and Redis at import time (Drizzle pool + BullMQ client),
// so we guard each test with a try/catch on the dynamic import and
// skip when infrastructure is unavailable.

process.env.DATABASE_URL ??= 'postgresql://launchkit:launchkit@localhost:5433/launchkit';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

const INVALID_ID = 'not-a-uuid';
const VALID_UUID = '00000000-0000-0000-0000-000000000000';

// ── Helper: try to import a route module, skip if infra unavailable ──

async function tryImportRoute(t, modulePath) {
  try {
    return await import(modulePath);
  } catch {
    t.skip(`Module import failed (likely missing Postgres/Redis) — ${modulePath}`);
    return null;
  }
}

// ── Project routes ───────────────────────────────────────────────────

test('GET /api/projects/:id returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/project-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.toLowerCase().includes('uuid'));
});

test('DELETE /api/projects/:id returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/project-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}`, { method: 'DELETE' });
  assert.equal(res.status, 400);
});

test('PATCH /api/projects/:id/webhook returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/project-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}/webhook`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: true }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 400);
});

// ── Asset routes ─────────────────────────────────────────────────────

test('GET /api/assets/:id returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/asset-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}`);
  assert.equal(res.status, 400);
});

test('GET /api/assets/:id/video.mp4 returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/asset-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}/video.mp4`);
  assert.equal(res.status, 400);
});

test('GET /api/assets/:id/audio.mp3 returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/asset-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}/audio.mp3`);
  assert.equal(res.status, 400);
});

test('POST /api/assets/:id/approve returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/asset-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}/approve`, { method: 'POST' });
  assert.equal(res.status, 400);
});

test('POST /api/assets/:id/reject returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/asset-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}/reject`, { method: 'POST' });
  assert.equal(res.status, 400);
});

test('PUT /api/assets/:id/content returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/asset-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}/content`, {
    method: 'PUT',
    body: JSON.stringify({ content: 'test' }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 400);
});

test('POST /api/assets/:id/regenerate returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/asset-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}/regenerate`, {
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 400);
});

test('POST /api/assets/:id/feedback returns 400 on invalid UUID', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/asset-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${INVALID_ID}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ action: 'approved' }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 400);
});

// ── Valid UUID reaches handler (returns 404 not 400) ─────────────────
// This test requires a live Postgres connection because a valid UUID
// passes validation and the handler queries the database.

test('GET /api/assets/:id with valid but nonexistent UUID returns 404 not 400', async (t) => {
  const mod = await tryImportRoute(t, '../apps/web/dist/routes/asset-api-routes.js');
  if (!mod) return;
  const res = await mod.default.request(`/${VALID_UUID}`);
  // If Postgres is down the handler will 500, not 404 — skip in that case.
  if (res.status === 500) {
    t.skip('Postgres not reachable — valid UUID test needs a live database');
    return;
  }
  // 404 = validation passed, handler ran, asset not found
  assert.equal(res.status, 404);
});
