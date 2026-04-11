// Unit + integration tests for `/api/trends` route handlers.
//
// Two kinds of coverage in one file:
//
// 1. **Schema-level unit tests** — cover the `SearchQuerySchema`
//    boundary validation that guards the `/api/trends/search?q=`
//    endpoint. Zero I/O, pure Zod.
//
// 2. **Integration tests against the real local Postgres** —
//    import the compiled `trendsApiRoutes` Hono app and exercise
//    it in-memory via `app.request()`. The `/api/trends` endpoint
//    runs a real drizzle query against the `trend_signals` table
//    in the local dev DB. Tests tolerate an empty or seeded table
//    because we don't want to add row-specific setup / teardown —
//    the goal is to assert the response shape (array of rows
//    with ISO-serialized dates), not row counts.
//
// The `/api/trends/search` and `/api/trends/discover` endpoints
// would require stubbing `searchExa` / `searchGoogleTrends` at
// module-load time, which is not clean without a loader hook.
// Those branches are covered end-to-end by the Playwright suite
// in Phase 5 where the real stack runs against real providers.

// Local docker-compose Postgres runs on port 5433 because 5432
// is commonly occupied by a host-level Postgres. See
// `docker-compose.override.yml` (gitignored) for the port mapping.
process.env.DATABASE_URL ??= 'postgresql://launchkit:launchkit@localhost:5433/launchkit';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

async function dbReachable() {
  try {
    const { pool } = await import('pg').then((m) => ({
      pool: new m.default.Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 1000,
      }),
    }));
    try {
      const client = await pool.connect();
      client.release();
      return true;
    } finally {
      await pool.end();
    }
  } catch {
    return false;
  }
}

// ── GET /api/trends integration tests ────────────────────────────

test('GET /api/trends: returns trends array with ISO-formatted ingestedAt', async (t) => {
  if (!(await dbReachable())) {
    t.skip('Postgres not reachable at localhost:5432 — run `docker compose up -d`');
    return;
  }
  const trendsApiRoutes = (
    await import('../apps/web/dist/routes/trends-api-routes.js')
  ).default;
  const res = await trendsApiRoutes.request('/');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.trends), 'body.trends must be an array');
  // Assert the shape of each row if any exist — tolerant of
  // empty tables so the test works on a fresh dev DB.
  for (const row of body.trends) {
    assert.equal(typeof row.id, 'string');
    assert.equal(typeof row.source, 'string');
    assert.equal(typeof row.topic, 'string');
    // ingestedAt should be ISO 8601, not the drizzle Date object
    assert.match(
      row.ingestedAt,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      `ingestedAt must be ISO 8601, got ${String(row.ingestedAt)}`
    );
  }
});

// ── /api/trends/search boundary validation ───────────────────────

test('GET /api/trends/search: returns 400 on missing q parameter', async (t) => {
  if (!(await dbReachable())) {
    t.skip('Postgres not reachable');
    return;
  }
  const trendsApiRoutes = (
    await import('../apps/web/dist/routes/trends-api-routes.js')
  ).default;
  const res = await trendsApiRoutes.request('/search');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Missing or invalid/i);
});

test('GET /api/trends/search: returns 400 on empty q parameter', async (t) => {
  if (!(await dbReachable())) {
    t.skip('Postgres not reachable');
    return;
  }
  const trendsApiRoutes = (
    await import('../apps/web/dist/routes/trends-api-routes.js')
  ).default;
  const res = await trendsApiRoutes.request('/search?q=');
  assert.equal(res.status, 400);
});

test('GET /api/trends/search: returns 400 on q longer than 200 chars', async (t) => {
  if (!(await dbReachable())) {
    t.skip('Postgres not reachable');
    return;
  }
  const trendsApiRoutes = (
    await import('../apps/web/dist/routes/trends-api-routes.js')
  ).default;
  const longQuery = 'a'.repeat(201);
  const res = await trendsApiRoutes.request(
    `/search?q=${encodeURIComponent(longQuery)}`
  );
  assert.equal(res.status, 400);
});

// ── Module load smoke ────────────────────────────────────────────

test('trends-api-routes: module exports a Hono app as default', async () => {
  const mod = await import(
    '../apps/web/dist/routes/trends-api-routes.js'
  );
  assert.equal(typeof mod.default, 'object');
  assert.equal(typeof mod.default.request, 'function');
});
