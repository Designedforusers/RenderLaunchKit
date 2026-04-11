// ── Queue Names ──

export const QUEUE_NAMES = {
  ANALYSIS: 'analysis',
  REVIEW: 'review',
  // Background ingest of trending signals. The cron enqueues one job
  // per distinct project category on its 6-hour cadence; the worker
  // runs the agentic fan-out (Grok + Exa + 5 free APIs) and writes
  // clustered rows to the `trend_signals` table.
  TRENDING: 'trending',
  // Pika video-meeting invite queue. Single-purpose queue consumed
  // ONLY by the dedicated `launchkit-pika-worker` Render service.
  // Every job on this queue spawns the vendored Python CLI's `join`
  // subcommand for ~90 s. The dedicated dyno exists so the subprocess
  // burst has a warm, single-purpose event loop to spawn into — no
  // contention with analysis/research/trending jobs, no Python
  // install on the shared worker.
  PIKA_INVITE: 'pika-invite',
  // Pika video-meeting control queue. Consumed by the shared
  // `launchkit-worker` service alongside analysis/review/trending.
  // Carries two job types, both pure-TypeScript (no Python):
  //   - `pika-poll`  — HTTPS GET to Pika every 30 s while active,
  //                    detects closed/error/safety-cap and enqueues
  //                    a leave when appropriate
  //   - `pika-leave` — HTTPS DELETE to Pika's session endpoint,
  //                    fires on user click OR when the poll loop
  //                    detects termination OR on the 60-minute cap
  // Both are single-HTTP-call jobs taking <1 s each, perfectly fine
  // to share the shared worker's event loop with the existing
  // analysis/review/trending jobs.
  PIKA_CONTROL: 'pika-control',
  // Phase 10 note: the `generation` queue was removed when asset
  // generation moved to Render Workflows (`apps/workflows/`). Every
  // generation run now lives on per-task VMs sized per compute
  // profile rather than sharing the worker dyno's event loop.
} as const;

// ── Job Names ──

export const JOB_NAMES = {
  ANALYZE_REPO: 'analyze-repo',
  RESEARCH: 'research',
  STRATEGIZE: 'strategize',
  // Phase 10 note: per-asset-type generation job names were removed
  // alongside the BullMQ generation queue. Asset generation now runs
  // as Render Workflows tasks (see `apps/workflows/src/tasks/`).
  CREATIVE_REVIEW: 'creative-review',
  FILTER_WEBHOOK: 'filter-webhook',
  INGEST_TRENDING_SIGNALS: 'ingest-trending-signals',
  // Phase 7: Background Voyage embedding of asset feedback edit text.
  // The user-facing route writes the asset_feedback_events row
  // immediately and enqueues this job; the worker picks it up, embeds
  // the edit_text via Voyage, and writes back to
  // asset_feedback_events.edit_embedding. Same enqueue/execute split
  // as the two ingest jobs above — keeps the user request path off
  // the Voyage latency.
  EMBED_FEEDBACK_EVENT: 'embed-feedback-event',
  // Pika video meeting lifecycle. Three job types split across two
  // queues (see QUEUE_NAMES.PIKA_INVITE and QUEUE_NAMES.PIKA_CONTROL
  // below):
  //
  //   PIKA_INVITE  — spawns the Python `join` subprocess; burst of
  //                  ~90 s compute. Lives on the dedicated
  //                  launchkit-pika-worker dyno.
  //   PIKA_POLL    — periodic HTTPS GET to Pika's session endpoint
  //                  to detect closed/error state and enforce the
  //                  60-min safety cap. Lives on the shared worker.
  //   PIKA_LEAVE   — HTTPS DELETE to Pika's session endpoint.
  //                  Lives on the shared worker. Pure TS, no Python.
  PIKA_INVITE: 'pika-invite',
  PIKA_POLL: 'pika-poll',
  PIKA_LEAVE: 'pika-leave',
} as const;

// ── Queue Configuration ──

export const QUEUE_CONFIG = {
  [QUEUE_NAMES.ANALYSIS]: {
    concurrency: 2,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
  [QUEUE_NAMES.REVIEW]: {
    concurrency: 1,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed' as const, delay: 2000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 25 },
    },
  },
  // Trending signals run one per category per 6-hour cron tick —
  // the concurrency cap is low because each job burns ~10s of
  // Claude time and the worker should not saturate its API budget
  // on background ingest. Attempts is 1 because a failed ingest is
  // best dropped and retried on the next cron cycle rather than
  // retrying immediately against a flaky upstream.
  [QUEUE_NAMES.TRENDING]: {
    concurrency: 2,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 25 },
    },
  },
  // Pika invite queue — the 90-second Python subprocess burst.
  // Concurrency of 2 is a deliberate soft cap: a single dyno can
  // host up to two active joins at once without saturating the
  // Python subprocess pool or Pika's per-key rate limits.
  // Attempts is 1 because the subprocess wrapper already bounds
  // every run by a wall-clock timeout and maps exit codes to typed
  // errors — a failed join with a structured error is not going to
  // get better on retry, and a second attempt would burn Pika
  // credits for nothing. The retry story is the user clicking
  // "Invite" again, not a BullMQ retry loop.
  [QUEUE_NAMES.PIKA_INVITE]: {
    concurrency: 2,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  },
  // Pika control queue — the poll + leave background loop.
  // Concurrency of 5 because each job is a single pure-HTTP call
  // taking <1 s; the ceiling is only there to stop a pathological
  // backlog from pinning the event loop. Attempts is 3 with
  // exponential backoff because transient network errors to Pika
  // SHOULD retry — unlike the invite, the control calls are
  // idempotent and cost nothing to retry.
  [QUEUE_NAMES.PIKA_CONTROL]: {
    concurrency: 5,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
} as const;

