# Cost tracking

LaunchKit records the real provider spend for every asset generation and surfaces a per-project total on the dashboard. This document explains how the system works, why it's built the way it is, and what the rules are for extending it.

If you only read one thing in this document, read the [non-blocking invariant](#the-non-blocking-invariant). It's the rule that everything else is downstream of.

---

## The non-blocking invariant

> **Cost tracking failures must never block an asset generation.**

A failure inside the cost-tracking pipeline — a DB transaction error in `persistCostEvents`, a rate-table miss in `pricing.ts`, an unexpected throw from any provider client's `recordCost` call — must NOT propagate up the call stack to the point where it changes the asset's terminal state. The user's blog post still ships. The product video still renders. The OG image still lands in storage. The operator notices the missing row on the dashboard and can audit by provider logs if the total seems off, but the user-facing surface is unaffected.

This is enforced at four layers:

1. **`recordCost` is a no-op outside a tracker scope** (`packages/asset-generators/src/cost-tracker.ts`). The worker's three non-asset-gen agents (`launch-strategy-agent`, `commit-marketability-agent`, `launch-kit-review-agent`) call the same Anthropic client as the asset-generation pipeline; their calls fall through to a `getStore() === undefined` branch and exit silently. No tracker, no record, no error.

2. **Pricing rate-table misses warn and return zero** (`packages/shared/src/pricing.ts`). An unknown model id in any compute helper logs a `[pricing] Unknown ... — cost will be 0` warning and returns `0`. The miss is the load-bearing signal that the rate table is stale; the dashboard chip undercounts by the missing row but the asset still generates.

3. **`persistCostEvents` swallows DB errors** (`apps/workflows/src/lib/persist-cost-events.ts`). The DB transaction (one batch insert into `asset_cost_events` plus one UPDATE on the asset row's denormalized summary) runs inside a `try/catch` that logs `[Workflows:PersistCostEvents] cost persist failed for asset <id>: <reason>` and returns. The function never re-throws.

4. **`dispatchAsset` wraps both call sites in belt-and-braces try/catches** (`apps/workflows/src/lib/dispatch-asset.ts`). The success-path persist call is wrapped so a future regression in `persistCostEvents` (someone removing the internal try/catch) cannot flip a successful asset generation to `failed`. The error-path persist call (which fires on partial-cost capture before an agent throw) is wrapped for the same reason.

Together: four independent guards. A future contributor who breaks any one of them is still protected by the other three. The invariant survives entropy.

---

## Where the data lives

Two places:

### `asset_cost_events` (per-event log)

```sql
CREATE TABLE asset_cost_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider      varchar(32) NOT NULL,    -- anthropic|fal|elevenlabs|world_labs|voyage
  operation     varchar(64) NOT NULL,    -- messages.create|flux-pro-ultra-image|tts|...
  input_units   bigint,                  -- tokens, characters, null for fixed-cost
  output_units  bigint,                  -- tokens, seconds, images, null for fixed-cost
  cost_cents    integer NOT NULL,
  metadata      jsonb,                   -- model id, input shape, etc
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX asset_cost_events_project_id_idx ON asset_cost_events(project_id);
CREATE INDEX asset_cost_events_asset_id_idx   ON asset_cost_events(asset_id);
CREATE INDEX asset_cost_events_provider_idx   ON asset_cost_events(provider);
```

One row per upstream API call. The `provider` enum is the boundary check — a row with a `provider` value not in `CostEventProviderSchema` causes the API route to fail with a structured 500, not silently render garbage on the dashboard.

### `assets.cost_cents` and `assets.cost_breakdown` (denormalized summary)

```sql
ALTER TABLE assets ADD COLUMN cost_cents integer NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN cost_breakdown jsonb;
```

`cost_cents` is the per-asset total. `cost_breakdown` is the events list as a jsonb snapshot, written inside the same transaction as the per-event inserts. The denormalized summary exists so the dashboard's per-asset card label (`$0.05`) reads from the same row as everything else on the asset detail page — zero additional round-trips for the per-card cost.

The schema migration is `migrations/0009_cost_tracking.sql`. It's purely additive: a new table, two new columns, three new indexes. Safe to apply on a populated DB.

---

## The AsyncLocalStorage pattern

The interesting design choice is *how* the cost data flows from the upstream API client back to the dispatch function. Two options were on the table:

**Option A — thread the tracker through every signature.** Pass a `tracker` parameter from `dispatchAsset` → agent factory → client function → `recordCost(tracker, event)`. Type-safe, explicit, easy to trace in a debugger.

**Option B — `AsyncLocalStorage`.** Create the tracker at the dispatch site, run the agent inside `runWithCostTracker(tracker, () => ...)`, and let `recordCost(event)` read the tracker from `node:async_hooks` at the call site. The intermediate signatures stay unchanged.

I picked Option B. Three reasons:

1. **Diff blast radius.** Option A would have rippled into ~20 files (the `LLMClient` interface, every agent factory, every test stub, every client method). Option B lands the diff in exactly the two places that matter — the dispatch-site wrap and the `recordCost` call at each upstream-call boundary.

2. **Backward compatibility for non-asset-gen callers.** The worker's `launch-strategy-agent`, `commit-marketability-agent`, and `launch-kit-review-agent` all import the same `anthropic-claude-client.ts` as the asset-generation pipeline. Threading a `tracker` parameter would have forced those agents to pass `null` (or a dummy tracker) for every call. With ALS, the absence of a tracker is the signal — `recordCost` is a no-op, no signature changes, no test updates.

3. **Test ergonomics.** ALS is scope-aware — `store.run(tracker, fn)` scopes the tracker to the awaited async chain of `fn`. Two concurrent dispatches see two independent trackers even though they share the module-scoped store. A test can call `runWithCostTracker(testTracker, async () => {...})` and inspect `testTracker.getEvents()` after the promise resolves, with no global state leakage between tests.

The cost: ALS is Node-only (`node:async_hooks`). The package can't be browser-built. That's fine — `@launchkit/asset-generators` is already Node-only because it imports `node:fs`, `node:crypto`, and the Anthropic SDK; the dashboard never imports it. The browser-buildability constraint applies to `@launchkit/shared` (which is why `pricing.ts` and `asset-cost-event.ts` live there, not in the asset-generators package), but the cost tracker stays alongside the Node-only clients that record into it.

### The data flow

```
dispatchAsset (one tracker per generation)
   │
   └─ runWithCostTracker(tracker, async () => {
        │
        └─ assetGenerators.generate<Type>Asset(...)
             │
             └─ <provider>Client.<operation>(...)
                  │
                  └─ recordCost({                ← reads tracker from
                       provider, operation,        node:async_hooks store
                       costCents, metadata
                     })
      })

   (back in dispatchAsset, after the runWithCostTracker await:)

   ├─ persistCostEvents({
   │     events: tracker.getEvents(),
   │     totalCents: tracker.totalCents(),
   │   })   ← non-blocking; failures log and return
   │
   └─ projectProgressPublisher.assetReady(...)
```

The intermediate agent factories (`generateMarketingImageAsset`, `generateProductVideoAsset`, etc.) are completely unaware that cost tracking exists. They call into the provider clients normally. The clients call `recordCost`, which reads the tracker from the async-local store. The tracker accumulates events. When the agent returns, the dispatch site reads the tracker's events and persists them. Zero changes to the agent code paths.

---

## The dashboard surface

Two places on the dashboard show cost data:

1. **Project-level chip** — "Generated for $0.47" near the top of the asset gallery on the project detail page. The chip is rendered by `apps/dashboard/src/components/ProjectCostChip.tsx` and fetches from the `/api/projects/:projectId/costs` route.

2. **Per-asset card label** — small "$0.05" label on each `GeneratedAssetCard.tsx`. The card reads `costCents` directly from the asset row, which the project detail page already fetches via `/api/projects/:id`. No extra round-trip.

The API route at `apps/web/src/routes/project-cost-routes.ts` does a single `SUM(cost_cents) GROUP BY provider` query and validates the response through `ProjectCostsResponseSchema` before returning. The Zod schema's provider enum is the boundary check; a row with an unknown provider value (schema drift between the writer and the enum) surfaces as a structured 500 with a named field path, not as garbage on the dashboard.

---

## Pricing constants

Every public compute helper in `packages/shared/src/pricing.ts` returns integer cents via `Math.ceil`. The dashboard formats with `(cents / 100).toFixed(2)` only at display time. No floating-point dollar math at any layer of the system.

Source-of-truth rates are documented inline next to each table with the date they were last refreshed. The rates do not move often enough to justify a cron-driven sync against provider dashboards — a quarterly manual refresh is fine. When you touch a rate, bump the date in the comment so the next reader knows how stale the number is.

The `Math.ceil` choice is deliberate: undercounting hides spend from the operator; overcounting by less than one cent is noise. We accept a small overestimate to never undercount.

### Current rate tables (as of 2026-04)

| Provider | Operation | Rate |
|---|---|---|
| Anthropic | Opus 4.6 | $15 / 1M input tokens, $75 / 1M output tokens |
| Anthropic | Sonnet 4.6 | $3 / 1M input, $15 / 1M output |
| Anthropic | Haiku 4.5 | $0.80 / 1M input, $4 / 1M output |
| fal.ai | FLUX.2 Pro Ultra (image) | $0.055 per image |
| fal.ai | Kling 3.0 Standard (video) | $0.15 per second |
| ElevenLabs | Turbo v2 | $0.18 / 1k characters |
| ElevenLabs | Multilingual v2 | $0.30 / 1k characters |
| World Labs | Marble 1.1 | $0.50 per world (estimated) |
| World Labs | Marble 1.1 Plus | $1.50 per world (estimated) |
| Voyage | voyage-3-large | $0.18 / 1M tokens |

Voyage is currently used only in the research path (similar-project search, commit-marketing duplication guard). The research path is not yet wired up for cost tracking — the helper exists in `pricing.ts` so a follow-up PR can drop the `recordCost` call into the embedding helper without touching anything else.

---

## Adding a new provider

Three steps. Total diff: about 30 lines across three files.

### 1. Add the rate table and compute helper to `pricing.ts`

```typescript
// packages/shared/src/pricing.ts

// ── New Provider ────────────────────────────────────────────────────
//
// https://newprovider.com/pricing — rates as of 2026-MM-DD.
//
//   model-name: $X.XX per <unit>

export const NEW_PROVIDER_PRICING: Record<string, { centsPerUnit: number }> = {
  'model-name': { centsPerUnit: 50 },
};

export function computeNewProviderCostCents(
  model: string,
  units: number
): number {
  const rates = NEW_PROVIDER_PRICING[model];
  if (!rates) {
    console.warn(`[pricing] Unknown New Provider model "${model}" — cost will be 0`);
    return 0;
  }
  return Math.ceil(units * rates.centsPerUnit);
}
```

Match the existing patterns: `Record<string, { ... }>` for the table, `if (!rates)` guard with a warning that returns 0, and `Math.ceil` at the helper boundary.

### 2. Extend the `CostEventProviderSchema` enum

```typescript
// packages/shared/src/schemas/asset-cost-event.ts

export const CostEventProviderSchema = z.enum([
  'anthropic',
  'fal',
  'elevenlabs',
  'world_labs',
  'voyage',
  'new_provider',  // ← add here
]);
```

The DB column is a `varchar(32)`, not a Postgres enum, so no migration is needed. The schema enum is the boundary check the API route uses to reject schema drift.

### 3. Call `recordCost` in the client file

```typescript
// packages/asset-generators/src/clients/<provider>.ts
// (or one of the two anthropic-claude-client.ts copies)

async function callUpstream(input: ...): Promise<...> {
  if (!isConfigured) {
    return placeholderResponse;  // Cache hits and no-API-key
                                 // branches return BEFORE reaching
                                 // recordCost — they don't charge.
  }

  const response = await actualUpstreamCall(input);

  // Cost recording. The early-return branches above guarantee
  // we never charge for cached or placeholder outcomes.
  recordCost({
    provider: 'new_provider',
    operation: 'model-name',
    inputUnits: input.unitCount,
    costCents: computeNewProviderCostCents('model-name', input.unitCount),
    metadata: { /* anything useful for the dashboard breakdown modal */ },
  });

  return response;
}
```

The critical detail is that `recordCost` MUST sit BELOW any early-return branches (cache hits, no-API-key placeholders, polling-retry short-circuits). Look at `packages/asset-generators/src/clients/elevenlabs.ts` for the canonical example: the `if (existsSync(audioPath))` cache-hit branch returns BEFORE reaching the `recordCost` call further down the same function. Grep the file for `existsSync` and `recordCost` to see the ordering.

That's it. The tracker, the persist helper, the API route, and the dashboard chip all pick up the new provider automatically — no changes required.

---

## What's deliberately NOT here

A few things you might expect from a cost-tracking system that LaunchKit doesn't ship:

- **No real-time alerting.** Spend dashboards are read-on-load. There's no "you've spent $X this hour, alert" logic. For LaunchKit's scale (a take-home demo), this is over-engineering. A real production system would add a cron job that reads `asset_cost_events` and pages on anomalies.

- **No per-user spend caps.** Every project's costs are aggregated against the project_id, not against any user_id. LaunchKit is a single-tenant demo today; multi-tenant cost limiting is a separate concern that needs auth + billing first.

- **No retroactive re-pricing.** When the Anthropic rate changes, existing rows in `asset_cost_events` keep their original `cost_cents` values. The denormalized `assets.cost_cents` is also frozen. A historical-spend-correction tool would need to walk every row and re-apply the new rate, which is an operator-driven action, not an automatic one.

- **No Voyage instrumentation yet.** The research-path embedding calls (`apps/worker/src/lib/voyage-embeddings.ts`) are currently uninstrumented. The `computeVoyageCostCents` helper exists in `pricing.ts` so a follow-up PR can drop the `recordCost` call into the embedding helper without touching anything else; doing it now would have expanded PR #35's scope past the asset-generation surface, which was the deliberate boundary.

- **No external observability backend.** The data lives in Postgres because the dashboard needs to read it via SQL for the project chip. Sending it to Langfuse, Helicone, OpenLLMetry, or a generic OTel collector would mean another service to deploy and another credential to manage; LaunchKit's six services already cover the rubric for "rewarding deployment journey." See the README for the Langfuse-vs-custom trade-off discussion.

These omissions are deliberate. Every one of them would be a useful addition for a production LaunchKit at scale; none of them are needed for the take-home demo's scope.

---

## Files at a glance

| File | Purpose |
|---|---|
| `migrations/0009_cost_tracking.sql` | Schema migration — additive, safe on populated DB |
| `packages/shared/src/pricing.ts` | Rate tables + compute helpers (integer cents in, integer cents out) |
| `packages/shared/src/schemas/asset-cost-event.ts` | Zod schemas for `CostEvent`, `AssetCostEventRow`, `ProjectCostsResponse` |
| `packages/asset-generators/src/cost-tracker.ts` | `CostTracker` class + `runWithCostTracker` + `recordCost` |
| `packages/asset-generators/src/clients/fal.ts` | fal.ai client with image/video instrumentation |
| `packages/asset-generators/src/clients/elevenlabs.ts` | ElevenLabs client with TTS instrumentation (cache-hit guard) |
| `packages/asset-generators/src/clients/world-labs.ts` | World Labs Marble client with completion-poll instrumentation |
| `apps/worker/src/lib/anthropic-claude-client.ts` | Worker-side Anthropic client (instrumented) |
| `apps/workflows/src/lib/anthropic-claude-client.ts` | Workflows-side Anthropic client (instrumented; literal copy of worker's) |
| `apps/workflows/src/lib/dispatch-asset.ts` | Dispatch site — wraps agent call in `runWithCostTracker`, persists on success and partial-failure paths |
| `apps/workflows/src/lib/persist-cost-events.ts` | DB write helper — single transaction, non-throwing |
| `apps/web/src/routes/project-cost-routes.ts` | `/api/projects/:projectId/costs` route with Zod-validated response |
| `apps/dashboard/src/components/ProjectCostChip.tsx` | Dashboard chip on the project detail page |
| `apps/dashboard/src/components/GeneratedAssetCard.tsx` | Per-asset cost label |
| `tests/cost-tracking.test.mjs` | 13 smoke tests covering pricing helpers, tracker accumulation, ALS context, schema round-trips |

---

## See also

- [`CLAUDE.md`](../CLAUDE.md) — engineering invariants, "Cost tracking" subsection (the canonical short-form rules; this doc is the long-form explainer)
- [`README.md`](../README.md) — Architecture section explains why the workflows service exists and how the cost-tracking feature rides on top of it
