import { config as loadDotenv } from 'dotenv';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shellEnv = { ...process.env };

loadDotenv({
  path: resolve(repoRoot, '.env'),
});

const INFRA_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'MINIO_ENDPOINT_HOST',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
  'MINIO_BUCKET',
];

const childEnv = { ...shellEnv };

for (const key of INFRA_ENV_KEYS) {
  const value = process.env[key];
  if (value !== undefined) {
    childEnv[key] = value;
  }
}

const child = spawn('node', process.argv.slice(2), {
  cwd: repoRoot,
  env: childEnv,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
