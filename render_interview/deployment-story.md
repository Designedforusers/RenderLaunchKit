# Deployment Story: LaunchKit on Render

What happened, what I learned, and how to talk about it in the interview.

---

## The Architecture Decision That Matters

LaunchKit uses Render Workflows for per-asset compute sizing. The parent task fans out to child tasks, each running on hardware sized for its workload:

- **Starter** instances for text generation (Claude API calls — CPU-light, fast)
- **Standard** instances for image and audio (fal.ai + ElevenLabs — moderate)
- **Pro** instances for video and 3D (Kling/Seedance + World Labs — heavy)

This is the strongest technical signal in the submission. Without Workflows, you'd either overprovision one big worker for every job type or build a separate queue-and-dispatch layer. Render Workflows made it a few lines of SDK code.

## The Deployment Issue I Hit

**What worked locally:** Everything. The full monorepo builds, typechecks, lints, and passes 170 tests locally. The Remotion video renderer runs Chrome headless to composite React components into MP4s — product videos, voice commercials, podcast waveforms.

**What broke on Render:** Render Workflows is in public beta. The build environment has a read-only filesystem, which means `apt-get` (needed to install Chrome's system libraries for Remotion) fails with:

```
E: List directory /var/lib/apt/lists/partial is missing. - Acquire (30: Read-only file system)
```

This affects only ONE of seven tasks — `renderRemotionVideo`. The other six (text, images, video via fal.ai API, audio, world scenes, and the parent fan-out) are pure HTTP API calls that need no system packages.

## How I Solved It

**Architecture split:** Keep Workflows for what it's great at (orchestration + compute-sized API tasks), add a Docker-based web service for the one browser-native workload.

| Service | Runtime | What it does |
|---|---|---|
| `launchkit-workflows` | Node (Workflows) | 6 generation tasks + parent fan-out |
| `launchkit-renderer` | Docker (`node:22-slim`) | Remotion MP4 compositing with Chrome |

The renderer is a thin Hono HTTP server that wraps the exact same `createRemotionRenderer` the Workflows task used. Same browser pool, same webpack bundle cache, same retry logic. Just HTTP transport instead of the Workflows task protocol.

The web service's `triggerRemotionRender` helper changed from calling `render.workflows.startTask()` to calling `POST /render` on the renderer service. One file changed, same typed interface.

**Why this is a strong engineering story:**
- I didn't remove Workflows — it's still the backbone of the generation pipeline
- I didn't hack around the limitation — I created a clean service boundary
- The split is architecturally coherent: Workflows for orchestration, Docker for system-level runtime needs
- Render Workflows is in beta — this is exactly the kind of pragmatic workaround that shows real deployment experience

## Other Deployment Issues Encountered

### 1. Blueprint validation — IP allow list required
The TCE-candidate workspace required an explicit `ipAllowList` on the Key-Value service. An empty array `[]` was rejected; I needed `0.0.0.0/0` to allow all.

**Talking point:** Workspace-level policies can add requirements that vanilla Blueprints don't surface. Always test your Blueprint against the target workspace.

### 2. Legacy Postgres plan names
`starter` and `pro` are deprecated. New plans use the format `pro-4gb` (hyphenated with size). I initially tried `pro_4gb` (underscored) — also wrong.

**Talking point:** Render's plan naming recently changed. The Blueprint spec docs are the source of truth, not cached knowledge.

### 3. devDependencies stripped in production
`NODE_ENV=production` causes `npm ci` to skip devDependencies. `@types/react` lives in devDependencies (correctly — it's a type declaration, not a runtime dep). But TypeScript needs it at build time.

**Fix:** `npm ci --include=dev` in the build command. This is the standard Render pattern for TypeScript monorepos.

### 4. Pika worker needs both Node and Python
The pika-worker spawns a Python subprocess for the Pika video meeting integration. Render's Node runtime can't install Python via `apt-get` (same read-only FS issue).

**Fix:** `runtime: docker` with a `Dockerfile.pika-worker` based on `node:22-slim` that installs Python 3. Same pattern as the renderer service.

### 5. Git push from Claude Code sandbox
The macOS Keychain credential helper opens a GUI dialog that a CLI-only sandbox can't interact with. Every `git push` backgrounded indefinitely.

**Fix:** Inline credential helper using `gh auth token`:
```bash
TOKEN=$(gh auth token) && git -c credential.helper='!f() { echo "username=x-access-token"; echo "password=$TOKEN"; }; f' push origin main
```

## Interview Talking Points

### "Walk me through a deployment decision you made"

"The most interesting one was the Remotion renderer split. Locally, everything compiled and ran in one process. When I deployed to Render Workflows, I hit a read-only filesystem that blocked Chrome's system library installation. Instead of removing Workflows or hacking around it, I split the workload: Workflows handles the six API-driven generation tasks with per-task compute sizing, and a dedicated Docker service handles the one browser-native rendering task. Same code, different transport. The split actually made the architecture cleaner — it's a real service boundary, not a workaround."

### "How do you handle issues you discover in production?"

"I ran a five-agent audit before submission — security, code quality, architecture, TypeScript strictness, and test coverage — each reviewing the codebase independently. That caught things like a missing rate limiter on the regenerate endpoint, Redis publisher calls that could overwrite successful asset data on Redis failure, and a metadata-overwrite bug where failed generations wiped the retry context. I fixed all of them before deploying."

### "Why did you choose this architecture?"

"Every service exists for a reason. The worker handles the agentic pipeline (30s-5min per job) that can't run in HTTP handlers. The Workflows service gives per-asset compute sizing — a blog post doesn't need the same hardware as a Kling video render. The pika-worker is isolated so meeting-join latency stays under 100ms regardless of what else is running. MinIO on a Render Disk gives us durable video storage without an external S3 account. Redis does triple duty: BullMQ queues, pub/sub for SSE progress, and GitHub API caching."

### "What would you change with more time?"

"Three things: (1) Authenticate the SSE event stream — right now it's UUID-as-capability, which works for demo but isn't production access control. (2) Add pagination to the project list endpoint. (3) When Render Workflows exits beta and supports Docker runtimes or system package installation, collapse the renderer back into a single Workflows task — the service boundary is clean enough to reverse."

## Service Inventory

| Service | Type | Runtime | Plan | Role |
|---|---|---|---|---|
| launchkit-web | Web | Node | Pro | Hono API + React SPA + SSE |
| launchkit-worker | Worker | Node | Pro | BullMQ agent pipeline |
| launchkit-pika-worker | Worker | Docker | Pro | Pika meeting avatar |
| launchkit-cron | Cron | Node | Pro | 6-hourly trending + feedback |
| launchkit-workflows | Workflow | Node | Pro | Asset generation fan-out |
| launchkit-renderer | Web | Docker | Pro | Remotion MP4 compositing |
| launchkit-minio | Web | Docker (image) | Pro | S3-compatible object storage |
| launchkit-redis | Key-Value | — | Pro | Queues + pub/sub + cache |
| launchkit-db | Postgres | — | Pro-4GB | Relational + pgvector |
