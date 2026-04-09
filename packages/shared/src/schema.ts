import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  real,
  integer,
  bigint,
  uuid,
  uniqueIndex,
  varchar,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
// pgvector column helper — uses raw SQL for the vector type
import { customType } from 'drizzle-orm/pg-core';
import { EMBEDDING_DIMENSIONS } from './constants.js';

// ── Custom pgvector type ──

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value !== 'string') {
      return [];
    }

    return value
      .replace(/[[\]]/g, '')
      .split(',')
      .map(Number);
  },
});

// ── Enums ──

export const projectStatusEnum = pgEnum('project_status', [
  'pending',
  'analyzing',
  'researching',
  'strategizing',
  'generating',
  'reviewing',
  'revising',
  'complete',
  'failed',
]);

export const assetTypeEnum = pgEnum('asset_type', [
  'blog_post',
  'twitter_thread',
  'linkedin_post',
  'product_hunt_description',
  'hacker_news_post',
  'faq',
  'changelog_entry',
  'og_image',
  'social_card',
  'product_video',
  'voiceover_script',
  'video_storyboard',
  // ── New in the agentic GTM build (Phase 2) ──
  // Actionable commit-specific launch tips
  'tips',
  // 30-second ad-style script + ElevenLabs single-voice render
  'voice_commercial',
  // 2-3 minute multi-voice dialogue + ElevenLabs multi-voice render
  'podcast_script',
  // Per-influencer personalised DM draft (one row per recommended dev)
  'outreach_draft',
  // 15-second Remotion card video summarising one commit's marketing kit
  'per_commit_teaser',
  // ── World Labs (Marble) 3D scene of the product in a real-world
  //    setting. The writer agent crafts a text prompt, the World Labs
  //    API generates a Gaussian-splat world the user can walk
  //    through, and the dashboard links out to the Marble viewer.
  'world_scene',
]);

// ── Source for a single trending signal ingested by the
//    `trending-signals-agent` from a free API or via Grok / Exa.
export const trendSourceEnum = pgEnum('trend_source', [
  'hn',
  'devto',
  'reddit',
  'grok',
  'exa',
  'producthunt',
  'github',
]);

// ── Channel an outreach draft is targeted for. The user picks the
//    actual sending surface; LaunchKit only generates the draft.
export const outreachChannelEnum = pgEnum('outreach_channel', [
  'twitter_dm',
  'email',
  'comment',
]);

// ── Lifecycle of an outreach draft. `drafted` → `copied` (user
//    clicked Copy) → `sent` (user marked it sent) → `responded`
//    (a future iteration that listens for replies).
export const outreachStatusEnum = pgEnum('outreach_status', [
  'drafted',
  'copied',
  'sent',
  'responded',
]);

// ── Lifecycle of a single commit-triggered marketing run. `pending`
//    while the relevance check is in flight, `generating` while the
//    asset fan-out is running, `complete` when every asset has a
//    quality score, `failed` if any phase blew up.
export const commitRunStatusEnum = pgEnum('commit_run_status', [
  'pending',
  'generating',
  'complete',
  'failed',
]);

// ── User action recorded against an asset. Powers the Layer 3
//    behavioural learning loop — every action writes to
//    `asset_feedback_events` with the edit text + Voyage embedding.
export const feedbackActionEnum = pgEnum('feedback_action', [
  'approved',
  'rejected',
  'edited',
  'regenerated',
]);

export const assetStatusEnum = pgEnum('asset_status', [
  'queued',
  'generating',
  'reviewing',
  'approved',
  'rejected',
  'regenerating',
  'complete',
  'failed',
]);

