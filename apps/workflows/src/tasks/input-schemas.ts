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

/**
 * Input schema for the `renderRemotionVideo` task.
 *
 * `inputProps` stays loosely typed as `unknown` at the workflow
 * boundary and is validated against the composition-specific
 * Zod schema (`LaunchKitVideoPropsSchema`, `VerticalVideoPropsSchema`,
 * ...) inside the task body — routing the parse through the
 * composition id is the only way to keep the discriminated union
 * narrow in one place. The task rejects with a structured error
 * if the props do not match the declared composition.
 *
 * Payload size caveat: the narrated variant embeds an
 * `audioSrc` data URI inside `inputProps.audioSrc`, which can
 * reach 3-5 MB for a 30-60 second voiceover. The Render
 * Workflows SDK serializes task inputs over HTTP; large payloads
 * work but are slower than URL-referenced assets. A future
 * follow-up replaces the data URI with a MinIO-hosted audio URL
 * composed by the web service before the task call.
 */
export const RenderRemotionVideoInputSchema = z.object({
  assetId: z.string().min(1),
  version: z.number().int().positive(),
  compositionId: z.enum([
    'LaunchKitProductVideo',
    'LaunchKitVoiceCommercial',
    'LaunchKitPodcastWaveform',
    'LaunchKitVerticalVideo',
  ]),
  inputProps: z.unknown(),
  variant: z.enum(['visual', 'narrated']).default('visual'),
  cacheSeed: z.string().optional(),
});
export type RenderRemotionVideoInput = z.infer<
  typeof RenderRemotionVideoInputSchema
>;

export const RenderRemotionVideoResultSchema = z.object({
  url: z.string().url(),
  key: z.string().min(1),
  cached: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
});
export type RenderRemotionVideoResult = z.infer<
  typeof RenderRemotionVideoResultSchema
>;
