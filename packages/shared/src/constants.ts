// ── Queue Names ──

export const QUEUE_NAMES = {
  ANALYSIS: 'analysis',
  REVIEW: 'review',
  // Background ingest of trending signals. The cron enqueues one job
  // per distinct project category on its 6-hour cadence; the worker
  // runs the agentic fan-out (Grok + Exa + 5 free APIs) and writes
  // clustered rows to the `trend_signals` table.
  TRENDING: 'trending',
  // Pika video-meeting session lifecycle. The web service enqueues
  // one PIKA_INVITE job per "Invite AI teammate to a meet" click;
  // the invite processor spawns the vendored Python CLI via
  // `pika-stream.ts` and schedules a delayed PIKA_LEAVE job at the
  // 30-minute auto-timeout ceiling. User-initiated leaves enqueue
  // an immediate PIKA_LEAVE job instead. Both leave paths are
  // idempotent: the first to run terminates the session and
  // marks the row `ended`; the second sees a terminal status
  // and no-ops.
  PIKA: 'pika',
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
  // Phase 5: background batch enrichment of dev_influencer rows.
  // Cron enqueues one job per 6h cadence; the worker reads N stale
  // rows, refreshes their bios + audience metrics + topic embeddings,
  // and writes them back. Same enqueue/execute split as the trending
  // signals ingest above.
  ENRICH_DEV_INFLUENCERS: 'enrich-dev-influencers',
  // Phase 7: Background Voyage embedding of asset feedback edit text.
  // The user-facing route writes the asset_feedback_events row
  // immediately and enqueues this job; the worker picks it up, embeds
  // the edit_text via Voyage, and writes back to
  // asset_feedback_events.edit_embedding. Same enqueue/execute split
  // as the two ingest jobs above — keeps the user request path off
  // the Voyage latency.
  EMBED_FEEDBACK_EVENT: 'embed-feedback-event',
  // Pika video meeting lifecycle. Enqueued by the web service on
  // a user click (invite + leave) and by the invite processor
  // itself for the 30-minute auto-leave delayed job.
  PIKA_INVITE: 'pika-invite',
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
  // Pika video meeting sessions. Concurrency of 2 is a deliberate
  // soft cap — a single worker process can host up to two active
  // joins at once without saturating the Python subprocess pool or
  // the Pika backend's per-key rate limits. Attempts is 1 because
  // the subprocess wrapper already bounds every run by a
  // wall-clock timeout and maps exit codes to typed errors; a
  // failed join with a structured error is not going to get better
  // on retry, and a second attempt would burn Pika credits for
  // nothing. The retry story is the user clicking "Invite" again,
  // not a BullMQ retry loop.
  [QUEUE_NAMES.PIKA]: {
    concurrency: 2,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 50 },
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
  // Phase 6 commit-marketing-run pipeline. The legacy webhook
  // processor finished in 5-10s; the new processor adds: Voyage diff
  // embed (~500ms), trend matcher pgvector query (~50ms), commit-
  // marketability `generateJSON` call (~3-5s), influencer-discovery
  // agent run with N enrichment tool calls (~10-20s), and parallel
  // outreach-draft `generateJSON` calls (~3-5s each). Realistic
  // worst case ~30-45s. Bumped from the legacy 30s to 90s to give
  // ~2x headroom over the worst case without hiding real hangs.
  [JOB_NAMES.FILTER_WEBHOOK]: 90_000,
  // Trending-signal ingest runs the agentic fan-out (Grok + Exa +
  // 5 free APIs + clustering) for a single category. ~30s of tool
  // calls + ~15s of clustering in steady state; the 120s ceiling
  // leaves headroom for Claude retries on a transient upstream.
  [JOB_NAMES.INGEST_TRENDING_SIGNALS]: 120_000,
  // Phase 5 dev_influencers enrichment runs N keyless API lookups
  // (GitHub + dev.to + HN, ~200ms each) for the 50 stalest rows,
  // plus an optional weekly X API enrichment pass for any row whose
  // last_x_enriched_at is stale. Worst case at 50 × 4 platforms ×
  // 200ms = ~40s, plus the Voyage embed loop (~50 × 500ms = 25s),
  // plus per-row update round trips. The 180s ceiling covers it
  // with headroom.
  [JOB_NAMES.ENRICH_DEV_INFLUENCERS]: 180_000,
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
  // Pika video meeting leave: single HTTP DELETE + cost persist.
  // ~5s in practice; 90s ceiling has headroom for a transient
  // network blip without hiding a hang.
  [JOB_NAMES.PIKA_LEAVE]: 90_000,
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
