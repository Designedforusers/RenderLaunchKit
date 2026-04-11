# ADR-005: Dual-path generation — Workflows for the async pipeline, direct calls for the creative studio

**Status:** Accepted
**Date:** 2026-04-10
**Deciders:** @designforusers

## Context

LaunchKit has two different generation workloads with incompatible compute profiles and UX contracts, and a single architecture cannot serve both well.

**Workload A — the launch-kit pipeline.** A user pastes a GitHub URL and walks away. `buildProjectLaunchStrategy` writes 5-15 `status='queued'` asset rows covering blog posts, social cards, a product video, a voiceover, a 3D scene, and more. Something has to dispatch each row, right-size compute per asset type, tolerate partial failure, and enqueue the creative-director review only after every child settles. Individual generations span 20 seconds (text) to 10+ minutes (video or a World Labs Marble render). The user is not watching — they come back later expecting a finished kit. This is the workload ADR-001 moved onto Render Workflows.

**Workload B — the creative studio and agent chat.** A user opens `/create`, types "skateboarding otter, 16:9, cinematic", and watches a spinner. Response latency is the UX. The request is single-shot, single-target, and I/O-bound: the Node handler is waiting on fal.ai, ElevenLabs, World Labs, or Anthropic, not doing local compute. No fan-out, no fan-in, no review loop. The agent chat at `/api/projects/:projectId/chat` streams Claude tokens over SSE with inline tool-use events — the user is typing and the tokens arrive as bytes, not as a polled job result.

Routing the creative studio or chat through Workflows pays ~1 s of cold-start per child run (ADR-001 § Negative) plus the `startTask` SDK round-trip, and for chat specifically it is architecturally impossible: you cannot stream SSE deltas through a BullMQ job response. Routing the launch-kit pipeline through the web handler holds an HTTP connection open for 10+ minutes across 5-15 parallel provider calls, which breaks on request timeouts, memory pressure, and Render's concurrent-request limits, and has no retry story when fal.ai returns a 502 on minute nine.

The two workloads are not the same problem. Treating them as the same problem is how you ship a slow creative studio and a fragile launch pipeline at the same time.

## Decision

Run both paths. Each workload gets the architecture that fits.

**Async path (Workflows).** The `generateAllAssetsForProject` parent task in `apps/workflows/src/tasks/generate-all-assets-for-project.ts` reads the project plus every `status='queued'` asset in one Drizzle `findFirst` (lines 149-152) and fans out via `Promise.allSettled` (lines 186-194) to five compute-bucketed child tasks: `generateWrittenAsset`, `generateImageAsset`, `generateVideoAsset`, `generateAudioAsset`, `generateWorldScene`. Each child delegates to `dispatchAsset` in `apps/workflows/src/lib/dispatch-asset.ts`, which validates the asset type is inside the caller's `allowedTypes` guard, runs the agent inside `runWithCostTracker`, and persists results + cost events.

Four trigger sites start the workflow via `client.workflows.startTask('${RENDER_WORKFLOW_SLUG}/generateAllAssetsForProject', [{ projectId }])`:

1. `apps/worker/src/index.ts` — the strategize handler, immediately after `buildProjectLaunchStrategy` writes queued rows.
2. `apps/worker/src/processors/review-generated-assets.ts` — the creative-review re-queue path.
3. `apps/worker/src/processors/process-commit-marketing-run.ts` — the commit-webhook refresh path.
4. `apps/web/src/routes/asset-api-routes.ts:496-563` — the user-facing Regenerate button, which re-queues one asset and fires the trigger via `apps/web/src/lib/trigger-workflow-generation.ts`.

**Sync path (direct web calls).** The creative studio endpoints live in `apps/web/src/routes/generate-routes.ts` and are mounted at `/api/generate` in `apps/web/src/index.ts:160`. Four routes (`POST /image`, `POST /video`, `POST /audio`, `POST /world`) call fal.ai, ElevenLabs, and World Labs DIRECTLY from the Hono handler via lazy-initialized clients in `apps/web/src/lib/generation-clients.ts` — `getFalClient()`, `getElevenLabsClient()`, `getWorldLabsClient()`. Each getter constructs its client on first call and caches it; if the required env var is absent or empty, it throws a structured error the route maps to a 503 via the `serviceUnavailable` helper (`generate-routes.ts:35-39`). No BullMQ hop, no queue, no DB round-trip for the generation itself.

