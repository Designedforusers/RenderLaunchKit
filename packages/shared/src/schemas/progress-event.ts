import { z } from 'zod';

/**
 * Schema for SSE progress events emitted by the worker via Redis
 * pub/sub and forwarded to the dashboard. Mirrors the original
 * hand-written `ProgressEvent` interface in `types.ts:151-156`.
 *
 * The `data` field is `z.record(z.string(), z.unknown())` rather than
 * a tagged union per `type` because the worker emits a deliberately
 * loose payload — the dashboard knows how to render each `type` and
 * `phase` combination, and tightening this would force every
 * processor to thread an exhaustive type through every progress
 * publish call. The boundary-validation PR will introduce per-event
 * narrow schemas (e.g. `PhaseStartEventSchema`) for the dashboard's
 * SSE consumer to use; this base schema stays loose so the producer
 * side does not need to tag every event.
 */

export const ProgressEventTypeSchema = z.enum([
  'phase_start',
  'phase_complete',
  'asset_ready',
  'tool_call',
  'error',
  'status_update',
]);
export type ProgressEventType = z.infer<typeof ProgressEventTypeSchema>;

export const ProgressEventSchema = z.object({
  type: ProgressEventTypeSchema,
  phase: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
