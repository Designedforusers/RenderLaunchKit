import { eq, sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import * as schema from '@launchkit/shared';
import {
  EmbedFeedbackEventJobDataSchema,
  type EmbedFeedbackEventJobData,
} from '@launchkit/shared';
import { database as db } from '../lib/database.js';
import { generateVoyageEmbedding } from '../lib/voyage-embeddings.js';
import { env } from '../env.js';

/**
 * Phase 7 — Background Voyage embedding for asset feedback events.
 *
 * Enqueued by `apps/web/src/routes/asset-api-routes.ts` whenever a
 * user POSTs an `'edited'` feedback action. The route writes the
 * `asset_feedback_events` row immediately with `edit_text` populated
 * and `edit_embedding` NULL, then fires this job. The worker reads
 * the row by id, computes a Voyage embedding of `edit_text` with
 * `inputType: 'document'`, and writes it back via raw SQL UPDATE
 * (Drizzle's typed query builder cannot serialise `number[]` into a
 * pgvector literal — same constraint as `storeProjectEmbedding` in
 * `apps/worker/src/tools/project-insight-memory.ts:109-136`).
 *
 * The user response is decoupled from this work entirely — the row
 * exists and the dashboard can render the feedback event even before
 * the embedding lands. The embedding is consumed downstream by the
 * weekly `aggregate-feedback-insights` cron's Layer 3 edit clustering
 * pass, which groups semantically similar edits into `edit_pattern`
 * insights.
 *
 * Soft-fails when `VOYAGE_API_KEY` is unset: logs once at info level
 * and returns cleanly so the BullMQ job is marked complete instead of
 * retrying forever against a permanently-missing credential. Same
 * posture as the existing `enrich-dev-influencers` processor.
 *
 * Idempotent: re-enqueueing the same `feedbackEventId` is safe. The
 * worker re-fetches the row, recomputes the embedding from the
 * current `edit_text`, and writes it back. The BullMQ job ID is set
 * to a deterministic value (`embed-feedback-event__${feedbackEventId}`)
 * by the enqueue helper so a duplicate enqueue inside the same
 * dedup window is dropped at the queue level.
 */
export async function processEmbedFeedbackEvent(
  job: Job<unknown>
): Promise<{ embedded: boolean; reason?: string }> {
  // Boundary validation — the BullMQ payload is `unknown` because the
  // queue is loosely typed. Same idiom as `processEnrichDevInfluencers`
  // and `processIngestTrendingSignals`.
  const parsed = EmbedFeedbackEventJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(
      `[embed-feedback-event] invalid job payload: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  const data: EmbedFeedbackEventJobData = parsed.data;

  // Soft-fail when Voyage isn't configured. Logged at info (not warn)
  // because a Voyage-disabled deploy is a valid state and we don't
  // want to spam logs on every user edit. The clustering pass in the
  // cron simply skips rows whose embedding is NULL.
  if (!env.VOYAGE_API_KEY) {
    console.info(
      `[embed-feedback-event] VOYAGE_API_KEY unset — skipping embed for ${data.feedbackEventId}`
    );
    return { embedded: false, reason: 'voyage-disabled' };
  }

  // Read the row by id. The job payload is the wakeup signal; the
  // row is the source of truth — using the persisted edit_text means
  // a re-enqueue after a row update embeds the latest version, not
  // a stale snapshot from the original payload.
  const row = await db.query.assetFeedbackEvents.findFirst({
    where: eq(schema.assetFeedbackEvents.id, data.feedbackEventId),
  });

  if (!row) {
    // Row was deleted between enqueue and worker pickup. Not an
    // error — just a no-op.
    console.warn(
      `[embed-feedback-event] feedback event ${data.feedbackEventId} not found — skipping`
    );
    return { embedded: false, reason: 'row-missing' };
  }

  if (row.editText === null || row.editText.length === 0) {
    // Defensive — the route should not enqueue this job for a row
    // with no edit text (the discriminated union enforces editText
    // on `'edited'` actions), but the double-check costs nothing
    // and prevents an empty embedding from poisoning the cluster.
    return { embedded: false, reason: 'no-edit-text' };
  }

  // Voyage embedding errors are NOT caught here: re-throwing is the
  // correct signal to BullMQ that this attempt failed and should
  // retry. The `enqueueEmbedFeedbackEvent` helper in
  // `apps/web/src/lib/job-queue-clients.ts` sets `attempts: 3` with
  // exponential backoff for this job specifically, overriding the
  // trending queue's default `attempts: 1` (which is correct for the
  // trending-signals ingest because the cron re-fires, but wrong
  // here because there is no cron — only the user-action route
  // enqueues, and a transient Voyage failure should not silently
  // drop the embedding forever).
  //
  // The Voyage SDK raises a `VoyageEmbeddingError` with a structured
  // message naming the failing field on shape mismatches and the
  // HTTP status on network/rate-limit failures. The error surfaces
  // in the worker logs on every retry attempt.
  const embedding = await generateVoyageEmbedding(row.editText, {
    inputType: 'document',
  });

  // Raw SQL UPDATE because Drizzle's typed builder cannot serialise
  // `number[]` into a pgvector literal. Same pattern as
  // `apps/worker/src/tools/project-insight-memory.ts:109-136` and
  // `apps/worker/src/processors/enrich-dev-influencers.ts`.
  // Every value is parameterised through the `sql` template tag —
  // no `sql.raw`, no string concatenation into SQL.
  const vectorStr = `[${embedding.join(',')}]`;
  await db.execute(sql`
    UPDATE asset_feedback_events
    SET edit_embedding = ${vectorStr}::vector
    WHERE id = ${data.feedbackEventId}
  `);

  console.log(
    `[embed-feedback-event] embedded edit text for ${data.feedbackEventId} (${String(row.editText.length)} chars)`
  );
  return { embedded: true };
}
