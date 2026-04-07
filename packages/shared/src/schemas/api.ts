import { z } from 'zod';
import { AssetStatusSchema, AssetTypeSchema, ProjectStatusSchema } from '../enums.js';
import { CreativeReviewSchema } from './review.js';
import { RepoAnalysisSchema } from './repo-analysis.js';
import { ResearchResultSchema } from './research.js';
import { StrategyBriefSchema } from './strategy.js';

/**
 * Schemas for the public HTTP API surface (`apps/web`).
 *
 * Mirrors the original hand-written interfaces in `types.ts:212-258`
 * and serves a second purpose: the dashboard's API client (currently
 * in `apps/dashboard/src/lib/api.ts`) duplicates these shapes today
 * with `any` for the jsonb fields. Once the boundary-validation PR
 * lands, the dashboard will import these schemas instead of
 * re-declaring its own types — single source of truth across the
 * server and the client.
 *
 * The request schemas are also intended to be used with
 * `@hono/zod-validator` so the route handlers get type-safe validated
 * inputs without per-route boilerplate.
 */

// ── Requests ────────────────────────────────────────────────────────

export const CreateProjectRequestSchema = z.object({
  repoUrl: z.string().min(1, 'Repo URL is required'),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

// ── Responses ───────────────────────────────────────────────────────

export const CreateProjectResponseSchema = z.object({
  id: z.string().uuid(),
  repoUrl: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  status: ProjectStatusSchema,
  createdAt: z.string(),
});
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;

export const AssetResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: AssetTypeSchema,
  status: AssetStatusSchema,
  content: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  qualityScore: z.number().nullable(),
  reviewNotes: z.string().nullable(),
  userApproved: z.boolean().nullable(),
  userEdited: z.boolean(),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetResponse = z.infer<typeof AssetResponseSchema>;

export const ProjectResponseSchema = z.object({
  id: z.string().uuid(),
  repoUrl: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  status: ProjectStatusSchema,
  repoAnalysis: RepoAnalysisSchema.nullable(),
  research: ResearchResultSchema.nullable(),
  strategy: StrategyBriefSchema.nullable(),
  reviewScore: z.number().nullable(),
  reviewFeedback: CreativeReviewSchema.nullable(),
  revisionCount: z.number().int().nonnegative(),
  webhookEnabled: z.boolean(),
  assets: z.array(AssetResponseSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;
