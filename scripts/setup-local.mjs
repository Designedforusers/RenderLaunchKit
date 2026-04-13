import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

loadDotenv({
  path: resolve(repoRoot, '.env'),
});

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'null'}`));
    });
  });
}

function parsePortFromUrl(value, fallbackPort, label) {
  if (!value) {
    return fallbackPort;
  }

  try {
    const url = new URL(value);
    return url.port || fallbackPort;
  } catch (error) {
    throw new Error(`${label} must be a valid URL. Received: ${value}`, { cause: error });
  }
}

function parsePortFromHost(value, fallbackPort, label) {
  if (!value) {
    return fallbackPort;
  }

  const normalized = value.includes('://') ? value : `http://${value}`;

  try {
    const url = new URL(normalized);
    return url.port || fallbackPort;
  } catch (error) {
    throw new Error(`${label} must be a valid host[:port]. Received: ${value}`, { cause: error });
  }
}

async function main() {
  const postgresPort = parsePortFromUrl(
    process.env.DATABASE_URL,
    '5432',
    'DATABASE_URL',
  );
  const redisPort = parsePortFromUrl(
    process.env.REDIS_URL,
    '6379',
    'REDIS_URL',
  );
  const minioPort = parsePortFromHost(
    process.env.MINIO_ENDPOINT_HOST,
    '9000',
    'MINIO_ENDPOINT_HOST',
  );

  await runCommand('npm', ['run', 'infra:up']);
  await runCommand('npx', [
    'wait-on',
    `tcp:127.0.0.1:${postgresPort}`,
    `tcp:127.0.0.1:${redisPort}`,
    `tcp:127.0.0.1:${minioPort}`,
    '--timeout',
    '30000',
  ]);
  await runCommand('npm', ['run', 'db:migrate']);
  await runCommand('npm', ['run', 'seed']);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
