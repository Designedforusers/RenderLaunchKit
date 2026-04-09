import { z } from 'zod';

/**
 * Schemas for the cost-tracking surface introduced in PR #35.
 *
 * Three schemas live here:
 *
 *   1. `CostEventSchema` — the in-memory shape recorded by the
 *      `CostTracker` in `@launchkit/asset-generators` as each
 *      upstream API call succeeds. Persisted by the workflows
 *      service's `persistCostEvents` helper.
 *
 *   2. `AssetCostEventRowSchema` — the full DB row shape as
 *      returned by a SELECT against `asset_cost_events`. Mirrors
 *      the drizzle `assetCostEvents` table.
 *
 *   3. `ProjectCostsResponseSchema` — the response shape for the
 *      `GET /api/projects/:id/costs` route, validated before the
 *      handler returns so an invariant violation (a provider name
 *      the dashboard doesn't know about, a malformed cents value)
 *      shows up as a structured 500 instead of rendering garbage.
 *
 * The provider union is a `z.enum` rather than a free-form string so
 * the dashboard can rely on the set being closed. Adding a new
 * provider means updating this enum alongside the pricing table and
 * the client instrumentation — the type system keeps the three in
 * sync.
 */

export const CostEventProviderSchema = z.enum([
  'anthropic',
  'fal',
  'elevenlabs',
  'world_labs',
  'voyage',
  // Pika — charged per minute of meeting-bot runtime. See
  // `computePikaMeetingCostCents` in `../pricing.ts` for the rate.
  // Unlike the asset-generation providers above, a `pika` cost
  // event is tied to a `pika_meeting_sessions.id` rather than an
  // `assets.id` — the worker's leave processor writes the event
  // against a synthetic asset-less row (assetId is nullable on the
  // cost-events table; see Commit 3 migration).
  'pika',
]);
export type CostEventProvider = z.infer<typeof CostEventProviderSchema>;

/**
 * In-memory cost event shape recorded by the `CostTracker`.
 *
 * `inputUnits` and `outputUnits` are optional because fixed-cost
 * operations (one FLUX image, one Marble world) do not have a
 * meaningful per-unit count. The `metadata` blob is free-form so
 * clients can tag events with the model id, aspect ratio, voice id,
 * or anything else the operator might want to see on the breakdown
 * modal — validated loosely as `Record<string, unknown>` because the
 * downstream consumer never reads it, only displays it.
 */
export const CostEventSchema = z.object({
  provider: CostEventProviderSchema,
  operation: z.string().min(1),
  inputUnits: z.number().int().nonnegative().optional(),
  outputUnits: z.number().int().nonnegative().optional(),
  costCents: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CostEvent = z.infer<typeof CostEventSchema>;

/**
 * Full DB row shape for a single `asset_cost_events` entry. Used by
 * `parseJsonbColumn` reads when the dashboard's per-asset breakdown
 * modal pulls the raw event list off the asset's `cost_breakdown`
 * jsonb column.
 */
export const AssetCostEventRowSchema = z.object({
  id: z.string().uuid(),
  // Nullable since the Pika video-meeting integration: session-
  // scoped cost events (`provider='pika'`) set this to NULL and
  // rely on `projectId` for aggregation. Per-asset cost events
  // (Anthropic, fal, ElevenLabs, World Labs, Voyage) continue to
  // carry a concrete UUID.
  assetId: z.string().uuid().nullable(),
  projectId: z.string().uuid(),
  provider: CostEventProviderSchema,
  operation: z.string(),
  inputUnits: z.number().int().nullable(),
  outputUnits: z.number().int().nullable(),
  costCents: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
});
export type AssetCostEventRow = z.infer<typeof AssetCostEventRowSchema>;

/**
 * Per-provider aggregate row on the costs API response. `totalCents`
 * is the SUM aggregate from the handler's GROUP BY query.
 */
export const ProjectCostsByProviderSchema = z.object({
  provider: CostEventProviderSchema,
  totalCents: z.number().int().nonnegative(),
});
export type ProjectCostsByProvider = z.infer<
  typeof ProjectCostsByProviderSchema
>;

/**
 * Response shape for `GET /api/projects/:id/costs`. The handler
 * parses its own response against this schema before returning so
 * an invariant violation on the server surfaces as a 500 with a
 * structured error rather than crashing the dashboard's request
 * schema.
 */
export const ProjectCostsResponseSchema = z.object({
  projectId: z.string().uuid(),
  totalCents: z.number().int().nonnegative(),
  byProvider: z.array(ProjectCostsByProviderSchema),
});
export type ProjectCostsResponse = z.infer<typeof ProjectCostsResponseSchema>;

/**
 * Shape of the `assets.cost_breakdown` jsonb column when present.
 * The workflows service writes this inside `persistCostEvents` so
 * the dashboard can render a per-asset breakdown modal without a
 * second query against `asset_cost_events`.
 */
export const AssetCostBreakdownSchema = z.object({
  events: z.array(CostEventSchema),
});
export type AssetCostBreakdown = z.infer<typeof AssetCostBreakdownSchema>;
