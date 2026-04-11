import { z } from 'zod';
import {
  assetStatusEnum,
  assetTypeEnum,
  commitRunStatusEnum,
  feedbackActionEnum,
  projectStatusEnum,
  trendSourceEnum,
} from './schema.js';

/**
 * Domain enums derived from the drizzle pgEnum declarations.
 *
 * Why derive instead of hand-writing
 * ----------------------------------
 *
 * Before this PR, `packages/shared/src/types.ts` had three parallel
 * hand-written union types (`AssetType`, `AssetStatus`, `ProjectStatus`)
 * that mirrored the values in `packages/shared/src/schema.ts`'s
 * pgEnums. The two had to be kept in sync by convention. Adding a new
 * asset type meant editing both files; forgetting either side resulted
 * in a runtime mismatch (the database accepted a value the TypeScript
 * union rejected, or vice versa) that the typechecker could not catch.
 *
 * Drizzle's `pgEnum` exposes its values as a readonly string tuple via
 * `.enumValues`. We feed that tuple to `z.enum()` to produce a Zod
 * schema, then `z.infer` produces the TypeScript union — single source
 * of truth, automatically synchronised. Adding a new value means
 * editing one place (the pgEnum declaration), and every consumer that
 * imports `AssetType` from `@launchkit/shared` picks it up on rebuild.
 */

export const AssetTypeSchema = z.enum(assetTypeEnum.enumValues);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetStatusSchema = z.enum(assetStatusEnum.enumValues);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const ProjectStatusSchema = z.enum(projectStatusEnum.enumValues);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

// ── Phase 2: enums for the new tables in the agentic GTM build ──
//
// Same derivation pattern as the three above. Hand-written object
// schemas in `./schemas/` import these for their `source`, `status`,
// and `action` fields so the database column type and the
// application validator can never silently disagree.

export const TrendSourceSchema = z.enum(trendSourceEnum.enumValues);
export type TrendSource = z.infer<typeof TrendSourceSchema>;

export const CommitRunStatusSchema = z.enum(commitRunStatusEnum.enumValues);
export type CommitRunStatus = z.infer<typeof CommitRunStatusSchema>;

export const FeedbackActionSchema = z.enum(feedbackActionEnum.enumValues);
export type FeedbackAction = z.infer<typeof FeedbackActionSchema>;
