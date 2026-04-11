import { z } from 'zod';
import {
  ProjectCategorySchema,
  RepoAnalysisSchema,
} from './repo-analysis.js';
import { ResearchResultSchema } from './research.js';

/**
 * Schemas for BullMQ job payloads. Mirrors the original hand-written
 * interfaces in `types.ts:170-208`.
 *
 * Every processor that consumes `job.data` should validate it against
 * the matching schema before doing any work — that gate is the
 * subject of the upcoming "validate every runtime boundary" PR. The
 * schemas below are the source of truth those validators will use.
 *
 * `JobDataSchema` is loose by design: it requires `projectId` but
 * passes through any extra fields, so the more specific schemas
 * (`AnalyzeRepoJobDataSchema`, etc.) extend it without forcing every
 * processor to enumerate the union.
 */

/**
 * Base BullMQ job payload.
 *
 * Uses `.passthrough()` rather than the default strict shape so extra
 * fields the more-specific schemas add (e.g. `repoUrl` on
 * `AnalyzeRepoJobDataSchema`) survive a parse against this base. The
 * inferred type intersects with `Record<string, unknown>` so consumers
 * can read arbitrary keys without TypeScript complaining — preserving
 * the original `interface JobData { projectId: string; [key: string]:
 * unknown }` shape exactly.
 */
export const JobDataSchema = z
  .object({
    projectId: z.string().uuid(),
  })
  .passthrough();
export type JobData = z.infer<typeof JobDataSchema> & Record<string, unknown>;

export const AnalyzeRepoJobDataSchema = z.object({
  projectId: z.string().uuid(),
  repoUrl: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
});
export type AnalyzeRepoJobData = z.infer<typeof AnalyzeRepoJobDataSchema>;

export const ResearchJobDataSchema = z.object({
  projectId: z.string().uuid(),
  repoAnalysis: RepoAnalysisSchema,
});
export type ResearchJobData = z.infer<typeof ResearchJobDataSchema>;

export const StrategizeJobDataSchema = z.object({
  projectId: z.string().uuid(),
  repoAnalysis: RepoAnalysisSchema,
  research: ResearchResultSchema,
});
export type StrategizeJobData = z.infer<typeof StrategizeJobDataSchema>;

// Phase 10 note: `GenerateAssetJobDataSchema` was removed with the
// BullMQ generation queue. Asset generation now runs as Render
// Workflows tasks whose inputs are `{ projectId, assetId }` — tasks
// re-read context from the DB at run time rather than shipping it
// inline. See `apps/workflows/src/tasks/input-schemas.ts` for the
// replacement Zod schemas.

export const ReviewJobDataSchema = z.object({
  projectId: z.string().uuid(),
  // Tightened from `string[]` to `string[]` of UUIDs. The original
  // type was loose; in practice every asset ID is the drizzle uuid
  // primary key from the `assets` table. Validating the format here
  // catches a class of bugs where a stale or hand-crafted job
  // payload passes a non-UUID and gets stuck in the queue.
  assetIds: z.array(z.string().uuid()),
});
export type ReviewJobData = z.infer<typeof ReviewJobDataSchema>;

export const FilterWebhookJobDataSchema = z.object({
  projectId: z.string().uuid(),
  webhookEventId: z.string().uuid(),
});
export type FilterWebhookJobData = z.infer<typeof FilterWebhookJobDataSchema>;

/**
 * Background trending-signal ingest. The cron enqueues one job per
 * distinct project category on its 6-hour cadence; the worker runs
 * the agentic fan-out (Grok + Exa + 5 free APIs + clustering) and
 * writes clustered rows to the `trend_signals` table. No `projectId`
 * because the ingest is cross-project — a trend row is looked up
 * by category, not by project.
 */
export const IngestTrendingSignalsJobDataSchema = z.object({
  category: ProjectCategorySchema,
  seedKeywords: z.array(z.string().min(1)).optional(),
  /**
   * Optional override for the expires_at of rows this job inserts.
   * Cron passes a computed timestamp so every row in a single ingest
   * wave shares the same TTL regardless of per-cluster latency.
   */
  expiresAt: z.coerce.date().optional(),
});
export type IngestTrendingSignalsJobData = z.infer<
  typeof IngestTrendingSignalsJobDataSchema
>;

/**
 * Background Voyage embedding of an asset feedback event's edit text
 * (Phase 7). The user-facing route POSTs an `'edited'` action, the
 * route writes the asset_feedback_events row immediately with
 * edit_text populated and edit_embedding NULL, then enqueues this
 * job. The worker picks it up, computes the Voyage embedding via
 * `inputType: 'document'`, and writes back to
 * asset_feedback_events.edit_embedding.
 *
 * Single field — the worker re-fetches the row by id rather than
 * trusting the edit text from the job payload. The row is the source
 * of truth; the job payload is just a wakeup signal. This also means
 * a re-enqueue with the same id is naturally idempotent: if the row
 * already has an embedding, the worker can skip the write.
 *
 * Phase 7 uses these embeddings in the weekly
 * `aggregate-feedback-insights` cron to cluster edits by
 * `(asset_type, category)` via pgvector cosine similarity, surfacing
 * recurring edit patterns as `edit_pattern` strategy_insights rows.
 */
export const EmbedFeedbackEventJobDataSchema = z.object({
  feedbackEventId: z.string().uuid(),
});
export type EmbedFeedbackEventJobData = z.infer<
  typeof EmbedFeedbackEventJobDataSchema
>;
