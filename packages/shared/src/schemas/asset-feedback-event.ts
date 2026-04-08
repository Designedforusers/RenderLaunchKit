import { z } from 'zod';
import { FeedbackActionSchema } from '../enums.js';

/**
 * Schema for a single asset feedback event — Layer 3 of the
 * self-learning loop.
 *
 * Mirrors the `asset_feedback_events` Drizzle table. Every
 * approve / reject / edit / regenerate action on an asset writes
 * a row here with the edit text and a Voyage embedding of the
 * edit. The cron clusters edits by `(asset_type, category)`
 * using pgvector cosine similarity, generates a one-sentence
 * human-readable summary per cluster via Claude, and writes the
 * summary to `strategy_insights` as an `edit_pattern` insight type.
 *
 * Forward-compat note: the prompt-feedback closure (agents read
 * the new `edit_pattern` insights and bake them into prompt
 * context) is documented in `CLAUDE.md` as next iteration. The
 * data infrastructure ships in this PR; the closure is a clean
 * 2-3h follow-up later.
 */
export const AssetFeedbackEventSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  action: FeedbackActionSchema,
  editText: z.string().nullable(),
  editEmbedding: z.array(z.number()).nullable(),
  userId: z.string().uuid().nullable(),
  createdAt: z.date(),
});
export type AssetFeedbackEvent = z.infer<typeof AssetFeedbackEventSchema>;

/**
 * Discriminated union for the `POST /api/assets/:id/feedback`
 * request body. The schema requires `editText` only when
 * `action === 'edited'`; the other actions don't carry an edit
 * payload. Catches the common API misuse "POST {action: 'edited'}
 * with no editText" at the boundary instead of producing a row
 * with a NULL edit_text we can't cluster on.
 */
export const AssetFeedbackEventRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approved') }),
  z.object({ action: z.literal('rejected') }),
  z.object({
    action: z.literal('edited'),
    editText: z.string().min(1),
  }),
  z.object({ action: z.literal('regenerated') }),
]);
export type AssetFeedbackEventRequest = z.infer<
  typeof AssetFeedbackEventRequestSchema
>;
