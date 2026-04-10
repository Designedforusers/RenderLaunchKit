import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import { env } from './env.js';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
export const database = drizzle(pool, { schema });
