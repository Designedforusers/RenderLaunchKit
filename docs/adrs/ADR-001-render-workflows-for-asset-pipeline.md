# ADR-001: Render Workflows for the asset generation pipeline

**Status:** Accepted
**Date:** 2026-04-10
**Deciders:** @designforusers

## Context

LaunchKit generates a launch kit of 5-15 heterogeneous marketing assets per
GitHub project: blog posts, Twitter threads, LinkedIn posts, Product Hunt
descriptions, HN posts, FAQ, changelog, voiceover scripts, OG images, social
cards, product videos, video storyboards, voice commercials, podcast scripts,
and 3D world scenes. Every generation run is a fan-out: after
`buildProjectLaunchStrategy`
(`apps/worker/src/processors/build-project-launch-strategy.ts:51-64`) writes
one `assets` row per planned asset at `status='queued'`, something has to
dispatch each row to the correct agent, wait for all of them to settle, and
then enqueue the creative-director review.

The compute profile is extremely heterogeneous. A blog post is a single Claude
call that finishes in 10-30 seconds and needs maybe 200 MB of resident RAM. A
`product_video` hits the Kling v3 model on fal.ai and holds a subscribe
polling loop open for ~10 minutes while the render completes. A `world_scene`
polls the World Labs Marble API for ~5 minutes. An audio podcast concatenates
18-30 ElevenLabs TTS buffers before writing a final MP3. Sizing a single instance
for the worst case and paying pro-tier compute for text generation is 5-25x
more expensive than it needs to be. Sizing for the common case and letting
video renders contend with cheap text jobs for the Node event loop turns
every launch into a latency lottery.

Partial failure is a first-class requirement. If the Kling render fails
because fal.ai is queue-backed up but the eight text assets and two images
succeeded, the user still gets a complete-enough kit. The review pass needs
to grade what shipped, not abort on the first rejection. That rules out any
fan-out primitive that short-circuits on error.

The pre-migration architecture was a BullMQ fan-out running inside the shared
`launchkit-worker` instance. The strategy processor wrote the queued asset rows,
then the worker's `index.ts` read them back and enqueued one BullMQ job per
asset onto a single `asset-generation` queue consumed by the same instance. Every
asset type ran on the same `standard` instance. A 10-minute video render
blocked three or four text jobs behind it. Concurrency was tuned conservatively
to avoid OOM on the video path. The review-enqueue trigger had to be a
separate "did every child finish" poll because BullMQ has no native fan-in
primitive.

All four limitations are structural, not implementation bugs. They do not get
better by tuning concurrency or splitting queues — they get better by moving
to a primitive that natively supports per-task compute sizing, native fan-out
with run chaining, and partial-failure-tolerant fan-in.

## Decision

We host the asset generation pipeline on Render Workflows (public beta). The
`launchkit-workflows` service registers seven tasks via the
`@renderinc/sdk/workflows` `task(...)` wrapper in
`apps/workflows/src/index.ts`: one parent (`generateAllAssetsForProject`),
five generation children (`generateWrittenAsset`, `generateImageAsset`,
`generateVideoAsset`, `generateAudioAsset`, `generateWorldScene`), and one
render child (`renderRemotionVideo`). The import list in
`apps/workflows/src/index.ts:66-72` is side-effect only because each
`task(...)` call self-registers at module load; the SDK keeps the process
alive and listens for run requests once any task is registered.

The parent task (`apps/workflows/src/tasks/generate-all-assets-for-project.ts`)
runs on the cheap `starter` plan, reads the project row plus every
`status='queued'` asset in one Drizzle query (`findFirst` with a
`with: { assets: true }` join, lines 149-152), publishes a
`phase_start: generating` progress event, and fans out to the correct child
task inside a `Promise.allSettled` over the queued asset list. Because each
child call is a real task invocation (not a function call), the Render
orchestrator spawns a fresh instance per child with the compute tier that
child declared — a `generateVideoAsset` call lands on a `pro` box, a
`generateWrittenAsset` call lands on a `starter` box, regardless of where the
parent is running. This is run chaining, and it is the feature the entire
migration turns on.