The agent chat endpoint `POST /api/projects/:projectId/chat` in `apps/web/src/routes/chat-routes.ts` instantiates the Anthropic SDK directly and calls `messages.stream({ ... })` inside a Hono `streamSSE` handler, forwarding text deltas and tool-use events to the dashboard in real time. The route's own architecture comment (`chat-routes.ts:27-43`) spells it out: a queue delay of even 100 ms would feel like lag, chat requests are stateless so there is no durability requirement, and the web dyno already handles SSE streams for the project event feed.

The typed env module `apps/web/src/env.ts` declares `FAL_API_KEY`, `WORLD_LABS_API_KEY`, `ANTHROPIC_API_KEY`, `EXA_API_KEY`, and `ELEVENLABS_VOICE_ID_ALT` as optional so the web service still boots when a key is missing. Commit `db7a5b4 fix(deploy): expose creative studio provider keys to web service` added the matching `envVars:` entries on the `launchkit-web` block in `render.yaml` (lines 72-93); before that commit every fresh deploy of the web service returned a silent 503 on `/create` and chat even though the feature code was fully compiled into the dyno.

## Consequences

### Positive
- **Right tool per workload.** The async path gets compute isolation, run chaining, partial-failure handling, and native observability (ADR-001 § Positive). The sync path gets sub-second latency, zero queue overhead, and SSE streaming straight from the provider to the browser.
- **Platform-expertise signal.** Render Workflows for the launch-kit pipeline is the showcase piece, but the repo also demonstrates that you do NOT need Workflows for every generation call. The creative studio proves the team understands when orchestration is load-bearing versus when it is overhead.
- **Creative studio is fork-friendly.** Someone who wants to ship only the creative studio can delete `apps/workflows/` and `apps/worker/` and the `/create` routes keep working as long as `FAL_API_KEY`, `WORLD_LABS_API_KEY`, `ELEVENLABS_API_KEY`, and `ANTHROPIC_API_KEY` are set on the web service.
- **Chat streaming actually works.** Routing Claude token streams through a BullMQ job response is architecturally impossible — the sync path is the only viable shape for the agent chat surface.
- **Cost visibility on the sync path too.** Each direct-generation route wraps its provider call in `runWithCostTracker(tracker, ...)` and returns `tracker.totalCents()` in the response body, so the creative studio UI can display "Generated for $0.08" inline without a DB round-trip.

### Negative
- **Provider credentials live in two places.** `FAL_API_KEY`, `WORLD_LABS_API_KEY`, and `ANTHROPIC_API_KEY` are set on BOTH the `launchkit-web` service (lines 72-76 in `render.yaml`, for the creative studio and chat) and the `launchkit-workflows` service (for dispatch-asset generation). Changing a key in the Render dashboard requires updating both services. Documented inline in the `render.yaml` comment block landed in commit `db7a5b4`.
- **Two code paths calling the same providers.** A bug in how fal.ai is invoked has to be fixed in both `packages/asset-generators/src/clients/fal.ts` (used by the async path via `dispatchAsset`) and on the sync path via `createFalMediaClient` in `generation-clients.ts`. The clients share the same `@launchkit/asset-generators` factory, so the surface drift is small today; if it grows, the fix is tighter — move more of the per-call logic into the package, not extract a new one.
- **Cost tracking coverage is asymmetric on persistence.** The async path persists every call to `asset_cost_events` via the AsyncLocalStorage machinery from ADR-004 and `persistCostEvents`. The sync path tracks cost in-memory for the response body but does NOT write `asset_cost_events` rows, because the creative studio has no `asset_id` to attribute against. The `generate-routes.ts` header comment (lines 20-29) flags this explicitly and points at a future `direct_generation_cost_events` table. Known gap; acceptable until the creative studio gains per-session history.
- **Direct generation bypasses the creative-director review loop.** A `/create` image is never scored by `creative-director-agent` and never gets Creative Director Notes. That is correct — the user is the reviewer, they are sitting at the screen — but it means the self-learning Layer 3 edit-pattern data source (CLAUDE.md § "Self-learning Layer 3") only sees launch-kit assets, not direct-generation outputs. Not a bug, just a coverage boundary worth naming.

