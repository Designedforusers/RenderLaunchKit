import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

// ── .env loading ──────────────────────────────────────────────────
//
// Load `.env` from the repo root at module-init time so every
// downstream `env.X` access in this process sees the populated
// environment. See `apps/worker/src/env.ts` for the full rationale —
// the short version is that ESM hoisting means the dotenv call has
// to live in the env module itself (not the entry point) to fire
// before any importer's top-level code reads `env.X`. The path is
// computed from `import.meta.url` because `npm run dev -w apps/cron`
// sets the cwd to `apps/cron/`, where there is no `.env`. Walking up
// three directories from this file lands at the repo root in both
// `src/` (tsx watch) and `dist/` (compiled). On Render itself there
// is no `.env` file and `dotenv` silently no-ops; production env
// vars are injected by the Render dashboard at service start.
loadDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../..', '.env'),
});

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
  // Anthropic credentials. Optional because the cron's primary work
  // (sync, ingest, cleanup, aggregation) does not require an LLM call —
  // every Anthropic-using path inside the cron self-skips when the
  // key is unset and falls back to a placeholder string instead. The
  // current consumer is the Phase 7 Layer 3 cluster-summary upgrade
  // in `aggregate-feedback-insights.ts` (see `clusterEditFeedback`),
  // which calls Claude Haiku to compress each cluster of similar
  // user edits into a one-sentence human-readable rule the strategist
  // and writer agents read back through `strategy_insights`. Without
  // the key the cron still writes the cluster row using the longest
  // edit text as the representative — degraded but functional.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  // Trending-signal ingest TTL. The cron uses this to stamp the
  // `expiresAt` field on the BullMQ job payload so every row from a
  // single ingest wave shares the same TTL regardless of per-cluster
  // latency on the worker side. The worker has its own copy of the
  // same default in `apps/worker/src/env.ts` for the bypass path when
  // the cron did not pass an explicit override.
  //
  // The other trending-signal credentials (`VOYAGE_API_KEY`,
  // `GROK_API_KEY`, `EXA_API_KEY`, `PRODUCT_HUNT_TOKEN`) still live
  // exclusively in the worker env module — the cron only enqueues
  // those jobs, the worker executes them, so those keys would be
  // dead configuration on the cron service and would only confuse
  // operators configuring the cron on Render.
  TRENDING_SIGNAL_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24),
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