The five child tasks are compute-bucketed. `generateWrittenAsset` runs on
`starter` with a 180-second timeout and 3 retries at 1-2-4s backoff — every
text asset is a single Claude call and a 429 recovers cleanly.
`generateImageAsset` runs on `standard` with a 300-second timeout and 3
retries at 2-4-8s backoff for fal.ai queue backpressure. `generateAudioAsset`
runs on `standard` with a 900-second timeout and 2 retries at 3-6-12s for
transient ElevenLabs 5xx. `generateVideoAsset` and `generateWorldScene` both
run on `pro` with a 1200-second timeout and 2 retries — a retry on these
costs real money in fal.ai and World Labs credits, so the retry budget is
smaller. The exact per-task config lives in each child's `task({ ... })` call
at the top of the file.

Every child delegates the actual generation work to `dispatchAsset` in
`apps/workflows/src/lib/dispatch-asset.ts`, which re-reads project context
from the DB at run time, validates the asset type is inside the caller's
`allowedTypes` guard (lines 90-94, a defence against a routing bug putting a
video on a starter box), runs the agent inside `runWithCostTracker` for the
AsyncLocalStorage cost-tracking path, and flips the asset row to `reviewing`
on success or `failed` with a persisted error message on throw. Re-reading
context at run time (rather than passing it in the task input) keeps task
inputs tiny, avoids drift between enqueue-time and run-time payloads, and
makes retries naturally idempotent — a replayed task sees whatever the DB
holds now, not a stale snapshot.

Fan-in is native. After `Promise.allSettled` resolves in the parent, the
parent enqueues exactly one BullMQ `review` job onto Redis via
`enqueueReviewJob` (lines 236-240), flips the project row to
`status='reviewing'`, and returns a structured `GenerateAllAssetsResult` with
the succeeded/failed counts. The review queue is still consumed by the
`launchkit-worker` service — only the generation stage moves to Workflows in
this migration. The review agent is a single process on a single project and
does not benefit from fan-out, so leaving it on BullMQ was the smaller-blast-
radius choice.

Four call sites trigger the workflow, all via
`client.workflows.startTask('${RENDER_WORKFLOW_SLUG}/generateAllAssetsForProject', [{ projectId }])`:
(1) the strategize handler in `apps/worker/src/index.ts` immediately after
`buildProjectLaunchStrategy` persists queued rows, (2) the creative review
re-queue path in `apps/worker/src/processors/review-generated-assets.ts`,
(3) the commit-marketing refresh path in
`apps/worker/src/processors/process-commit-marketing-run.ts`, and (4) the
user-facing Regenerate button in `apps/web/src/routes/asset-api-routes.ts`.
The worker and web services each own their own lazy Render SDK client:
`apps/worker/src/lib/trigger-workflow-generation.ts` (82 lines) and
`apps/web/src/lib/trigger-workflow-generation.ts` (71 lines) are deliberate
copies, not a shared package. The rationale is in CLAUDE.md § "Workflows
service": each backend service constructs its SDK client from its own typed
`env` module, and a 40-line helper does not justify a new package-level
abstraction shared between exactly two consumers.

The workflows service is created manually in the Render dashboard. `render.yaml`
defines `launchkit-web`, `launchkit-worker`, `launchkit-pika-worker`,
`launchkit-cron`, Redis, and Postgres as Blueprint resources, but Render's
Blueprint format does not yet support workflow services — the one-time
dashboard setup is documented in README § "Create the workflow service". Both
`trigger-workflow-generation.ts` helpers throw a structured error at call
time if `RENDER_API_KEY` or `RENDER_WORKFLOW_SLUG` is missing, rather than
failing service boot, so analyze → research handlers still start cleanly in
environments where the workflow service has not been provisioned yet.

## Consequences

### Positive

- **Per-task compute right-sizing.** Written assets run on `starter`
  ($0.05/hr), images and audio on `standard`, video and 3D scenes on `pro`
  ($0.40/hr). Paying pro-tier for a 20-second blog post was 5-25x the
  necessary cost on the pre-migration path.
