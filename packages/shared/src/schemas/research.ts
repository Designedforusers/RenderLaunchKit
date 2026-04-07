import { z } from 'zod';

/**
 * Schemas for the market research phase of the launch pipeline.
 *
 * Mirrors the original hand-written interfaces in `types.ts:42-64`.
 * Written by `apps/worker/src/agents/launch-research-agent.ts` (the
 * Claude Agent SDK research agent), persisted to
 * `projects.research` jsonb, and consumed by every downstream agent
 * that needs the competitive landscape and target audience.
 */

export const CompetitorSchema = z.object({
  name: z.string(),
  url: z.string(),
  description: z.string(),
  stars: z.number().int().nonnegative().optional(),
  differentiator: z.string(),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const HNMentionSchema = z.object({
  title: z.string(),
  url: z.string(),
  points: z.number().int(),
  commentCount: z.number().int().nonnegative(),
});
export type HNMention = z.infer<typeof HNMentionSchema>;

export const ResearchResultSchema = z.object({
  competitors: z.array(CompetitorSchema),
  targetAudience: z.string(),
  marketContext: z.string(),
  uniqueAngles: z.array(z.string()),
  recommendedChannels: z.array(z.string()),
  hnMentions: z.array(HNMentionSchema),
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
