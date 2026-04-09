import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  CostEvent,
  CostEventProvider,
} from '@launchkit/shared';

/**
 * Per-asset-generation cost tracking via Node's `AsyncLocalStorage`.
 *
 * The pattern
 * -----------
 *
 *   1. `dispatchAsset` (in `apps/workflows/src/lib/dispatch-asset.ts`)
 *      creates a `CostTracker` instance per asset generation.
 *   2. It runs the agent call inside
 *      `runWithCostTracker(tracker, () => {...})`.
 *   3. Every client in this package (fal, elevenlabs, world-labs) and
 *      every copy of `anthropic-claude-client.ts` in `apps/worker` and
 *      `apps/workflows` calls `recordCost(...)` after its upstream
 *      request returns successfully. If a tracker is present in the
 *      current async scope, the event is appended. If not (e.g. the
 *      worker's four non-asset-gen agents use the same Anthropic
 *      client), `recordCost` is a no-op.
 *   4. After the agent returns, `dispatchAsset` reads
 *      `tracker.getEvents()` and persists them to the
 *      `asset_cost_events` table via `persistCostEvents`.
 *
 * Why AsyncLocalStorage instead of threading a `tracker` parameter
 * ----------------------------------------------------------------
 *
 * Adding a parameter would ripple through every client signature,
 * every agent factory, every test. ALS threads the context through
 * automatically via `async_hooks` and keeps the public signatures
 * unchanged — the diff lands in exactly the places that matter
 * (the dispatch site and the upstream-call boundaries), and every
 * intermediate agent is untouched.
 *
 * Why this lives in `packages/asset-generators/` and not `shared`
 * ----------------------------------------------------------------
 *
 * The tracker's `recordCost` is the call-site pattern used by the
 * client files in this package. Moving it to `@launchkit/shared`
 * would force the dashboard (browser) or `@launchkit/shared`
 * (browser-buildable) to pull in `node:async_hooks`, which they
 * cannot. The tracker stays in this Node-only package alongside
 * the Node-only clients that record into it.
 *
 * Fail-closed invariant
 * ---------------------
 *
 * `recordCost` outside a tracker scope is a no-op — it does NOT
 * throw. The two common cases for "no tracker present" are:
 *
 *   - The worker's non-asset-gen agents calling the shared
 *     Anthropic client. Those calls should not be tracked on a
 *     per-asset basis because they don't belong to an asset.
 *   - Early boot-time smoke tests that import the clients for
 *     validation but don't exercise the dispatch loop.
 *
 * Both cases are correct "do nothing" outcomes.
 */

/**
 * `CostEvent` and `CostEventProvider` are defined in
 * `@launchkit/shared`'s `schemas/asset-cost-event.ts` as Zod-inferred
 * types — single source of truth across the package boundary.
 * Re-exported here so package consumers can import both the
 * runtime surface (`recordCost`, `CostTracker`) and the event
 * shape from a single entry point.
 */
export type { CostEvent, CostEventProvider };

/**
 * Tracker for a single asset generation. Created by `dispatchAsset`
 * and handed to `runWithCostTracker`. The tracker is intentionally a
 * bare array-backed accumulator — no locking, no IO, no side effects
 * — because it runs inside a single async scope and the flush
 * happens exactly once at the end of that scope.
 */
export class CostTracker {
  private readonly events: CostEvent[] = [];

  /**
   * Append one event to the tracker. Called by every upstream
   * client on success. The call site is responsible for computing
   * the cost in integer cents via the helpers in
   * `@launchkit/shared/pricing`.
   */
  record(event: CostEvent): void {
    this.events.push(event);
  }

  /**
   * Return a snapshot of the recorded events. The return type is
   * `readonly` so the caller cannot mutate the tracker's internal
   * buffer after the fact — the persist helper makes a defensive
   * copy for its jsonb write, and the snapshot shape is what the
   * dashboard's breakdown modal renders.
   */
  getEvents(): readonly CostEvent[] {
    return this.events;
  }

  /**
   * Sum of every recorded event's `costCents`. Integer cents in,
   * integer cents out — no floating-point math. Used by the
   * persist helper to write the denormalized `assets.cost_cents`
   * summary alongside the per-event rows.
   */
  totalCents(): number {
    return this.events.reduce((sum, event) => sum + event.costCents, 0);
  }
}

/**
 * Module-scope async-local store. One instance per process is
 * sufficient because `store.run(tracker, fn)` scopes the tracker
 * to the awaited async chain of `fn` — two concurrent dispatches
 * see two independent trackers even though they share the store.
 */
const store = new AsyncLocalStorage<CostTracker>();

/**
 * Run `fn` with `tracker` installed as the active cost tracker for
 * the duration of the async chain. Every `recordCost(...)` call
 * that lands inside `fn`'s microtask tree (direct or indirect)
 * appends to the provided tracker.
 *
 * The signature returns a `Promise<T>` so the caller can await the
 * wrapped work and read back the tracker's events after the
 * promise resolves. The caller holds the tracker reference — this
 * function is a pure context-binding, not a lifecycle manager.
 */
export function runWithCostTracker<T>(
  tracker: CostTracker,
  fn: () => Promise<T>
): Promise<T> {
  return store.run(tracker, fn);
}

/**
 * Append one cost event to the currently-active tracker, if any.
 * When there is no active tracker in the current async scope, the
 * call is silently dropped — this is by design so the same
 * upstream clients can be reused by non-asset-gen callers without
 * needing to know about cost tracking.
 */
export function recordCost(event: CostEvent): void {
  const tracker = store.getStore();
  if (tracker !== undefined) {
    tracker.record(event);
  }
}
