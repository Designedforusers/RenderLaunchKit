import { z } from 'zod';

/**
 * Typed, validated environment variables for the cron process.
 *
 * See `apps/worker/src/env.ts` for the rationale and the lazy-Proxy
 * pattern. The cron has the smallest env surface — just the
 * datastore credentials and an optional GitHub token for the
 * webhook fallback poller.
 */

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  GITHUB_TOKEN: z.string().optional(),
});

export type CronEnv = z.infer<typeof envSchema>;

let cached: CronEnv | null = null;

function parseEnv(): CronEnv {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(`Invalid cron environment: ${formatted}`);
  }
  cached = result.data;
  return cached;
}

/**
 * Lazy proxy over the parsed env. See `apps/worker/src/env.ts` for
 * the rationale and the symbol-guard explanation.
 */
export const env: CronEnv = new Proxy({} as CronEnv, {
  get(_target, key) {
    if (typeof key !== 'string') return undefined;
    return parseEnv()[key as keyof CronEnv];
  },
  set(_target, key) {
    throw new TypeError(
      `env is read-only; cannot assign to \`${String(key)}\``
    );
  },
  deleteProperty(_target, key) {
    throw new TypeError(
      `env is read-only; cannot delete \`${String(key)}\``
    );
  },
});
