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
// computed from `import.meta.url` because the workflows service
// runs under `render workflows dev -- npm run dev -w apps/workflows`
// (cwd `apps/workflows/`) in dev and `node apps/workflows/dist/index.js`
// in production. Walking up three directories from this file lands
// at the repo root in both `src/` (tsx watch) and `dist/` (compiled).
// On Render itself there is no `.env` file and `dotenv` silently
// no-ops; production env vars are injected by the Render dashboard
// at service start.
loadDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../..', '.env'),
});

/**
 * Typed, validated environment variables for the workflows process.
 *
 * Follows the same lazy-Proxy pattern as the worker, web, and cron env
 * modules — see `apps/worker/src/env.ts` for the full rationale
 * (`noPropertyAccessFromIndexSignature`, lazy parsing at first
 * field access, symbol guard in `get`, read-only `set` / `deleteProperty`
 * traps).
 *
 * The env surface is intentionally narrow: the workflows service runs
 * **only** the asset-generation tasks, so it needs:
 *
 *   - The datastore credentials (`DATABASE_URL`, `REDIS_URL`) for
 *     reading project context + publishing progress events + enqueuing
 *     the review BullMQ job.
 *   - The four provider keys that back the asset-generation clients
 *     (`ANTHROPIC_API_KEY`, `FAL_API_KEY`, `ELEVENLABS_*`, `WORLD_LABS_*`).
 *   - Nothing else. The worker's trending-signals / commit-marketability /
 *     influencer-discovery / voyage-embeddings keys are dead weight on
 *     this service and would only confuse an operator reading the env
 *     page in the Render dashboard.
 */

const envSchema = z.object({
  // ── Process control ────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // ── Datastore ──────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // ── Anthropic ──────────────────────────────────────────────────
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-6'),

  // ── fal.ai (images + video) ────────────────────────────────────
  FAL_API_KEY: z.string().optional(),

  // ── ElevenLabs (voice + podcast) ───────────────────────────────
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_VOICE_ID_ALT: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().optional(),

  // ── World Labs (3D scenes) ─────────────────────────────────────
  WORLD_LABS_API_KEY: z.string().optional(),
  WORLD_LABS_POLL_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  WORLD_LABS_POLL_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(5),

  // ── MinIO object storage ───────────────────────────────────────
  // The `renderRemotionVideo` task uploads finished MP4 bytes to a
  // MinIO bucket on the `launchkit-minio` service. MINIO_ENDPOINT_HOST
  // is a bare hostname (no scheme, no port) injected via render.yaml's
  // `fromService.property: host`; the client composes the full
  // `https://<host>` URL at construction time. MINIO_ROOT_USER and
  // MINIO_ROOT_PASSWORD are set manually on the workflows service
  // in the Render dashboard (Render Workflows is not in the Blueprint
  // so the Blueprint's auto-sync from `launchkit-minio` does not
  // reach this service). All four are optional so local dev boots
  // without MinIO; the task throws a structured error at upload time
  // if any required field is missing.
  MINIO_ENDPOINT_HOST: z.string().optional(),
  MINIO_ROOT_USER: z.string().optional(),
  MINIO_ROOT_PASSWORD: z.string().optional(),
  MINIO_BUCKET: z.string().default('launchkit-renders'),

  // ── Remotion rendering ─────────────────────────────────────────
  // Concurrency passed through to `@remotion/renderer`'s
  // `renderMedia` by the `renderRemotionVideo` task. Accepts any
  // value the library accepts — a CPU-core count (`4`), or a
  // percentage string (`'50%'`). Defaults to `'50%'` to match the
  // web service's env module default; the workflows task uses the
  // pro plan (2 CPU / 4 GB) so 50% keeps one core free for the
  // Chrome puppeteer process.
  REMOTION_CONCURRENCY: z.string().default('50%'),
});

export type WorkflowsEnv = z.infer<typeof envSchema>;

let cached: WorkflowsEnv | null = null;

function parseEnv(): WorkflowsEnv {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(`Invalid workflows environment: ${formatted}`);
  }
  cached = result.data;
  return cached;
}

/**
 * Compose a full MinIO endpoint URL from the bare `MINIO_ENDPOINT_HOST`
 * value. See the matching helper in `apps/web/src/env.ts` for the
 * scheme-detection rationale — `http://` for local dev (detected via
 * `localhost`, `127.0.0.1`, or a `:` port marker), `https://` for
 * Render-hosted services.
 *
 * Returns `null` when the host is missing so callers can branch to a
 * structured error at the use site.
 */
export function composeMinioEndpoint(host: string | undefined): string | null {
  if (host === undefined || host.length === 0) return null;
  const isLocal =
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.includes(':');
  return isLocal ? `http://${host}` : `https://${host}`;
}

/**
 * Lazy proxy over the parsed env. See `apps/worker/src/env.ts` for
 * the rationale and the symbol-guard explanation.
 */
export const env: WorkflowsEnv = new Proxy({} as WorkflowsEnv, {
  get(_target, key) {
    if (typeof key !== 'string') return undefined;
    return parseEnv()[key as keyof WorkflowsEnv];
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
