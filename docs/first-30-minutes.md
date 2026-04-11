# First 30 minutes with LaunchKit

> A self-paced walkthrough for anyone who wants to understand what
> this repo does, what's interesting about it, and where to dig
> deeper. Budget: 30 minutes.

## What LaunchKit is (2 min)

LaunchKit is an AI go-to-market teammate. You paste a GitHub repo URL and it
analyzes the codebase, researches the market with the Claude Agent SDK,
strategizes an opinionated launch plan, generates 5-15 heterogeneous marketing
assets (blog post, twitter thread, OG image, voice commercial, product video,
3D world scene, launch tips), reviews everything as a creative director,
and tracks every dollar of real provider spend along the way.

It is also a public Render showcase. The repo is written to be read as a
reference for patterns that come up when you ship a real multi-service AI
app: per-task compute isolation on Render Workflows, provider-agnostic agent
factories, `AsyncLocalStorage` cost tracking, strict TypeScript with two
documented `as unknown as` casts in the entire codebase, Zod at every runtime
boundary, and two layers of code review per PR.

For the elevator pitch and the deploy runbook, read [`README.md`](../README.md).
For the engineering invariants, read [`CLAUDE.md`](../CLAUDE.md). This file
is the supplement — a self-paced tour of the repo, not a duplicate.

## Minutes 0-5 — Get it running locally

```bash
git clone <fork-url>
cd renderlaunchkit
npm install              # also installs lefthook git hooks
docker compose up -d     # local Postgres + Redis
cp .env.example .env     # fill in at least ANTHROPIC_API_KEY
npm run db:push          # apply the Drizzle schema
npm run seed             # demo project + insights
npm run dev              # web, worker, cron, dashboard concurrently
```

Open `http://localhost:5173` for the dashboard and `http://localhost:3000`
for the API. If the dashboard loads and shows the seeded demo project,
you're good.

**Env vars that matter for this walkthrough:**

- `ANTHROPIC_API_KEY` — required. Every agent in the repo needs it.
- `VOYAGE_API_KEY` — strongly recommended. Without it, the pgvector
  similarity-search paths throw at call time and the self-learning loop
  stays dark.
- `GITHUB_TOKEN` — optional but useful. Bumps the GitHub API rate limit
  from 60/hr to 5000/hr during `analyze`.

**Leave blank for now:** `FAL_API_KEY`, `ELEVENLABS_*`, `WORLD_LABS_API_KEY`,
`EXA_API_KEY`, `RENDER_API_KEY`, `RENDER_WORKFLOW_SLUG`, `PIKA_API_KEY`.
Each one gates a specific asset type or feature; the worker skips that
branch gracefully rather than crashing. You can exercise the pipeline
end-to-end with just Anthropic + Voyage. The workflows service
(`apps/workflows`) runs locally in a separate terminal via
`npm run dev:workflows` (which shells out to `render workflows dev` and
exposes the task server on `http://localhost:8120`) — you do not need a
real Render deployment to see the fan-out.

## Minutes 5-15 — Run the full pipeline

1. Click **New Project** on the dashboard.
2. Paste a small-ish GitHub URL — `https://github.com/sindresorhus/nanoid` is
   a good one because the analysis stays under a few seconds.
3. Watch the live progress feed in the project detail view roll through
   `analyze` → `research` → `strategize` → `generating` → `reviewing` →
   `complete`. It streams over SSE from Redis pub/sub; the worker publishes,
   the web service forwards, the dashboard renders.
4. While the project is in `generating`, the Render Workflows parent task
   (`generateAllAssetsForProject`) has already fanned out to five
   compute-bucketed child tasks via `Promise.allSettled`. On the deployed
   service each child lands on its own dyno; in local dev they share the
   task server but the control flow is identical.
5. After completion, click into an individual asset card. The cost chip
   reads the real provider spend from `asset_cost_events` via the
   denormalized `cost_cents` column on the asset row.

**What's interesting behind the scenes:**

- The research step is the only truly agentic component. It runs on
  `@anthropic-ai/claude-agent-sdk` with server-side `WebSearch` and
  `WebFetch` tools plus in-process MCP tool definitions (`search_github`,
  `lookup_similar_projects`). The agent runner is at
  `apps/worker/src/lib/agent-sdk-runner.ts`.
- The strategize step reads `strategy_insights` rows via pgvector cosine
  similarity to find past projects with similar shape, then writes one
  `assets` row per planned asset at `status='queued'` and fires the
  workflow trigger.
- The review step is an automated AI pass, not a user action. The
  `creative-director-agent` scores each asset, auto-approves or rejects,
  and may re-queue rejected assets for regeneration. See CLAUDE.md
  "Asset status lifecycle" for the full state machine.

For the workflow mechanics — why the split, how run chaining works, how
partial failure is first-class — read CLAUDE.md "Workflows service".

## Minutes 15-20 — The creative studio

Navigate to `/create` on the dashboard. Type a prompt and generate an image,
video, audio clip, or 3D scene.

