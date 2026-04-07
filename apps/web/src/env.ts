import { z } from 'zod';

/**
 * Typed, validated environment variables for the web process.
 *
 * See `apps/worker/src/env.ts` for the rationale and the lazy-Proxy
 * pattern. This file mirrors the same approach for the web service's
 * env surface.
 */

const envSchema = z.object({
  // ── Process control ────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // ── Datastore ──────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // ── Auth / webhooks ────────────────────────────────────────────
  // Optional bearer-token gate for the API. When unset, the API is
  // open. When set, requests must present a matching token.
  API_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // ── Voiceover (ElevenLabs) ─────────────────────────────────────
  // Required only when the narrated video variant is requested. The
  // route checks all three at request time and returns 409 if any is
  // missing rather than failing the whole web service to boot.
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().optional(),

  // ── Remotion render ────────────────────────────────────────────
  REMOTION_CONCURRENCY: z.string().default('50%'),
});

export type WebEnv = z.infer<typeof envSchema>;

let cached: WebEnv | null = null;

function parseEnv(): WebEnv {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(`Invalid web environment: ${formatted}`);
  }
  cached = result.data;
  return cached;
}

/**
 * Lazy proxy over the parsed env. See `apps/worker/src/env.ts` for
 * the rationale and the symbol-guard explanation.
 */
export const env: WebEnv = new Proxy({} as WebEnv, {
  get(_target, key) {
    if (typeof key !== 'string') return undefined;
    return parseEnv()[key as keyof WebEnv];
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
