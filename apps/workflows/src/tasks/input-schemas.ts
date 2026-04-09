import { z } from 'zod';

/**
 * Zod schemas for workflow task inputs.
 *
 * Every task body starts with a schema `.parse(input)` call so that a
 * malformed input (from a buggy caller, a replayed run with a stale
 * payload, or a local CLI run with a typo) fails at the task boundary
 * with a named field, not as a downstream crash. Same rule that
 * applies to every other runtime boundary in the repo — see CLAUDE.md
 * "Zod at every runtime boundary".
 *
 * Inputs are intentionally tiny — tasks re-read `repoAnalysis`,
 * `research`, and `strategy` from the DB at run time. The alternative
 * (shipping the full project context inline) would blow up the task
 * input payload and create drift between the enqueue-time snapshot
 * and the current DB row.
 */

export const SingleAssetInputSchema = z.object({
  projectId: z.string().min(1),
  assetId: z.string().min(1),
});
export type SingleAssetInput = z.infer<typeof SingleAssetInputSchema>;

export const AllAssetsInputSchema = z.object({
  projectId: z.string().min(1),
});
export type AllAssetsInput = z.infer<typeof AllAssetsInputSchema>;
