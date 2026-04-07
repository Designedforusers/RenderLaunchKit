import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const database = drizzle(pool, { schema });

export { pool as databasePool };
