# ADR-004: AsyncLocalStorage for per-asset cost tracking

**Status:** Accepted
**Date:** 2026-04-10
**Deciders:** @designforusers

## Context

Every asset generation spans 3-5 heterogeneous upstream calls. A
`voice_commercial` fans out across a Claude call for the script plus
one or more ElevenLabs TTS renders for the audio buffer. A
`product_video` hits Claude for the storyboard, fal.ai for the
keyframe image, fal.ai again for the Kling video render, and sometimes
ElevenLabs for a voiceover track. A `world_scene` is one Claude call
for the prompt plus a long World Labs Marble polling loop. The
dashboard has to attribute the real-dollar cost of each of those
upstream hits back to the single asset row the user generated —
"Generated for $0.47" on the per-asset card and "$8.32 total for this
project" on the project chip — so the operator can see per-provider
spend at a glance.

The naive implementation is to thread a `CostTracker` parameter through
every function signature from the dispatch site down to the upstream
clients. `dispatchAsset` creates the tracker, passes it to
`assetGenerators.generateProductVideoAsset(...)`, which passes it
through to the fal, Anthropic, and ElevenLabs clients, each of which
appends events before returning. That approach is explicit, type-safe,
and easy to trace in a debugger. It is also a ~20-file blast radius:
the `LLMClient` interface in `packages/asset-generators/src/types.ts`,
every agent factory under `packages/asset-generators/src/agents/`,
every client method under `packages/asset-generators/src/clients/`,
every test stub that ever instantiates an agent, and every intermediate
helper that forwards the call.

Worse, the worker has four non-asset-gen agents
(`launch-strategy-agent`, `outreach-draft-agent`,
`commit-marketability-agent`, `launch-kit-review-agent` under
`apps/worker/src/agents/`) that all call the same
`createAnthropicLLMClient` factory as the asset-generation pipeline.
Those four have no asset to charge against — they run during strategy
synthesis, outreach drafting, commit marketing, and the
creative-director review pass. Parameter-threading would force them to
synthesise a dummy tracker, sprinkle null-checks through every client,
or grow a parallel "untracked" code path that calls a different LLM
client. Every option is worse than the alternative.

## Decision

Use Node's built-in `AsyncLocalStorage` to carry the tracker through the
async call tree without touching intermediate function signatures. The
store lives module-scope in
`packages/asset-generators/src/cost-tracker.ts:121`, the dispatch site
wraps the agent routing switch in
`runWithCostTracker(tracker, async () => { ... })`, and every upstream
client calls `recordCost({ provider, operation, costCents, metadata })`
after its upstream request returns successfully. `recordCost` reads the
active tracker from the store (`store.getStore()` at
`cost-tracker.ts:149`); if nothing is in scope the call is silently
dropped, which is exactly what the non-asset-gen callers need.

The dispatch-site wrap at
`apps/workflows/src/lib/dispatch-asset.ts:213-347`:

```ts
const costTracker = new CostTracker();

await runWithCostTracker(costTracker, async () => {
  if (assetType === 'og_image' || assetType === 'social_card') {
    const result = await assetGenerators.generateMarketingImageAsset({ ... });
    // ...
  } else if (assetType === 'product_video') {
    const result = await assetGenerators.generateProductVideoAsset({ ... });
    // ...
  }
  // ...eight more branches, none of them aware of cost tracking
});
```

Four upstream-call boundaries record into the tracker.
`packages/asset-generators/src/clients/fal.ts` has four `recordCost`
sites at lines 167/227/313/370, one per image-and-video operation.
`packages/asset-generators/src/clients/elevenlabs.ts` has three sites at
197/275/347, one for single-voice TTS, one for the dialogue API, and one
for the per-line fallback.
`packages/asset-generators/src/clients/world-labs.ts` has one site at 327
after the Marble polling loop resolves.
`packages/asset-generators/src/lib/create-anthropic-llm-client.ts` has
two sites at 116/174 for `generateContent` and `generateJSON`, each
reading `response.usage.input_tokens` and `response.usage.output_tokens`
straight off the SDK response.

The two thin wrappers `apps/worker/src/lib/anthropic-claude-client.ts`
and `apps/workflows/src/lib/anthropic-claude-client.ts` are one-line
re-exports of that shared factory with per-service env bindings. The
instrumentation lives once in the package, and each backend service
injects its own `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` at call time.