// ── Job Timeouts (ms) ──

export const JOB_TIMEOUTS = {
  [JOB_NAMES.ANALYZE_REPO]: 120_000,
  [JOB_NAMES.RESEARCH]: 180_000,
  [JOB_NAMES.STRATEGIZE]: 60_000,
  // Phase 10 note: per-asset-type generation timeouts live on the
  // Render Workflows task definitions (`apps/workflows/src/tasks/`)
  // as `timeoutSeconds` options, one per compute-profile bucket.
  [JOB_NAMES.CREATIVE_REVIEW]: 60_000,
  // Phase 6 commit-marketing-run pipeline. The webhook processor
  // re-runs the trend matcher (Voyage diff embed ~500ms + pgvector
  // query ~50ms) and the commit-marketability `generateJSON` call
  // (~3-5s) before flipping affected assets back to `queued` and
  // firing the workflow trigger. Realistic worst case ~10s; the 60s
  // ceiling gives ~6x headroom over the worst case without hiding
  // real hangs.
  [JOB_NAMES.FILTER_WEBHOOK]: 60_000,
  // Trending-signal ingest runs the agentic fan-out (Grok + Exa +
  // 5 free APIs + clustering) for a single category. ~30s of tool
  // calls + ~15s of clustering in steady state; the 120s ceiling
  // leaves headroom for Claude retries on a transient upstream.
  [JOB_NAMES.INGEST_TRENDING_SIGNALS]: 120_000,
  // Phase 7 feedback event embedding. Single Voyage call (~500ms) +
  // one raw SQL UPDATE (~10ms). 30s ceiling has plenty of headroom
  // for transient Voyage latency without hiding real hangs.
  [JOB_NAMES.EMBED_FEEDBACK_EVENT]: 30_000,
  // Pika video meeting invite: Python subprocess spawn + join flow
  // runs ~90s per the upstream docs. 300s ceiling covers a slow
  // Meet auth handshake without hiding real hangs. The subprocess
  // wrapper's own `AbortController` enforces a 240s wall-clock
  // bound inside this ceiling so a stuck run surfaces as a typed
  // `PikaTimeoutError` well before BullMQ times the job out.
  [JOB_NAMES.PIKA_INVITE]: 300_000,
  // Pika poll: single HTTPS GET to Pika + a handful of DB reads +
  // a conditional BullMQ enqueue. ~500 ms in practice; 30 s ceiling
  // for a network blip. The poll re-enqueues itself on a 30-s
  // delay so a slow tick does not compound.
  [JOB_NAMES.PIKA_POLL]: 30_000,
  // Pika video meeting leave: single HTTPS DELETE + cost persist.
  // ~2 s in practice (no Python subprocess); 30 s ceiling.
  [JOB_NAMES.PIKA_LEAVE]: 30_000,
} as const;

// ── Asset Type Labels ──

export const ASSET_TYPE_LABELS: Record<string, string> = {
  blog_post: 'Blog Post',
  twitter_thread: 'Twitter Thread',
  linkedin_post: 'LinkedIn Post',
  product_hunt_description: 'Product Hunt',
  hacker_news_post: 'Hacker News',
  faq: 'FAQ',
  changelog_entry: 'Changelog',
  og_image: 'OG Image',
  social_card: 'Social Card',
  product_video: 'Product Video',
  voiceover_script: 'Voiceover Script',
  video_storyboard: 'Storyboard',
};

// ── Status Colors (for dashboard) ──

export const STATUS_COLORS: Record<string, string> = {
  pending: '#94a3b8',
  analyzing: '#60a5fa',
  researching: '#a78bfa',
  strategizing: '#f59e0b',
  generating: '#10b981',
  reviewing: '#ec4899',
  revising: '#f97316',
  complete: '#10b981',
  failed: '#ef4444',
  queued: '#94a3b8',
  approved: '#10b981',
  rejected: '#ef4444',
  regenerating: '#f97316',
};

// ── Phase Order ──

export const PHASE_ORDER = [
  'pending',
  'analyzing',
  'researching',
  'strategizing',
  'generating',
  'reviewing',
  'complete',
] as const;

// ── GitHub API ──

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';

// ── Redis Channel Prefixes ──

export const REDIS_CHANNELS = {
  PROJECT_EVENTS: (projectId: string) => `project:${projectId}:events`,
  GITHUB_CACHE: (key: string) => `github:cache:${key}`,
} as const;

// ── Limits ──

export const MAX_REVISION_ROUNDS = 2;
export const MIN_APPROVAL_SCORE = 7;
export const RESEARCH_MAX_STEPS = 15;
// Voyage `voyage-3-large` default output dimension. Anthropic's
// canonical embeddings pairing — replaces the previous 1536-dim
// OpenAI-compatible setting from when this column was a placeholder
// lexical hash. See `apps/worker/src/lib/voyage-embeddings.ts`.
export const EMBEDDING_DIMENSIONS = 1024;