// ── Tables ──

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoUrl: text('repo_url').notNull(),
    repoOwner: varchar('repo_owner', { length: 255 }).notNull(),
    repoName: varchar('repo_name', { length: 255 }).notNull(),
    status: projectStatusEnum('status').default('pending').notNull(),

    // Repo analysis results
    repoAnalysis: jsonb('repo_analysis'),

    // Research results (from agentic research loop)
    research: jsonb('research'),

    // Launch strategy (from the strategist agent)
    strategy: jsonb('strategy'),

    // Creative director review
    reviewScore: real('review_score'),
    reviewFeedback: jsonb('review_feedback'),
    revisionCount: integer('revision_count').default(0).notNull(),

    // pgvector embedding of the project summary for similarity search
    embedding: vector('embedding'),

    // Webhook tracking
    webhookEnabled: boolean('webhook_enabled').default(false).notNull(),
    lastCommitSha: varchar('last_commit_sha', { length: 40 }),

    // Private-repo support. When the user submits a GitHub personal
    // access token alongside the repo URL, the web service encrypts
    // it with AES-256-GCM using the server-side `GITHUB_TOKEN_SECRET`
    // and persists the `iv:tag:ciphertext` blob here. The analyze
    // worker decrypts the blob once at the start of the job and
    // routes every GitHub fetch for the project through the
    // user-scoped token. NULL for public repos — the fetch tools
    // then fall back to the global `GITHUB_TOKEN` (if set) or to
    // unauthenticated access.
    githubTokenEncrypted: text('github_token_encrypted'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('projects_repo_url_idx').on(table.repoUrl),
    index('projects_status_idx').on(table.status),
  ]
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    type: assetTypeEnum('type').notNull(),
    status: assetStatusEnum('status').default('queued').notNull(),

    // The generated content
    content: text('content'),
    mediaUrl: text('media_url'),
    metadata: jsonb('metadata'),

    // Creative director scoring. `reviewNotes` is the human-readable
    // feedback string the dashboard renders under "Review feedback".
    // It is DISPLAY-ONLY — never read by an agent as a prompt. The
    // agent-facing revision prompt lives in `revisionInstructions`
    // below so the two concerns stay separate.
    qualityScore: real('quality_score'),
    reviewNotes: text('review_notes'),

    // Agent-facing revision prompt. Populated by the three re-queue
    // paths (creative review rejection, commit-marketing refresh, and
    // user-driven "Regenerate" with explicit instructions) before the
    // asset is flipped back to `queued`. `dispatchAsset` in the
    // workflows service reads this column off the row at run time and
    // passes it through to the agents as the `revisionInstructions`
    // input. Nullable because first-pass generations have no revision
    // overlay.
    revisionInstructions: text('revision_instructions'),

    // User feedback
    userApproved: boolean('user_approved'),
    userEdited: boolean('user_edited').default(false).notNull(),
    userEditedContent: text('user_edited_content'),

    // Version tracking for regeneration
    version: integer('version').default(1).notNull(),

    // pgvector embedding of the rendered asset content for Layer 2
    // semantic search ("find me high-scoring exemplars in this
    // category") and the cross-asset deduplication guard.
    contentEmbedding: vector('content_embedding'),

    // ── Cost tracking (Phase 9) ──
    //
    // Denormalized per-asset total in integer cents. Summed across the
    // asset's rows in `asset_cost_events` and written by the workflows
    // service's `persistCostEvents` helper after a successful dispatch.
    // Defaults to 0 so seed data and historical rows read as "not
    // priced yet" rather than NULL.
    costCents: integer('cost_cents').notNull().default(0),

    // Per-event breakdown pinned on the asset for dashboard display
    // (shape: `AssetCostBreakdownSchema` in
    // `packages/shared/src/schemas/asset-cost-event.ts`). Denormalized
    // alongside `cost_cents` so the per-asset detail modal can render
    // the provider breakdown without a second query to
    // `asset_cost_events`. NULL when no events have been persisted
    // for the asset yet.
    costBreakdown: jsonb('cost_breakdown'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('assets_project_id_idx').on(table.projectId),
    index('assets_type_idx').on(table.type),
    index('assets_status_idx').on(table.status),
  ]
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    bullmqJobId: varchar('bullmq_job_id', { length: 255 }),
    name: varchar('name', { length: 100 }).notNull(),
    status: varchar('status', { length: 50 }).default('queued').notNull(),

    input: jsonb('input'),
    output: jsonb('output'),
    error: text('error'),
    attempts: integer('attempts').default(0).notNull(),
    duration: integer('duration_ms'),

    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('jobs_project_id_idx').on(table.projectId),
    index('jobs_status_idx').on(table.status),
  ]
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    // GitHub's `x-github-delivery` header. Unique per delivery (including
    // redeliveries from the GitHub UI), used to dedupe replays.
    deliveryId: varchar('delivery_id', { length: 64 }),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    payload: jsonb('payload').notNull(),
    commitSha: varchar('commit_sha', { length: 40 }),
    commitMessage: text('commit_message'),

    // AI filtering decision
    isMarketable: boolean('is_marketable'),
    filterReasoning: text('filter_reasoning'),

    // Did it trigger generation?
    triggeredGeneration: boolean('triggered_generation')
      .default(false)
      .notNull(),

    // pgvector embedding of the commit (message + diff summary) for
    // Layer 2 trend matching and the per-commit duplication guard
    // ("we already marketed something semantically identical to this
    // commit in the last 7 days").
    diffEmbedding: vector('diff_embedding'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('webhook_events_project_id_idx').on(table.projectId),
    uniqueIndex('webhook_events_delivery_id_idx').on(table.deliveryId),
  ]
);

