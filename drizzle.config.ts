// Load `.env` from the repo root before drizzle-kit reads
// `process.env.DATABASE_URL` below. Drizzle-kit invokes its own
// command (`npm run db:push`, `npm run db:studio`) from the repo
// root, so `dotenv/config`'s default `process.cwd()` lookup finds
// the file correctly without needing an explicit path. Without
// this load, every drizzle-kit invocation would crash with
// "DATABASE_URL: undefined" unless the operator first sourced
// `.env` into their shell.
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './packages/shared/src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