After the agent returns, `dispatchAsset` flushes the events at
`dispatch-asset.ts:379-391` via `persistCostEvents`, which writes a
single transaction: one batch insert into `asset_cost_events` plus one
UPDATE on the asset row's denormalized `cost_cents` and `cost_breakdown`
columns. The error path at `dispatch-asset.ts:407-424` does the same
flush for partial events captured before a mid-generation throw —
upstream calls that succeeded before the agent failed still cost real
money, and the operator deserves to see them on the dashboard chip.

## Consequences

### Positive

- **Minimum-viable diff.** The tracker-threading change touches exactly
  two places: the one wrap at `dispatch-asset.ts:221-347` and the
  `recordCost` call at each upstream-call boundary. Every intermediate
  agent factory, every switch branch, every helper signature, every test
  stub stays untouched. The parameter-passing alternative would have
  rippled through the `LLMClient` interface, 11 agent factories, every
  client method, and every consumer — a ~20-file, ~50-signature change
  for a feature that lands in 2.
- **Non-asset-gen callers stay silent.** The worker's
  `launch-strategy-agent`, `outreach-draft-agent`,
  `commit-marketability-agent`, and `launch-kit-review-agent` all import
  the same `createAnthropicLLMClient` factory as the asset-generation
  pipeline. Their calls run outside any `runWithCostTracker` scope, so
  `store.getStore() === undefined` and `recordCost` exits without
  appending. Zero noise in `asset_cost_events` from non-asset work,
  zero signature changes, zero conditional logic in the clients.
- **Test ergonomics.** `store.run(tracker, fn)` scopes the tracker to
  the awaited async chain of `fn` — two concurrent `dispatchAsset`
  calls on the same workflows dyno see two independent trackers
  despite sharing the module-scoped store. Tests wrap the code under
  test in `runWithCostTracker(realTracker, async () => { ... })` and
  inspect `realTracker.getEvents()` after the promise resolves. No
  global state leakage, no fake tracker to pass to every helper.
- **Non-blocking by construction.** A failure inside `persistCostEvents`
  is wrapped in a `try/catch` at `dispatch-asset.ts:379-391` that logs
  and returns. The user's asset ships even if the cost write hiccupped.
  The helper's own internal `try/catch` is the first layer, the
  dispatch-site wrap is the belt-and-braces second layer, `recordCost`
  being a no-op outside a tracker scope is the third, and `pricing.ts`
  returning `0` on an unknown model id is the fourth. Four independent
  guards — `docs/cost-tracking.md` § "The non-blocking invariant"
  enumerates all four and why each is load-bearing.
- **Cached paths don't charge.** The ElevenLabs cache-hit check at
  `clients/elevenlabs.ts:175` returns BEFORE reaching the `recordCost`
  call at line 197; the same ordering holds at the dialogue and
  per-line branches. The fal client's no-API-key placeholder branch
  returns before its `recordCost` sites, and World Labs polling retries
  short-circuit before theirs. Cached and placeholder outcomes never
  record a charge — only real upstream hits do.

### Negative

- **Magic at a distance.** A reader of `create-anthropic-llm-client.ts`
  sees `recordCost({...})` and has to know that a tracker might be in
  scope up the async tree. The helper docstring at
  `cost-tracker.ts:7-61` and the § "Cost tracking" section in
  `CLAUDE.md` are the load-bearing docs — without them a new
  contributor could reasonably wonder where the tracker came from. The
  name `recordCost` is a hint that the operation is context-dependent,
  but the convention is learned, not inferred from the signature.
- **Node-only.** `AsyncLocalStorage` comes from `node:async_hooks`, so
  the cost-tracker module cannot be browser-built. That constraint is
  already true of `@launchkit/asset-generators` (it imports `node:fs`,
  `node:crypto`, the Anthropic SDK, the fal SDK) so no new restriction
  is introduced. It is, however, the reason `pricing.ts` and
  `asset-cost-event.ts` live in `@launchkit/shared` (browser-buildable)
  while `cost-tracker.ts` lives in `@launchkit/asset-generators`
  (Node-only, alongside the clients that record into it).
- **Small per-run memory overhead.** ALS carries a few hundred bytes
  per tracker through the async chain. Negligible at this workload
  (one dispatch per asset, 5-15 assets per project).
- **Cross-promise-boundary edge cases.** Modern Node propagates ALS
  context correctly across `await`, `setImmediate`, and native promise
  continuations, but custom thenables have historically dropped it.
  We have not hit one in this codebase.

### Neutral

