import { z } from 'zod';

/**
 * Schemas for the creative review phase of the launch pipeline.
 *
 * Mirrors the original hand-written interfaces in `types.ts:133-147`.
 * Produced by `apps/worker/src/agents/launch-kit-review-agent.ts`
 * (the creative director Claude call), persisted to
 * `projects.review_feedback` jsonb. The score drives the
 * approve-vs-revise decision in `review-generated-assets.ts`.
 */

export const AssetReviewSchema = z.object({
  assetId: z.string(),
  score: z.number().min(0).max(10),
  strengths: z.array(z.string()),
  issues: z.array(z.string()),
  revisionInstructions: z.string().optional(),
});
export type AssetReview = z.infer<typeof AssetReviewSchema>;

export const CreativeReviewSchema = z.object({
  overallScore: z.number().min(0).max(10),
  overallFeedback: z.string(),
  assetReviews: z.array(AssetReviewSchema),
  approved: z.boolean(),
  revisionPriority: z.array(z.string()),
});
export type CreativeReview = z.infer<typeof CreativeReviewSchema>;
