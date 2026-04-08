import { z } from 'zod';
import { InfluencerPlatformsSchema } from './dev-influencer.js';

/**
 * Schema for a qualified dev-influencer candidate.
 *
 * This is the structured output the discovery agent emits via its
 * terminal `discovery_complete` tool, and the shape the matcher
 * returns from its pgvector topic-overlap query. A candidate is
 * explicitly distinct from a persisted `DevInfluencer` row: a
 * candidate may not yet exist in the `dev_influencers` table (the
 * enrichment loop upserts it later), and it carries agent-facing
 * fields (`matchReasoning`, `matchScore`) that never land on the
 * database row.
 *
 * Keep `platforms` in sync with `InfluencerPlatformsSchema` in
 * `./dev-influencer.ts` — candidates get upserted into the
 * `dev_influencers` table by the enrichment loop, so the two shapes
 * must agree on the platform key set.
 */
export const InfluencerCandidateSchema = z.object({
  handle: z.string().min(1),
  platforms: InfluencerPlatformsSchema,
  categories: z.array(z.string()),
  bio: z.string().nullable(),
  audienceSize: z.number().int().nonnegative(),
  recentTopics: z.array(z.string()),
  matchReasoning: z.string().min(1),
  matchScore: z.number().min(0).max(1),
});
export type InfluencerCandidate = z.infer<typeof InfluencerCandidateSchema>;
