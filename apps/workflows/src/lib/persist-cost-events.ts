import { eq } from 'drizzle-orm';
import {
  assetCostEvents as assetCostEventsTable,
  assets as assetsTable,
  type CostEvent,
} from '@launchkit/shared';
import { database as db } from './database.js';

/**
 * Persist a batch of cost events for a single asset generation.
 *
 * Called from `dispatchAsset` after the agent returns (on both the
 * success and error paths) with whatever events the `CostTracker`
 * accumulated during the run. Writes one row per event to
 * `asset_cost_events` AND updates the denormalized `cost_cents` /
 * `cost_breakdown` columns on the asset row, all inside a single
 * transaction so a partial failure never leaves the two out of
 * sync.
 *
 * Non-blocking invariant
 * ----------------------
 *
 * A failure here MUST NOT fail the asset generation. The caller's
 * error handling stays responsible for the asset row's terminal
 * state (`failed` on agent throw, `reviewing` on success); this
 * helper just logs and returns on any DB error so the user's
 * blog post still ships.
 *
 * Empty-event short-circuit
 * -------------------------
 *
 * When the tracker recorded zero events (e.g., a pure placeholder
 * render with no upstream calls, or a failure before the first
 * upstream hit), the helper returns without touching the DB. The
 * empty UPDATE would be a no-op anyway and the extra transaction
 * round-trip is pure overhead.
 */
export async function persistCostEvents(input: {
  assetId: string;
  projectId: string;
  events: readonly CostEvent[];
  totalCents: number;
}): Promise<void> {
  if (input.events.length === 0) {
    return;
  }

  try {
    await db.transaction(async (tx) => {
      // Insert one row per recorded event. The drizzle `values`
      // helper accepts an array so we hand off the whole batch in
      // one statement rather than N inserts. Each row carries the
      // per-event metadata as-is — the jsonb column does not
      // enforce a shape, and the dashboard breakdown modal reads
      // the values opaque.
      await tx.insert(assetCostEventsTable).values(
        input.events.map((event) => ({
          assetId: input.assetId,
          projectId: input.projectId,
          provider: event.provider,
          operation: event.operation,
          inputUnits: event.inputUnits ?? null,
          outputUnits: event.outputUnits ?? null,
          costCents: event.costCents,
          metadata: event.metadata ?? null,
        }))
      );

      // Update the denormalized summary on the asset row.
      // `cost_breakdown` gets a defensive copy of the events array so
      // a future caller cannot mutate what was persisted by holding
      // the original tracker reference. The `slice()` is also what
      // lets drizzle serialise the `readonly` view into a plain array
      // for jsonb insertion without complaining about the readonly
      // marker at the type level.
      await tx
        .update(assetsTable)
        .set({
          costCents: input.totalCents,
          costBreakdown: { events: input.events.slice() },
          updatedAt: new Date(),
        })
        .where(eq(assetsTable.id, input.assetId));
    });
  } catch (err) {
    // Cost tracking failures are non-blocking. Log and continue.
    // The user's asset generation succeeds regardless — we never
    // fail a real generation because the cost write hiccupped.
    // The operator notices the missing row on the dashboard and
    // can audit by provider logs if the total seems off.
    console.error(
      `[Workflows:PersistCostEvents] cost persist failed for asset ${input.assetId}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
