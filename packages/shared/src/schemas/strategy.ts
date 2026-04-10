import { z } from 'zod';
import { AssetTypeSchema } from '../enums.js';

/**
 * Schemas for the strategy phase of the launch pipeline.
 *
 * Mirrors the original hand-written interfaces in `types.ts:68-92`.
 * Written by `apps/worker/src/agents/launch-strategy-agent.ts`,
 * persisted to `projects.strategy` jsonb, and consumed by the
 * generation processors to know which assets to produce, in what
 * priority order, and with what tone.
 *
 * `assetsToGenerate[].type` reuses `AssetTypeSchema` from `enums.ts`,
 * which derives from the drizzle pgEnum. This means a strategy can
 * never propose generating an asset type the database doesn't know
 * about — the schema rejects it at parse time.
 */

export const StrategyToneSchema = z.enum([
  'technical',
  'casual',
  'enthusiastic',
  'authoritative',
]);
export type StrategyTone = z.infer<typeof StrategyToneSchema>;

export const ChannelStrategySchema = z.object({
  channel: z.string(),
  // Tightened from `number` to `int()` — priorities are 1..N integers
  // in the strategist agent's prompt and the existing seed data. A
  // floating-point priority would be a strategy bug, not legitimate
  // input, so the schema rejects it at parse time.
  priority: z.number().int(),
  reasoning: z.string(),
});
export type ChannelStrategy = z.infer<typeof ChannelStrategySchema>;

export const AssetGenerationPlanSchema = z.object({
  type: AssetTypeSchema,
  generationInstructions: z.string(),
  // Same tightening as `ChannelStrategy.priority` above.
  priority: z.number().int(),
});
export type AssetGenerationPlan = z.infer<typeof AssetGenerationPlanSchema>;

export const SkippedAssetSchema = z.object({
  type: z.string(),
  reasoning: z.string(),
});
export type SkippedAsset = z.infer<typeof SkippedAssetSchema>;

export const StrategyBriefSchema = z.object({
  positioning: z.string(),
  tone: StrategyToneSchema,
  keyMessages: z.array(z.string()),
  selectedChannels: z.array(ChannelStrategySchema),
  assetsToGenerate: z.array(AssetGenerationPlanSchema),
  skipAssets: z.array(SkippedAssetSchema).default([]),
});
export type StrategyBrief = z.infer<typeof StrategyBriefSchema>;
