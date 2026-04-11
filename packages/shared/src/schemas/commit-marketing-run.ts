import { z } from 'zod';
import { CommitRunStatusSchema } from '../enums.js';

/**
 * Schema for a single commit-triggered marketing run.
 *
 * Mirrors the `commit_marketing_runs` Drizzle table. Each row is
 * one "the user pushed a commit, LaunchKit produced a kit" event,
 * linking the source webhook event, the trends used as context, and
 * the asset IDs the fan-out generated. Powers the continuous launch
 * feed dashboard view at `/projects/:id/feed`.
 *
 * The `trendsUsed` jsonb column is a snapshot — it captures what was
 * used at fan-out time so the dashboard can render a past run
 * faithfully without having to re-resolve the current state of the
 * trend signals table.
 */

export const TrendUsedSnapshotSchema = z.object({
  trendSignalId: z.string().uuid(),
  topic: z.string(),
  source: z.string(),
  velocityScore: z.number(),
  relevanceScore: z.number(),
});
export type TrendUsedSnapshot = z.infer<typeof TrendUsedSnapshotSchema>;

export const CommitMarketingRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  webhookEventId: z.string().uuid(),
  commitSha: z.string(),
  commitMessage: z.string().nullable(),
  trendsUsed: z.array(TrendUsedSnapshotSchema).nullable(),
  assetIds: z.array(z.string().uuid()).nullable(),
  status: CommitRunStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CommitMarketingRun = z.infer<typeof CommitMarketingRunSchema>;

export const CommitMarketingRunInsertSchema = z.object({
  projectId: z.string().uuid(),
  webhookEventId: z.string().uuid(),
  commitSha: z.string(),
  commitMessage: z.string().optional(),
  trendsUsed: z.array(TrendUsedSnapshotSchema).optional(),
  assetIds: z.array(z.string().uuid()).optional(),
  status: CommitRunStatusSchema.default('pending'),
});
export type CommitMarketingRunInsert = z.infer<
  typeof CommitMarketingRunInsertSchema
>;
