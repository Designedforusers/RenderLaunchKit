import { z } from 'zod';

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