- **Partial-failure tolerance is native.** `Promise.allSettled` in
  `generate-all-assets-for-project.ts:186-194` collects every child result
  regardless of status, `dispatchAsset`'s catch block at lines 398-442 marks
  the asset row `failed` with a persisted error message, and the review job
  still runs on the succeeded subset. One failed Kling render no longer
  aborts a launch.
- **Process isolation.** A 10-minute video render runs on its own `pro`
  instance and no longer contends with a 20-second blog post for the same
  Node event loop. Click-to-first-asset latency on the text path stopped
  being held hostage by whatever heavy job was in flight.
- **Native observability.** Every task run shows up in the Render dashboard
  as a first-class resource with its own logs, duration, retries, and run
  chain topology. The BullMQ path had a single shared log stream on the
  worker instance where 15 concurrent jobs interleaved stdout.
- **Render-native.** No external orchestrator (Temporal, Airflow, Inngest) to
  deploy, upgrade, keep in sync with secrets, or debug. The control plane is
  the Render dashboard every other service already uses.
- **Cost attribution per task.** Per-second compute billing on the Workflows
  side plus per-provider asset costs in `asset_cost_events` gives a clean
  split between "what did LaunchKit pay Render to orchestrate" and "what did
  LaunchKit pay Anthropic/fal/ElevenLabs/World Labs to generate".
- **Exhaustive routing enforcement.** The `dispatchChildTask` switch in
  `generate-all-assets-for-project.ts:66-117` is an exhaustiveness-checked
  `switch` over `AssetType`. A new asset type that forgets to add a case is
  a TypeScript compile error, not a silent fall-through. The pre-migration
  writer agent quietly swallowed unknown types through a default branch.

### Negative

- **Workflows is public beta.** The SDK surface (`@renderinc/sdk/workflows`),
  the task-registration contract, the `startTask` return type, and the
  `get-base-url` helper that routes local-dev traffic are all subject to
  change. We carry a small amount of version-pinning risk and a non-zero
  chance of a semantics shift between SDK releases.
- **Not in the Blueprint.** The workflows service is NOT in `render.yaml`
  (Render Blueprint does not yet support workflow resources). Every fresh
  deploy requires a one-time manual dashboard step to create the service
  and wire `RENDER_API_KEY` + `RENDER_WORKFLOW_SLUG` into the worker and
  web services. This is documented in README § "Create the workflow
  service" but it is real operator friction.
- **Code duplication with the worker.** `apps/workflows/src/lib/database.ts`,
  `apps/workflows/src/lib/project-progress-publisher.ts`, and
  `apps/workflows/src/lib/anthropic-claude-client.ts` exist as near-copies
  of their `apps/worker/src/lib/` counterparts. CLAUDE.md § "Workflows
  service" documents this as an intentional tradeoff: each backend service
  owns its own process-lifecycle infra per the existing monorepo convention,
  and moving `anthropic-claude-client.ts` into `packages/asset-generators/`
  would force the worker's three non-asset-gen agents
  (`launch-strategy-agent`, `commit-marketability-agent`,
  `launch-kit-review-agent`) to depend on the asset-generators package,
  which is semantically wrong.
- **Duplicated trigger helpers.** The two `trigger-workflow-generation.ts`
  files (71 + 82 lines, one per service) are also deliberate copies. Same
  rationale in CLAUDE.md: each service constructs its lazy SDK client from
  its own `env` module. A shared `@launchkit/render-sdk` package for 150
  lines of boilerplate is more abstraction cost than it saves.
- **Cold start overhead.** ~1 second per child task run per the Render docs.
  For a 9-asset launch that is ~9 seconds of wall-clock overhead that a
  single-instance BullMQ path did not pay. This is load-bearing against
  text-only kits where the individual jobs are fast; it is invisible
  against video and 3D.

### Neutral

