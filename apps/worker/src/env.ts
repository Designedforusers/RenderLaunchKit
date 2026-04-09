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

  // ── Private-repo token decryption ──────────────────────────────
  // Base64-encoded 32-byte key that pairs with the web service's
  // `GITHUB_TOKEN_SECRET`. Used by `lib/github-token-crypto.ts` to
  // decrypt a per-project user-supplied GitHub token at the start
  // of an analyze job so every fetch for that project is routed
  // through the user's own access scope. Optional: when unset, the
  // worker falls back to the global `GITHUB_TOKEN` and silently
  // ignores any encrypted blob it encounters (public-repo projects
  // keep working, private-repo projects fail cleanly at the first
  // 404 from the GitHub API).
  GITHUB_TOKEN_SECRET: z.string().optional(),

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

  // ── X API enrichment (Phase 5, optional + gated) ─────────────
  // Optional Bearer token for the paid X (Twitter) v2 API. The Phase 5
  // `enrich-x-user` tool short-circuits to `null` when this is unset
  // — every other enrichment path (GitHub, dev.to, HN) uses keyless
  // public endpoints, so the discovery loop still produces results
  // without burning paid quota. The companion cron cadence knob
  // (`X_API_ENRICHMENT_INTERVAL_HOURS`) lives on the cron env module,
  // not here — only the cron needs to read it.
  X_API_BEARER_TOKEN: z.string().optional(),

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

  // ── Render Workflows (generation runtime) ────────────────────
  // The strategize handler triggers a `generateAllAssetsForProject`
  // run on the Render Workflows service at
  // `${RENDER_WORKFLOW_SLUG}/generateAllAssetsForProject` via the
  // helper at `./lib/trigger-workflow-generation.ts`. The lazy
  // SDK client checks these at call time and throws a structured
  // error if either is missing — the worker still boots on the
  // BullMQ-only (analyze, review, trending) code path when the
  // analysis handler never reaches strategize, which is why both
  // fields are optional at the schema level rather than `.min(1)`.
  RENDER_API_KEY: z.string().optional(),
  RENDER_WORKFLOW_SLUG: z.string().optional(),
  // Opt-in flag for routing SDK calls to the local Render CLI task
  // server (`render workflows dev`, port 8120) instead of the cloud
  // control plane. The Render SDK reads `process.env.RENDER_USE_LOCAL_DEV`
  // directly in its `get-base-url` helper — declaring the var here
  // keeps it visible in the typed env surface and documents the
  // local-dev path even though nothing in this module reads it.
  RENDER_USE_LOCAL_DEV: z
    .enum(['true', 'false'])
    .optional(),

  // ── World Labs (Marble) 3D world generation ───────────────────
  // Drives the `world_scene` asset type — the writer agent crafts a
  // text prompt describing the product being used in a real-world
  // setting, the World Labs API generates a 3D Gaussian-splat scene,
  // and the dashboard links the user out to the interactive Marble
  // viewer. Optional at the schema level so the worker boots without
  // it; the helper in `packages/asset-generators/src/clients/world-labs.ts`
  // throws a structured error at call time if the key is missing.
  // The model defaults to `marble-1.1`; bump to `marble-1.1-plus` via
  // env override when an outdoor or larger indoor scene is requested.
  WORLD_LABS_API_KEY: z.string().optional(),
  WORLD_LABS_MODEL: z.string().default('marble-1.1'),
  // How long the polling loop is willing to wait for a single world
  // generation before giving up. World generations land in ~5 minutes
  // per the docs; the default ceiling here is 15 minutes, which is
  // long enough to ride out a slow render without the BullMQ job
  // looking permanently stuck. Override in tests if needed.
  WORLD_LABS_POLL_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  // Delay between successive operation polls. Five seconds is gentle
  // on the upstream and gives a snappy enough progress signal for the
  // dashboard SSE stream — the operation only flips `done` once, so a
  // tighter loop would just burn quota.
  WORLD_LABS_POLL_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
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
