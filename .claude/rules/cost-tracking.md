---
paths:
  - "**/cost*"
  - "**/pricing*"
  - "**/dispatch-asset*"
  - "packages/shared/src/pricing.ts"
  - "packages/shared/src/schemas/asset-cost-event*"
---

# Cost tracking

See `docs/cost-tracking.md` for the full design doc.

## Key design decisions

- **AsyncLocalStorage-based threading** — `CostTracker` is scoped per-dispatch via `runWithCostTracker()`. Provider clients call `recordCost()` which reads the tracker from ALS. No tracker in scope = no-op.
- **Integer cents only** — pricing helpers in `packages/shared/src/pricing.ts` return `Math.ceil` integer cents. Display-time division (`(cents / 100).toFixed(2)`) only.
- **Non-blocking invariant** — `persistCostEvents` failures MUST NOT fail asset generation. Double try/catch guard.
- **Cached paths don't record cost** — cache hits and placeholder branches return before `recordCost`.

## Adding a new provider

1. Add rate table + `compute<Provider>CostCents()` helper to `packages/shared/src/pricing.ts`
2. Extend `CostEventProviderSchema` enum in `packages/shared/src/schemas/asset-cost-event.ts`
3. Call `recordCost()` in the client file BELOW any early-return branches (see `elevenlabs.ts` for the pattern)

No changes to `dispatch-asset.ts`, `persist-cost-events.ts`, or the API route needed.
