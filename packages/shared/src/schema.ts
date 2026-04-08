import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  real,
  integer,
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

    // Creative director scoring
    qualityScore: real('quality_score'),
    reviewNotes: text('review_notes'),

    // User feedback
    userApproved: boolean('user_approved'),
    userEdited: boolean('user_edited').default(false).notNull(),
    userEditedContent: text('user_edited_content'),

    // Version tracking for regeneration
    version: integer('version').default(1).notNull(),

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

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('strategy_insights_category_idx').on(table.category)]
);

// ── Relations ──

export const projectsRelations = relations(projects, ({ many }) => ({
  assets: many(assets),
  jobs: many(jobs),
  webhookEvents: many(webhookEvents),
}));

export const assetsRelations = relations(assets, ({ one }) => ({
  project: one(projects, {
    fields: [assets.projectId],
    references: [projects.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one }) => ({
  project: one(projects, {
    fields: [jobs.projectId],
    references: [projects.id],
  }),
}));

export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  project: one(projects, {
    fields: [webhookEvents.projectId],
    references: [projects.id],
  }),
}));
