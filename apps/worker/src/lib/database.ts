import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';

/**
 * Shared Postgres pool and drizzle instance for the worker process.
 *
 * Every processor used to construct its own `pg.Pool` and `drizzle()`
 * binding, which created N copies per worker (one per file) and burned
 * connection slots three times faster than necessary. This module is the
 * single source of truth — every processor imports `database` from here.
 *
 * Pool size is conservative for the worker since BullMQ concurrency is
 * already capped per queue in `QUEUE_CONFIG`.
 */
export const databasePool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const database = drizzle(databasePool, { schema });
