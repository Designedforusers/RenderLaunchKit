import { z } from 'zod';

/**
 * Typed, validated environment variables for the worker process.
 *
 * Replaces every `process.env.X` access in the worker with a single
 * import: `import { env } from './env.js'; env.DATABASE_URL`. The
 * benefits over raw `process.env`:
 *
 *   1. **Type safety.** `env.DATABASE_URL` is `string` (not `string |
 *      undefined`), so the call site does not have to null-coalesce.
 *      Required vars that are missing fail loudly at startup with a
 *      structured error naming the field, not silently as a `cannot
 *      read property 'X' of undefined` ten files away.
 *
 *   2. **Single source of truth.** Adding a new env var means editing
 *      this file once, not searching the codebase for `process.env.X`
 *      sites and updating each one.
 *
 *   3. **`noPropertyAccessFromIndexSignature` compatibility.** TypeScript
 *      treats `process.env` as `Record<string, string | undefined>`,
 *      so `process.env.X` is rejected by the strict flag. The typed
 *      `env` object is a real object with declared properties, so the
 *      access works without bracket notation.
 *
 * Lazy parsing
 * ------------
 *
 * The schema is parsed on first read of any field via a Proxy, not at
 * module import time. This matters because:
 *
 *   - Tests that import worker code paths do not need every required
 *     env var set in the test environment. The parse only happens if
 *     the test actually reads a field.
 *
 *   - The worker can import processor modules at startup before the
 *     env is fully populated (Render brings services up in parallel)
 *     without crashing the import chain. The first publish/fetch call
 *     is what triggers the validation.
 *
 * The first failed parse throws a descriptive error and caches `null`
 * so subsequent reads also throw — no inconsistent partial state.
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
  // Optional at the schema level so the worker can boot without an
  // API key (e.g. local dev or a smoke test). The agents that need
  // it will throw at call time with a clear error.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-6'),

  // ── Embeddings (Voyage AI) ─────────────────────────────────────
  // Voyage is the canonical embeddings pairing for Anthropic-stack
  // projects. `voyage-3-large` at 1024 dim. Optional at the schema
  // level so the worker boots without it; the embedding helper at
  // `apps/worker/src/lib/voyage-embeddings.ts` throws a structured
  // `VoyageEmbeddingError` at call time if the key is missing.
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_MODEL: z.string().default('voyage-3-large'),

  // ── Third-party APIs ───────────────────────────────────────────
  FAL_API_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(900),

  // ── Trending signals (Phase 3) ────────────────────────────────
  // Grok is the only source with live X (Twitter) search; xAI's Live
  // Search mode restricted to `x` returns posts the other free APIs
  // cannot see. Exa is a semantic web-search MCP server plugged into
  // the Agent SDK for niche dev content the built-in WebSearch misses.
  // Both are optional — the trending-signals agent degrades gracefully
  // to the five free APIs when either key is absent.
  GROK_API_KEY: z.string().optional(),
  GROK_MODEL: z.string().default('grok-4-latest'),
  EXA_API_KEY: z.string().optional(),
  // Product Hunt v2 GraphQL developer token. Free to obtain at
  // https://api.producthunt.com/v2/oauth/applications; the tool
  // returns an empty array when absent so the rest of the fan-out
  // still runs.
  PRODUCT_HUNT_TOKEN: z.string().optional(),
  // Cache TTL for all trending-signal source calls (Grok, HN Algolia,
  // dev.to, Reddit, Product Hunt, GitHub influencer search). Short by
  // default so the hourly cron still sees fresh data; bumpable in
  // tests to avoid hammering the upstreams.
  TRENDING_SIGNAL_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(600),
  // How long a freshly-ingested trend survives before the cleanup
  // cron drops it. Seven days is the default in the plan — long
  // enough for weekly-cadence commits, short enough that stale
  // "what's hot" signals do not pollute the matcher. Shared with
  // the cron env module so a worker-side processor that inserts a
  // trend can compute the same TTL as the cron that enqueued the
  // job when the cron did not pass an explicit `expiresAt` override.
  TRENDING_SIGNAL_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24),

  // ── ElevenLabs (Phase 4 audio synthesis) ──────────────────────
  // Drives the eager voice-commercial and multi-speaker podcast
  // generation in the worker. All four fields are optional at the
  // schema level so the worker can boot without them; the synthesis
  // helpers in `apps/worker/src/lib/elevenlabs.ts` throw a structured
  // error at call time if the API key or primary voice id is missing.
  // `ELEVENLABS_VOICE_ID_ALT` is the second voice for the podcast's
  // `sam` speaker; when absent, both speakers fall back to the
  // primary voice and the dialogue still renders (just monotonally).
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_VOICE_ID_ALT: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof envSchema>;

let cached: WorkerEnv | null = null;

function parseEnv(): WorkerEnv {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(`Invalid worker environment: ${formatted}`);
  }
  cached = result.data;
  return cached;
}

/**
 * Lazy proxy over the parsed env. Reads trigger `parseEnv()` on
 * first access; subsequent reads use the cached result. Writes are
 * forbidden — env vars are read-only configuration.
 *
 * The symbol guard in `get` is load-bearing: Node and many libraries
 * inspect arbitrary objects via well-known symbols (`Symbol.iterator`,
 * `Symbol.toPrimitive`, `Symbol.toStringTag`, …) and would otherwise
 * trigger `parseEnv()` for a key that has no place in the schema.
 */
export const env: WorkerEnv = new Proxy({} as WorkerEnv, {
  get(_target, key) {
    if (typeof key !== 'string') return undefined;
    return parseEnv()[key as keyof WorkerEnv];
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
