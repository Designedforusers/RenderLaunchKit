// Tests the project re-run behavior: terminal-state projects
// (complete/failed) are deleted and recreated when the same repo
// URL is submitted again. In-progress projects return 200 with a
// message. Requires live Postgres + Redis.

process.env.DATABASE_URL ??= 'postgresql://launchkit:launchkit@localhost:5432/launchkit';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

async function dbReachable() {
  try {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 1000,
    });
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

test('POST /api/projects returns 200 for in-progress duplicate', async (t) => {
  if (!(await dbReachable())) {
    t.skip('Postgres not reachable — run `npm run infra:up`');
    return;
  }

  let mod;
  try {
    mod = await import('../apps/web/dist/routes/project-api-routes.js');
  } catch {
    t.skip('project-api-routes import failed (missing infra)');
    return;
  }

  const testUrl = `https://github.com/test-owner/rerun-test-${Date.now()}`;

  // First request: creates the project (201)
  const res1 = await mod.default.request('/', {
    method: 'POST',
    body: JSON.stringify({ repoUrl: testUrl }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res1.status, 201, 'First submission should create project');
  const body1 = await res1.json();
  assert.ok(body1.id, 'Response must include project ID');

  // Second request: same URL while project is in-progress (200)
  const res2 = await mod.default.request('/', {
    method: 'POST',
    body: JSON.stringify({ repoUrl: testUrl }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res2.status, 200, 'Duplicate in-progress should return 200');
  const body2 = await res2.json();
  assert.equal(body2.id, body1.id, 'Should return the same project');
  assert.ok(body2.message?.includes('in progress'), 'Response should indicate in-progress');

  // Cleanup
  await mod.default.request(`/${body1.id}`, { method: 'DELETE' });
});

test('POST /api/projects re-runs terminal-state (complete) project', async (t) => {
  if (!(await dbReachable())) {
    t.skip('Postgres not reachable — run `npm run infra:up`');
    return;
  }

  let mod, db, projectsTable, eq;
  try {
    mod = await import('../apps/web/dist/routes/project-api-routes.js');
    const dbMod = await import('../apps/web/dist/lib/database.js');
    const sharedMod = await import('../packages/shared/dist/index.js');
    const drizzle = await import('drizzle-orm');
    db = dbMod.database;
    projectsTable = sharedMod.projects;
    eq = drizzle.eq;
  } catch {
    t.skip('Module import failed (missing infra)');
    return;
  }

  const testUrl = `https://github.com/test-owner/rerun-terminal-${Date.now()}`;

  // Create project
  const res1 = await mod.default.request('/', {
    method: 'POST',
    body: JSON.stringify({ repoUrl: testUrl }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res1.status, 201);
  const body1 = await res1.json();
  const firstId = body1.id;

  // Manually set status to 'complete' (simulates finished pipeline)
  await db
    .update(projectsTable)
    .set({ status: 'complete', updatedAt: new Date() })
    .where(eq(projectsTable.id, firstId));

  // Re-submit same URL — should delete old and create new (201)
  const res2 = await mod.default.request('/', {
    method: 'POST',
    body: JSON.stringify({ repoUrl: testUrl }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res2.status, 201, 'Terminal-state project should allow re-run');
  const body2 = await res2.json();
  assert.notEqual(body2.id, firstId, 'New project should have a different ID');

  // Cleanup
  await mod.default.request(`/${body2.id}`, { method: 'DELETE' });
});