export const strategyInsights = pgTable(
  'strategy_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: varchar('category', { length: 100 }).notNull(),
    insight: text('insight').notNull(),
    confidence: real('confidence').notNull(),
    sampleSize: integer('sample_size').notNull(),
    dataPoints: jsonb('data_points'),
    // Insight type — `tone`, `asset_type`, `trend_velocity`,
    // `influencer_response`, `edit_pattern`, etc. Lets the cron
    // distinguish Layer 1 stat-based insights from Layer 3 edit
    // clusters when the strategist queries for relevant context.
    insightType: varchar('insight_type', { length: 50 }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('strategy_insights_category_idx').on(table.category),
    index('strategy_insights_insight_type_idx').on(table.insightType),
  ]
);

// ── Trending signals (Phase 2 of the agentic GTM build) ──
//
// Persistent record of every trending topic ingested from any
// source. Powers the trend-matching layer ("for this commit's
// category, what's hot in the dev community right now?") and the
// trend velocity scoring in Layer 1 of the self-learning loop.
// Embedding column is Voyage `voyage-3-large` at 1024 dim.
export const trendSignals = pgTable(
  'trend_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: trendSourceEnum('source').notNull(),
    topic: text('topic').notNull(),
    headline: text('headline').notNull(),
    url: text('url'),
    rawPayload: jsonb('raw_payload'),
    velocityScore: real('velocity_score').default(0).notNull(),
    embedding: vector('embedding'),
    // Free-form category string so a trend can be matched to a
    // project category without hard-coupling to the project_category
    // enum (trends discovered on Reddit don't always map cleanly).
    category: varchar('category', { length: 100 }),
    ingestedAt: timestamp('ingested_at').defaultNow().notNull(),
    // Optional TTL — the cleanup cron drops trends past this point.
    expiresAt: timestamp('expires_at'),
  },
  (table) => [
    index('trend_signals_source_idx').on(table.source),
    index('trend_signals_category_idx').on(table.category),
    index('trend_signals_ingested_at_idx').on(table.ingestedAt),
    index('trend_signals_expires_at_idx').on(table.expiresAt),
  ]
);

// ── Dev influencer database ──
//
// Curated + auto-enriched list of dev influencers. Seeded from a
// hand-picked starter set (`seed/dev-influencers.json`) and grown
// daily by the `enrich-dev-influencers.ts` cron. The
// `topic_embedding` column powers the influencer matcher
// ("for this commit's category and topics, find the top-N
// dev voices whose recent topics overlap").
export const devInfluencers = pgTable(
  'dev_influencers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    handle: varchar('handle', { length: 100 }).notNull(),
    // Per-platform handles + URLs as a jsonb blob:
    // { twitter: '@handle', github: 'username', devto: 'username', ... }
    platforms: jsonb('platforms').notNull(),
    // Project-category overlap (text[] so a single influencer can
    // cover multiple categories — most do).
    categories: text('categories').array().notNull(),
    bio: text('bio'),
    // Recent post topics, refreshed by the enrichment cron.
    recentTopics: jsonb('recent_topics'),
    audienceSize: integer('audience_size').default(0).notNull(),
    // Per-platform audience data (Twitter followers, GitHub repos,
    // dev.to post count, HN karma). Separate from `audienceSize`,
    // which is the scalar max-across-platforms used by the matcher's
    // ORDER BY. Typed at the Zod layer as `AudienceBreakdownSchema`.
    audienceBreakdown: jsonb('audience_breakdown'),
    topicEmbedding: vector('topic_embedding'),
    lastEnrichedAt: timestamp('last_enriched_at'),
    // Timestamp of the last paid X-enrichment run for this influencer.
    // Separate from `lastEnrichedAt` (which covers the free-API
    // refresh) because the paid X tool is rate- and cost-limited and
    // runs on its own cadence.
    lastXEnrichedAt: timestamp('last_x_enriched_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('dev_influencers_handle_idx').on(table.handle),
    index('dev_influencers_audience_size_idx').on(table.audienceSize),
  ]
);