### Neutral
- `ProjectProgressPublisher` lives on the async path only. The sync path returns the result directly in the HTTP response body (or as SSE deltas for chat) — no pub/sub progress stream, because the user is already watching the single request they just fired.
- The Regenerate button at `apps/web/src/routes/asset-api-routes.ts:496` is the one place where the web service calls BOTH paths: it flips an `assets` row to `queued` (sync DB write) and fires `triggerWorkflowGeneration` (async path trigger). That is the correct place to cross the boundary because Regenerate targets an existing asset row that lives inside the launch-kit pipeline model.

## Alternatives considered

- **Everything through Workflows.** Route the creative studio image generation through a `generateImageAsset` Workflows task. Rejected: the task dispatch path pays ~1 s of cold-start per run (ADR-001 § Negative) plus the `startTask` SDK round-trip, and the creative studio UX expects sub-second spinners. The chat endpoint is fundamentally incompatible — you cannot stream SSE deltas through a BullMQ job response, and wrapping an LLM stream in a durable step function discards the token-by-token UX the feature exists to deliver.
- **Everything synchronous in the web service.** Delete the workflows service and call providers directly from the web handler for the launch-kit pipeline too. Rejected: the launch-kit pipeline is 5-15 parallel renders, some of which take 10+ minutes. Holding an HTTP connection open for 10 minutes across 15 concurrent provider calls is broken on every dimension — Render request timeouts, dyno memory pressure, concurrent-request limits, retry semantics, and the fact that the user has closed the tab and walked away. This is the shape ADR-001 was written to move off.
- **Everything through BullMQ on the shared worker (the pre-Workflows architecture).** Rejected in ADR-001 for the launch-kit pipeline. Equally wrong for the creative studio: a BullMQ hop between the web handler and the fal.ai call adds a queue round-trip with zero benefit, because there is no fan-out, no retry budget the handler itself cannot enforce, and no durability requirement a stateless UI cannot satisfy with a re-submit.
- **A third dedicated service for the sync generation path.** Extract `/create` and the chat endpoint into their own Render service. Rejected: adds deploy surface for zero benefit. The web service already exists for the dashboard API, serves SSE for the project event feed, and handles the `/api/generate/audio/files/:cacheKey.mp3` static-file streaming. Moving two route files into their own dyno would add a network hop from the dashboard and force the same provider-key duplication problem one layer deeper.

## References

- [`../../CLAUDE.md`](../../CLAUDE.md) § "Workflows service"
- `apps/workflows/src/tasks/generate-all-assets-for-project.ts` — async path parent task
- `apps/workflows/src/lib/dispatch-asset.ts` — async path agent routing switch
- `apps/web/src/routes/generate-routes.ts` — sync path creative studio endpoints (`POST /image|video|audio|world`)
- `apps/web/src/routes/chat-routes.ts` — sync path streaming chat endpoint (direct Anthropic SDK, SSE deltas)
- `apps/web/src/lib/generation-clients.ts` — lazy-cached FAL / ElevenLabs / World Labs clients for the sync path
- `apps/web/src/routes/asset-api-routes.ts` — the one route that crosses the boundary (`/api/assets/:id/regenerate`)
- `apps/web/src/index.ts` — where `chatRoutes` and `generateRoutes` are mounted
- `render.yaml` — the `launchkit-web` service block declares the creative studio provider keys (`FAL_API_KEY`, `WORLD_LABS_API_KEY`, `ANTHROPIC_API_KEY`, `EXA_API_KEY`)
- Commit `db7a5b4 fix(deploy): expose creative studio provider keys to web service`
- [ADR-001](./ADR-001-render-workflows-for-asset-pipeline.md) — Render Workflows for the asset generation pipeline
