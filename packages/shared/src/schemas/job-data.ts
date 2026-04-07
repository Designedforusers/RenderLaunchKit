import { z } from 'zod';
import { AssetTypeSchema } from '../enums.js';
import { RepoAnalysisSchema } from './repo-analysis.js';
import { ResearchResultSchema } from './research.js';
import { StrategyBriefSchema } from './strategy.js';
import { StrategyInsightSchema } from './strategy-insight.js';

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

export const GenerateAssetJobDataSchema = z.object({
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  assetType: AssetTypeSchema,
  generationInstructions: z.string(),
  repoName: z.string(),
  repoAnalysis: RepoAnalysisSchema,
  research: ResearchResultSchema,
  strategy: StrategyBriefSchema,
  pastInsights: z.array(StrategyInsightSchema),
  revisionInstructions: z.string().optional(),
});
export type GenerateAssetJobData = z.infer<typeof GenerateAssetJobDataSchema>;

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
