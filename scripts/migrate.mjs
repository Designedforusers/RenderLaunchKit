import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const migrationsDir = path.resolve(process.cwd(), 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT id FROM schema_migrations');
  return new Set(result.rows.map((row) => row.id));
}

async function getMigrationFiles() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

async function applyMigration(client, filename) {
  const filePath = path.join(migrationsDir, filename);
  const sql = await readFile(filePath, 'utf-8');

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    console.log(`Applied migration ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files = await getMigrationFiles();

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`Skipping migration ${filename} (already applied)`);
        continue;
      }

      await applyMigration(client, filename);
    }

    console.log('Migration run complete');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