// ── Per-commit marketing run ──
//
// One row per "user pushed a commit, LaunchKit produced a kit"
// event. Links the source webhook event, the trends used as
// context, the influencers recommended, and the asset IDs the
// fan-out generated. Powers the continuous launch feed dashboard
// view at `/projects/:id/feed`.
export const commitMarketingRuns = pgTable(
  'commit_marketing_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    webhookEventId: uuid('webhook_event_id')
      .references(() => webhookEvents.id, { onDelete: 'cascade' })
      .notNull(),
    commitSha: varchar('commit_sha', { length: 40 }).notNull(),
    commitMessage: text('commit_message'),
    // Snapshot of the trends + influencers + assets at fan-out time.
    // Stored as jsonb so the dashboard can render the full picture
    // for a past run without joining four tables.
    trendsUsed: jsonb('trends_used'),
    influencersRecommended: jsonb('influencers_recommended'),
    // Snapshot of asset IDs at fan-out time. Intentionally a native
    // `UUID[]` column rather than a join table — the dashboard reads
    // a commit run as a single immutable record of "what we generated
    // for this commit", not as a live join. If an asset is deleted
    // later, the historical run keeps its asset id reference for
    // audit purposes.
    assetIds: uuid('asset_ids').array(),
    status: commitRunStatusEnum('status').default('pending').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('commit_marketing_runs_project_id_idx').on(table.projectId),
    index('commit_marketing_runs_webhook_event_id_idx').on(
      table.webhookEventId
    ),
    index('commit_marketing_runs_status_idx').on(table.status),
    index('commit_marketing_runs_created_at_idx').on(table.createdAt),
  ]
);

// ── Outreach drafts ──
//
// Personalised DMs / emails / comments produced by the
// `outreach-draft-agent`. One row per (commit_marketing_run ×
// influencer × channel). The user copies, marks sent, and
// (eventually) the system listens for responses.
export const outreachDrafts = pgTable(
  'outreach_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commitMarketingRunId: uuid('commit_marketing_run_id')
      .references(() => commitMarketingRuns.id, { onDelete: 'cascade' })
      .notNull(),
    influencerId: uuid('influencer_id')
      .references(() => devInfluencers.id, { onDelete: 'cascade' })
      .notNull(),
    // Optional reference to the asset the draft is built around (a
    // blog post that should be DM'd to the influencer, for example).
    assetId: uuid('asset_id').references(() => assets.id, {
      onDelete: 'set null',
    }),
    channel: outreachChannelEnum('channel').notNull(),
    draftText: text('draft_text').notNull(),
    status: outreachStatusEnum('status').default('drafted').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('outreach_drafts_commit_run_id_idx').on(table.commitMarketingRunId),
    index('outreach_drafts_influencer_id_idx').on(table.influencerId),
    index('outreach_drafts_status_idx').on(table.status),
  ]
);

// ── Asset feedback event log (Layer 3 of the self-learning loop) ──
//
// Every approve / reject / edit / regenerate action on an asset
// writes a row here with the edit text and a Voyage embedding of
// the edit. The cron clusters edits by `(asset_type, category)`
// using pgvector cosine similarity, generates a one-sentence
// human-readable summary per cluster via Claude, and writes the
// summary to `strategy_insights` as an `edit_pattern` insight type.
//
// Forward-compat note: the prompt-feedback closure (agents read
// the new `edit_pattern` insights and bake them into prompt
// context) is documented in `CLAUDE.md` as next iteration. The
// data infrastructure ships in this PR so the closure is a clean
// 2-3h follow-up later.
export const assetFeedbackEvents = pgTable(
  'asset_feedback_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .references(() => assets.id, { onDelete: 'cascade' })
      .notNull(),
    action: feedbackActionEnum('action').notNull(),
    editText: text('edit_text'),
    editEmbedding: vector('edit_embedding'),
    userId: uuid('user_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('asset_feedback_events_asset_id_idx').on(table.assetId),
    index('asset_feedback_events_action_idx').on(table.action),
    index('asset_feedback_events_created_at_idx').on(table.createdAt),
  ]
);

