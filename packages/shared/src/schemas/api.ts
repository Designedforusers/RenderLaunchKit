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

/**
 * Max length for a GitHub personal access token submitted alongside
 * a repo URL. GitHub's current token formats are well under 100
 * characters (classic PATs are 40 hex chars; fine-grained tokens are
 * ~93 chars including the `github_pat_` prefix); the 255 cap here is
 * a generous upper bound that rejects obvious pastebin-blob abuse
 * without rejecting any valid GitHub token shape.
 */
const GITHUB_TOKEN_MAX_LENGTH = 255;

export const CreateProjectRequestSchema = z.object({
  repoUrl: z.string().min(1, 'Repo URL is required'),
  /**
   * Optional GitHub personal access token for private-repo access.
   * When present, the web service encrypts it with AES-256-GCM and
   * persists the blob on the project row; the analyze worker decrypts
   * it once at job start and routes every GitHub API fetch for the
   * project through the user-scoped token. Omitted for public repos.
   *
   * The `.min(1)` rejects empty strings so `{ githubToken: "" }`
   * does not round-trip into the database as a zero-byte ciphertext
   * — the frontend can safely send `undefined` when the input is
   * blank and the route handler will treat it as "no token".
   */
  githubToken: z
    .string()
    .min(1)
    .max(GITHUB_TOKEN_MAX_LENGTH)
    .optional(),
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