- **Cost tracking is unchanged.** Still flows through the same
  `asset_cost_events` table via the AsyncLocalStorage pattern in
  `packages/asset-generators`. `dispatchAsset` wraps its agent switch in
  `runWithCostTracker(tracker, async () => { ... })` exactly once, and
  `persistCostEvents` writes on both the success and error paths. Zero
  changes to the cost surface; the Workflows migration is invisible to the
  dashboard's "Generated for $X.XX" chip.
- **Review stayed on BullMQ.** `enqueueReviewJob` writes to the same Redis
  queue `review-generated-assets.ts` consumes on the worker. Only the
  generation stage moves; review remained where it was because the review
  agent is a single process on a single project and does not benefit from
  fan-out.
- **Dashboard SSE contract is unchanged.** `projectProgressPublisher` is
  ported verbatim from the worker to the workflows service, so the
  dashboard subscribes to the same Redis pub/sub channels and renders the
  same progress events regardless of which service emitted them.

## Alternatives considered

- **BullMQ fan-out on the shared worker instance** (the pre-migration
  architecture): simple, works, one fewer service to deploy. Rejected
  because it forces every task to share compute with the heaviest job in
  flight, has no native fan-in primitive, offers no per-task observability,
  and cannot right-size compute across heterogeneous workloads. The
  latency and cost pathologies in § Context are structural to that shape.
- **Temporal.io**: mature, typed, excellent observability, first-class
  durability and retries. Rejected because it requires a separately-
  deployed Temporal server (or a paid Temporal Cloud account), pulls the
  stack off Render-native infrastructure, and the heterogeneous-compute
  problem is not Temporal's sweet spot — Temporal is optimized for
  long-lived durable workflows with complex branching, not compute-bucketed
  fan-out of mostly-independent tasks.
- **Inngest**: durable step functions, Render-compatible via SDK. Rejected
  because Inngest charges per step event and LaunchKit fan-outs are O(N
  assets) per project. At ~10 assets per launch and a free-tier ceiling
  measured in thousands of events per month, the economics break as soon
  as the product ships to real users. Also: another external control plane
  to authenticate with.
- **Raw Render Cron + manual orchestration**: conceptually possible by
  enqueuing child jobs as one-off Cron services. Rejected because there is
  no fan-in or aggregation primitive — the review-enqueue trigger would
  have to be a separate polling service watching for "all assets out of
  `queued` and `generating`". No partial-failure model, no parent task
  surface to attach the progress publisher to, and Cron's billing model is
  built for schedules, not on-demand runs.
- **Kubernetes Jobs on a managed cluster**: maximum flexibility, native
  per-pod compute sizing. Rejected because LaunchKit is a Render showcase —
  the whole point is to stay Render-native and demonstrate what Render's
  primitives can do end-to-end. Adding a managed K8s control plane would
  undermine the Render-native story.

## References

- [`../../CLAUDE.md`](../../CLAUDE.md) § "Workflows service" — the canonical invariant doc
- `apps/workflows/src/index.ts` — side-effect-only task registration
  entrypoint
- `apps/workflows/src/tasks/generate-all-assets-for-project.ts` — the
  parent task and `dispatchChildTask` switch
- `apps/workflows/src/tasks/generate-written-asset.ts`,
  `generate-image-asset.ts`, `generate-video-asset.ts`,
  `generate-audio-asset.ts`, `generate-world-scene.ts` — the five
  compute-bucketed child tasks
- `apps/workflows/src/lib/dispatch-asset.ts` — the agent routing switch
  with scope guard and cost-tracker wrap
- `apps/worker/src/lib/trigger-workflow-generation.ts` — worker-side lazy
  SDK client
- `apps/web/src/lib/trigger-workflow-generation.ts` — web-side lazy SDK
  client (deliberate parallel copy)
- `apps/worker/src/processors/build-project-launch-strategy.ts:51-64` —
  the pre-Workflows code that still writes the queued asset rows consumed
  by the parent task
- `render.yaml` — confirms `launchkit-workflows` is NOT a Blueprint
  resource (manual dashboard creation only)
- `README.md` § "Create the workflow service" — one-time dashboard setup
  runbook