// ── Asset cost events (Phase 9 cost tracking) ──
//
// Per-upstream-API-call cost log. Every successful request to an
// external provider inside an asset generation writes one row here
// via the `persistCostEvents` helper in the workflows service. The
// granularity is "one row per upstream call" so an operator can
// answer "what did the Anthropic call for this blog post cost us?"
// without approximating from the denormalized summary on
// `assets.cost_cents`.
//
// The tracker in `@launchkit/asset-generators` accumulates the
// events in Node's AsyncLocalStorage during the dispatch; the
// workflows service's `dispatchAsset` flushes them to this table
// after the agent returns, inside a transaction that also updates
// the asset row's denormalized total.
//
// Non-blocking invariant: a failed insert into this table MUST NOT
// fail the asset generation it's tracking. The persist helper wraps
// the transaction in try/catch and logs on failure. A user's blog
// post always ships, even if the cost write crashes.
export const assetCostEvents = pgTable(
  'asset_cost_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable since migration 0010: session-scoped cost events
    // (Pika video meeting) set this to NULL and rely on project_id
    // for aggregation. Per-asset events (Anthropic, fal, ElevenLabs,
    // World Labs, Voyage) continue to populate asset_id exactly as
    // before. The FK + ON DELETE CASCADE still apply to rows that
    // carry a concrete asset_id; NULL rows are unaffected by the
    // cascade.
    assetId: uuid('asset_id').references(() => assets.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    // `anthropic | fal | elevenlabs | world_labs | voyage | pika`.
    // Not a pgEnum so adding a provider doesn't require a migration
    // — the Zod enum in `schemas/asset-cost-event.ts` is the source
    // of truth for which values the dashboard knows how to render.
    provider: varchar('provider', { length: 32 }).notNull(),
    // `messages.create | flux-pro-ultra-image | kling-video-standard
    // | tts | marble-generate | embed`. Free-form so a future
    // provider-specific operation can be added without a schema
    // change.
    operation: varchar('operation', { length: 64 }).notNull(),
    // Input unit count (tokens, characters). Null for fixed-cost
    // operations that don't have a meaningful per-unit count.
    inputUnits: bigint('input_units', { mode: 'number' }),
    // Output unit count (tokens, video seconds, images). Null for
    // fixed-cost operations.
    outputUnits: bigint('output_units', { mode: 'number' }),
    costCents: integer('cost_cents').notNull(),
    // Per-event free-form metadata (model id, aspect ratio, voice
    // id, …). Displayed on the dashboard's breakdown modal; never
    // read by the worker.
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('asset_cost_events_project_id_idx').on(table.projectId),
    index('asset_cost_events_asset_id_idx').on(table.assetId),
    index('asset_cost_events_provider_idx').on(table.provider),
  ]
);

// ── Pika video-meeting sessions ──
//
// One row per "Invite AI teammate to a meet" click on the project
// dashboard. The BullMQ `pika` queue's invite processor inserts the
// row with `status='pending'`, spawns the vendored
// `pikastreaming_videomeeting.py` CLI via `child_process.spawn`,
// captures the Pika-side session identifier from the streaming JSON
// stdout, and updates the row through the linear lifecycle
//
//     pending → joining → active → ending → ended
//                     ↘ failed
//
// See the migration 0010_pika_meeting_sessions.sql file for the full
// column rationale and the valid status values. Application-level
// validation lives in `packages/shared/src/schemas/pika.ts`
// (`PikaSessionStatusSchema`, `PikaMeetingSessionRowSchema`).
export const pikaMeetingSessions = pgTable(
  'pika_meeting_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    // Raw Google Meet / Zoom URL passed to `--meet-url`. TEXT
    // because upstream URLs have no reasonable length cap.
    meetUrl: text('meet_url').notNull(),
    // Display name used by the Pika avatar in the meeting. Falls
    // back to `{project.displayName} teammate` at invite time when
    // the dashboard does not supply one.
    botName: text('bot_name').notNull(),
    // The raw PIKA_AVATAR value passed to the `--image` flag of the
    // Python CLI. Either an absolute local file path OR an https://
    // URL — the CLI handles both transparently. Stored so a future
    // regenerate path can round-trip the same avatar.
    avatarRef: text('avatar_ref').notNull(),
    // Null means the default voice (English_radiant_girl) is used
    // at spawn time.
    voiceId: text('voice_id'),
    // Per-project system prompt built at invite time from
    // repoAnalysis + research + strategy + asset metadata, capped
    // at 4 KB by the builder. Stored verbatim for diff + replay.
    systemPrompt: text('system_prompt'),
    // Returned by the join subprocess on its first stdout line.
    // Null during `pending` and the initial moments of `joining`;
    // becomes non-null before status flips to `active`. Indexed
    // for the leave flow's row lookup.
    pikaSessionId: text('pika_session_id'),
    // Application-level enum (varchar(32)) — see
    // `PikaSessionStatusSchema` in `schemas/pika.ts` for the six
    // valid values and the state machine they form.
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    // Structured failure message from the TypeScript wrapper's
    // error class on non-zero exit. Null on the happy path.
    error: text('error'),
    // Set when status first flips to `active`. Used by
    // `computePikaMeetingCostCents` at leave time.
    startedAt: timestamp('started_at'),
    // Set when status flips to `ended` or `failed`. The difference
    // (ended_at - started_at) drives the billable duration.
    endedAt: timestamp('ended_at'),
    // Computed at leave time and cached on the row so the
    // dashboard per-session chip does not need to query the cost
    // event log on every render.
    costCents: integer('cost_cents').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('pika_meeting_sessions_project_id_idx').on(table.projectId),
    index('pika_meeting_sessions_pika_session_id_idx').on(table.pikaSessionId),
    index('pika_meeting_sessions_status_idx').on(table.status),
  ]
);