This is the **dual-path generation** pattern. The launch-kit pipeline above
runs through Render Workflows because a 10-minute video render cannot block
an HTTP request. The creative studio runs synchronously on the web service
because the user is staring at a spinner and the work is a single
I/O-bound upstream call — no fan-out, no fan-in, no review loop. Routing
the studio through Workflows would add a ~1s cold-start tax per child run
for zero benefit.

The agent chat endpoint at `/api/projects/:projectId/chat` is the same
pattern: streaming SSE deltas cannot flow through a BullMQ job result, so
it lives on the web handler.

The long-form rationale (with the rejected alternatives) is in
[`docs/adrs/ADR-005-dual-path-generation.md`](./adrs/ADR-005-dual-path-generation.md).
The companion essay at
[`docs/architecture/dual-path-generation.md`](./architecture/dual-path-generation.md)
goes deeper.

## Minutes 20-25 — Invite the AI teammate to a meet (optional)

Skip this section unless you have a `PIKA_API_KEY` and a `PIKA_AVATAR`
reference. The feature is never auto-invoked — it exists behind an
**Invite AI teammate to a meet** button on the project dashboard because a
Pika session burns real money and an unexpected avatar joining a live
meeting is a UX disaster.

What's interesting is the deployment shape. The Pika integration runs on
a **dedicated** worker service (`launchkit-pika-worker` in `render.yaml`)
that compiles from the same `apps/worker` workspace as the shared worker
but with a different entry point (`dist/index.pika.js`) and a Python
install in its build command. The 90-second Python subprocess join burst
needs zero event-loop contention; the control-plane operations (poll +
leave) are pure-TS `fetch()` calls that share the shared worker's loop.
Process-boundary split, code-boundary unity.

Read [`docs/adrs/ADR-003-dedicated-pika-worker-for-subprocess-isolation.md`](./adrs/ADR-003-dedicated-pika-worker-for-subprocess-isolation.md)
for the rationale. The full integration guide is in
[`docs/pika-integration.md`](./pika-integration.md).

## Minutes 25-30 — Pick a rabbit hole

Pick one. Each is self-contained and worth 10-20 minutes on its own.

- **Render Workflows for the async pipeline.** Why the pipeline moved off
  BullMQ, how per-task compute profiles collapsed the cost math, and how
  run chaining + `Promise.allSettled` makes partial failure first-class.
  Read [`docs/adrs/ADR-001-render-workflows-for-asset-pipeline.md`](./adrs/ADR-001-render-workflows-for-asset-pipeline.md)
  and the long-form essay at
  [`docs/architecture/bullmq-to-workflows-migration.md`](./architecture/bullmq-to-workflows-migration.md).
- **MinIO on Render for rendered video storage.** Why a self-hosted S3
  on a Render Disk beat Cloudflare R2 and AWS S3 for this specific
  workload. Read [`docs/adrs/ADR-002-minio-for-rendered-video-storage.md`](./adrs/ADR-002-minio-for-rendered-video-storage.md).
- **AsyncLocalStorage for cost tracking.** Why threading a `CostTracker`
  parameter through 20 files was the wrong answer and how
  `node:async_hooks` lets the intermediate layers stay unaware. Read
  [`docs/adrs/ADR-004-async-local-storage-for-cost-tracking.md`](./adrs/ADR-004-async-local-storage-for-cost-tracking.md)
  and the long-form explainer at
  [`docs/cost-tracking.md`](./cost-tracking.md).
- **Dual-path generation.** Why LaunchKit deliberately runs two
  architectures for two workloads and why routing everything through
  Workflows would be objectively worse. Read
  [`docs/adrs/ADR-005-dual-path-generation.md`](./adrs/ADR-005-dual-path-generation.md).

Before you push your first change, run the `code-reviewer` Claude Code
subagent against your staged diff. It is free, contextual, and catches
the kind of strict-flag and boundary-validation regressions a human
author is too close to the code to see. The setup, the invocation, and
the second (on-demand) cloud review layer are documented in CLAUDE.md
"Code review chain".

## Where to look next

- [`CLAUDE.md`](../CLAUDE.md) — engineering invariants, the canonical rules
- [`README.md`](../README.md) — product pitch and the 4-step deploy runbook
- [`docs/adrs/`](./adrs/) — five decision records, one per load-bearing choice
- [`docs/architecture/`](./architecture/) — two long-form essays
- [`docs/cost-tracking.md`](./cost-tracking.md) — the cost tracking explainer
- [`docs/pika-integration.md`](./pika-integration.md) — the Pika integration explainer
- [`apps/web`](../apps/web) — Hono API, SSE stream, GitHub webhook receiver, creative studio handlers
- [`apps/worker`](../apps/worker) — BullMQ processors for analyze/research/strategize/review
- [`apps/workflows`](../apps/workflows) — Render Workflows task definitions
- [`apps/cron`](../apps/cron) — 6-hour trending ingest + nightly feedback aggregation
- [`apps/dashboard`](../apps/dashboard) — Vite React SPA
- [`packages/shared`](../packages/shared) — Drizzle schema, Zod schemas, pricing constants
- [`packages/asset-generators`](../packages/asset-generators) — provider-agnostic agent factories + cost tracker
- [`packages/video`](../packages/video) — Remotion compositions
