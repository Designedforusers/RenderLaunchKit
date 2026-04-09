import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import { env } from '../env.js';

/**
 * Shared Postgres pool and drizzle instance for the workflows process.
 *
 * Parallel to `apps/worker/src/lib/database.ts` — same shape, different
 * process. Each task run spins up on its own Render instance, so the
 * pool is scoped to that one instance's lifetime. A smaller `max` than
 * the worker's pool (10) is fine because each task run typically only
 * executes 3–5 statements (read asset, read project, read insights,
 * write result).
 */
export const databasePool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const database = drizzle(databasePool, { schema });
