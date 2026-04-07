import { z } from 'zod';

/**
 * Schemas for the parsed voiceover script that the writer agent emits
 * alongside a video storyboard.
 *
 * Mirrors the original hand-written types in
 * `packages/shared/src/voiceover.ts` and replaces the hand-rolled
 * `isParsedVoiceoverScript` type guard. Consumers can now do
 * `ParsedVoiceoverScriptSchema.safeParse(metadata)` to validate the
 * shape with structured error messages instead of a boolean.
 *
 * Used by:
 *
 *   - `apps/web/src/lib/narration.ts` (alignment → captions)
 *   - `apps/web/src/routes/asset-api-routes.ts` (narrated MP4 render)
 *   - `apps/worker/src/agents/product-video-agent.ts` (writer output)
 */

export const VoiceoverSegmentSchema = z.object({
  screenCue: z.string(),
  text: z.string(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
});
export type VoiceoverSegment = z.infer<typeof VoiceoverSegmentSchema>;

export const ParsedVoiceoverScriptSchema = z.object({
  segments: z.array(VoiceoverSegmentSchema),
  plainText: z.string(),
  segmentCount: z.number().int().nonnegative(),
});
export type ParsedVoiceoverScript = z.infer<typeof ParsedVoiceoverScriptSchema>;