- **Integer cents only.** Every helper in `packages/shared/src/pricing.ts`
  returns non-negative integer cents via `Math.ceil`. The dashboard
  divides by 100 with `(cents / 100).toFixed(2)` exclusively at display
  time. No floating-point dollar math at any layer. `Math.ceil` is
  deliberate: undercounting hides spend from the operator; overcounting
  by less than one cent is noise.
- **Adding a new provider is a three-step recipe.** Add the rate table
  and `compute<Provider>CostCents` helper to `pricing.ts`, extend
  `CostEventProviderSchema` in
  `packages/shared/src/schemas/asset-cost-event.ts`, and call
  `recordCost` in the client file below every early-return guard. The
  tracker, `persistCostEvents`, and the
  `/api/projects/:projectId/costs` route at
  `apps/web/src/routes/project-cost-routes.ts` all pick up the new
  provider automatically because they are schema-driven. Documented in
  `docs/cost-tracking.md` § "Adding a new provider".

## Alternatives considered

- **Thread a `tracker` parameter through every function signature.**
  Explicit, type-safe, no implicit context, easy to trace in a
  debugger. Rejected because the blast radius — the `LLMClient`
  interface, 11 agent factories, every client method, every test stub —
  is ~20 files and ~50 signatures for a feature that lands in 2 with
  ALS. The four non-asset-gen worker agents would additionally need to
  synthesise or null-check a dummy tracker for every call. The diff
  cost is the load-bearing argument against it.
- **Global mutable singleton** (`setCurrentTracker(tracker); doWork();
  clearCurrentTracker()`). Rejected because it breaks under any async
  concurrency. Two simultaneous `dispatchAsset` calls on the same
  workflows dyno would trample each other's trackers and record costs
  against whichever asset happened to be currently-set at the moment of
  the upstream hit. `AsyncLocalStorage` is specifically the primitive
  Node ships to solve exactly this problem correctly, and re-inventing
  it with module-scoped state would reintroduce the race in a form that
  only manifests under concurrent load.
- **Return cost events alongside every function's return value**
  (`{ result, costEvents }`). Rejected because it forces every helper
  in the async tree to grow a `costEvents` field and every caller to
  merge them — the same blast radius as parameter threading with
  worse ergonomics, because the result shape now carries a bookkeeping
  concern. The "no tracker in scope" no-op case would also need a
  sentinel value on the return shape.
- **Emit cost events via a Node `EventEmitter`**
  (`tracker.emit('cost', event)`). Rejected because it has the same
  "where does the tracker come from" problem as parameter threading —
  the emitter instance still needs to be reachable from the call site,
  which means either a parameter or a module-scoped singleton. ALS is
  the right primitive for "ambient context scoped to an async tree",
  and the `EventEmitter` approach is just ALS with an extra layer of
  indirection and a weaker typing story.
- **External observability backend** (Langfuse, Helicone, OpenLLMetry,
  generic OTel collector). Rejected because the dashboard needs to
  read per-project totals via SQL for the project cost chip — a
  second backend would mean another service to deploy, another
  credential to manage, and a join across systems for a single label.
  The in-Postgres approach ships in one migration and reads via one
  `SUM(cost_cents) GROUP BY provider` query at
  `apps/web/src/routes/project-cost-routes.ts`. A future PR can bolt
  on an external sink without touching the primary path.

## References

- `CLAUDE.md` § "Cost tracking" — canonical short-form rules
- `docs/cost-tracking.md` — long-form explainer with the four-layer
  non-blocking invariant
- `packages/asset-generators/src/cost-tracker.ts` — `CostTracker`,
  `runWithCostTracker`, `recordCost`
- `apps/workflows/src/lib/dispatch-asset.ts:213-347` — the single
  wrap site
- `apps/workflows/src/lib/persist-cost-events.ts` — non-throwing DB
  flush
- `packages/asset-generators/src/lib/create-anthropic-llm-client.ts` —
  Anthropic instrumentation (shared factory; the two app-side
  `anthropic-claude-client.ts` files are thin env-bound wrappers)
- `packages/asset-generators/src/clients/elevenlabs.ts:175-210` —
  canonical cache-hit-before-recordCost ordering
- `packages/asset-generators/src/clients/fal.ts`,
  `packages/asset-generators/src/clients/world-labs.ts` — other
  instrumented clients
- `packages/shared/src/pricing.ts` — rate tables and
  `compute*CostCents` helpers
- `packages/shared/src/schemas/asset-cost-event.ts` —
  `CostEventProviderSchema` and response schemas
- `apps/web/src/routes/project-cost-routes.ts` — the
  `SUM(cost_cents) GROUP BY provider` route