// ── Relations ──

export const projectsRelations = relations(projects, ({ many }) => ({
  assets: many(assets),
  jobs: many(jobs),
  webhookEvents: many(webhookEvents),
  commitMarketingRuns: many(commitMarketingRuns),
  costEvents: many(assetCostEvents),
  pikaMeetingSessions: many(pikaMeetingSessions),
}));

export const assetsRelations = relations(assets, ({ one, many }) => ({
  project: one(projects, {
    fields: [assets.projectId],
    references: [projects.id],
  }),
  feedbackEvents: many(assetFeedbackEvents),
  costEvents: many(assetCostEvents),
}));

export const assetCostEventsRelations = relations(
  assetCostEvents,
  ({ one }) => ({
    asset: one(assets, {
      fields: [assetCostEvents.assetId],
      references: [assets.id],
    }),
    project: one(projects, {
      fields: [assetCostEvents.projectId],
      references: [projects.id],
    }),
  })
);

export const pikaMeetingSessionsRelations = relations(
  pikaMeetingSessions,
  ({ one }) => ({
    project: one(projects, {
      fields: [pikaMeetingSessions.projectId],
      references: [projects.id],
    }),
  })
);

export const jobsRelations = relations(jobs, ({ one }) => ({
  project: one(projects, {
    fields: [jobs.projectId],
    references: [projects.id],
  }),
}));

export const webhookEventsRelations = relations(
  webhookEvents,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [webhookEvents.projectId],
      references: [projects.id],
    }),
    commitMarketingRuns: many(commitMarketingRuns),
  })
);

export const commitMarketingRunsRelations = relations(
  commitMarketingRuns,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [commitMarketingRuns.projectId],
      references: [projects.id],
    }),
    webhookEvent: one(webhookEvents, {
      fields: [commitMarketingRuns.webhookEventId],
      references: [webhookEvents.id],
    }),
    outreachDrafts: many(outreachDrafts),
  })
);

export const outreachDraftsRelations = relations(outreachDrafts, ({ one }) => ({
  commitMarketingRun: one(commitMarketingRuns, {
    fields: [outreachDrafts.commitMarketingRunId],
    references: [commitMarketingRuns.id],
  }),
  influencer: one(devInfluencers, {
    fields: [outreachDrafts.influencerId],
    references: [devInfluencers.id],
  }),
  asset: one(assets, {
    fields: [outreachDrafts.assetId],
    references: [assets.id],
  }),
}));

export const devInfluencersRelations = relations(devInfluencers, ({ many }) => ({
  outreachDrafts: many(outreachDrafts),
}));

export const assetFeedbackEventsRelations = relations(
  assetFeedbackEvents,
  ({ one }) => ({
    asset: one(assets, {
      fields: [assetFeedbackEvents.assetId],
      references: [assets.id],
    }),
  })
);
