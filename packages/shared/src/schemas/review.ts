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
  // `.nullish()` (accepts string, null, or undefined) rather than
  // `.optional()` (string or undefined only). On review round 2+,
  // when an asset passes quality and no revision is needed, Claude
  // correctly returns `null` for this field instead of omitting it
  // — a strict `.optional()` schema then blows up with a Zod parse
  // error and the whole review job crashes mid-pipeline, leaving
  // the project stuck in `reviewing` status forever. The downstream
  // consumers in `review-generated-assets.ts` already treat the
  // field with `?? fallback` / truthy checks, so a `null` value
  // flows through cleanly without code changes.
  revisionInstructions: z.string().nullish(),
});
export type AssetReview = z.infer<typeof AssetReviewSchema>;

export const CreativeReviewSchema = z.object({
  overallScore: z.number().min(0).max(10),
  overallFeedback: z.string(),
  assetReviews: z.array(AssetReviewSchema),
  approved: z.boolean(),
  // `.optional().default([])` for the same reason
  // `revisionInstructions` is `.nullish()` above: when the kit
  // passes review and nothing needs revising, Claude naturally
  // omits the field rather than returning an empty array. A
  // strict `z.array(z.string())` then blows up the review job
  // mid-pipeline and the project sits stuck in `reviewing`
  // forever. `.optional().default([])` lets Claude omit the
  // field, transforms the parsed value to `[]`, and keeps the
  // inferred TypeScript type as `string[]` (not `string[] |
  // undefined`) so the downstream `.length` access in
  // `review-generated-assets.ts` stays clean. Choosing
  // `.default([])` over `.nullish()` here is deliberate — we
  // want the value transformed at the parse boundary, not
  // propagated as optional through every consumer.
  revisionPriority: z.array(z.string()).optional().default([]),
});
export type CreativeReview = z.infer<typeof CreativeReviewSchema>;
