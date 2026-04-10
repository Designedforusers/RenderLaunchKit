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
// computed from `import.meta.url` because `npm run dev -w apps/web`
// sets the cwd to `apps/web/`, where there is no `.env`. Walking up
// three directories from this file lands at the repo root in both
// `src/` (tsx watch) and `dist/` (compiled). On Render itself there
// is no `.env` file and `dotenv` silently no-ops; production env
// vars are injected by the Render dashboard at service start.
loadDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../..', '.env'),
});

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

  // ── Private-repo token encryption ──────────────────────────────
  // Base64-encoded 32-byte key used by `lib/github-token-crypto.ts`
  // to encrypt a user-supplied GitHub personal access token with
  // AES-256-GCM before persisting it on the `projects` row. When
  // unset, the API rejects project-creation requests that include a
  // `githubToken` field with 503 — the public-repo path keeps
  // working unchanged. Generate a key with
  // `node -e "console.log(crypto.randomBytes(32).toString('base64'))"`.
  GITHUB_TOKEN_SECRET: z.string().optional(),

  // ── Voiceover (ElevenLabs) ─────────────────────────────────────
  // Required only when the narrated video variant is requested. The
  // route checks all three at request time and returns 409 if any is
  // missing rather than failing the whole web service to boot.
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().optional(),

  // ── Remotion render ────────────────────────────────────────────
  REMOTION_CONCURRENCY: z.string().default('50%'),

  // ── Anthropic (chat endpoint) ───────────────────────────────────
  // Used by the `/api/projects/:id/chat` streaming endpoint for
  // the dashboard's agent chat UI. The web service calls
  // `messages.create({ stream: true })` directly — no BullMQ
  // queue, no worker hop. Optional so the web service boots fine
  // without it; the chat route returns 503 at call time if missing.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

  // ── Render Workflows (asset generation trigger) ────────────────
  // The `/api/assets/:id/regenerate` route triggers a
  // `generateAllAssetsForProject` task run on the Render Workflows
  // service instead of enqueuing to the legacy BullMQ generation
  // queue (deleted in PR 3). Both are required at call time on the
  // regen code path; the trigger helper throws a structured error
  // if either is missing. Optional at the schema level so the web
  // service can boot without them when the regen route is not in
  // use (e.g. dashboard-only local dev against seed data).
  //
  // Local dev: set `RENDER_USE_LOCAL_DEV=true` to route the SDK
  // calls to the local `render workflows dev` task server on
  // http://localhost:8120. The Render SDK reads that env var
  // directly from `process.env` in its `get-base-url` helper; we
  // declare it here so the typed env surface documents it.
  RENDER_API_KEY: z.string().optional(),
  RENDER_WORKFLOW_SLUG: z.string().optional(),
  RENDER_USE_LOCAL_DEV: z.enum(['true', 'false']).optional(),
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
