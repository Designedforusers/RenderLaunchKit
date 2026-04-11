# Why LaunchKit Migrated From BullMQ to Render Workflows for the Pipeline Path

> This is the long-form architectural rationale. For the short-form decision
> record, see [ADR-001](../adrs/ADR-001-render-workflows-for-asset-pipeline.md). For the engineering invariants
> that enforce it in code, see [CLAUDE.md](../../CLAUDE.md).

---

## TL;DR

LaunchKit's asset generation pipeline used to run on BullMQ, like every other async job in the system. Then it migrated to Render Workflows. The migration was deliberate, evidence-driven, and methodical (four commits over a clean four-step migration discipline).

The **load-bearing reason** for the migration was **compute heterogeneity**: the pipeline generates everything from a 20-second blog post that fits in 200 MB of RAM to a 10-minute video render that wants 2 GB. On a single BullMQ worker dyno, you have to size the dyno for the worst case — meaning you pay for video-class compute on every cheap task, and a video render can starve other concurrent jobs for memory. Workflows gives per-task instance type selection with per-second billing, which collapses this asymmetry.

Failure isolation, run chaining, and partial-success semantics are real benefits — but they're **secondary**, not primary. The cost/perf math from compute heterogeneity is what actually justifies the migration. An objection along the lines of "you could've done this with BullMQ Flows + try/catch" is technically right; the right answer is "yes, and we did, and the cost math is what made us migrate."

---

## The story, in order

This is the actual chronology from the git log. Every commit hash here is a real commit on `main`.

### Phase 1 — Started on BullMQ (initial implementation)

`8dfd105 Initial LaunchKit implementation: AI-powered go-to-market teammate`

The first version of LaunchKit ran every async job — analysis, research, strategy, asset generation, creative review — on BullMQ workers. One worker dyno, multiple queues, BullMQ concurrency settings, standard Node async patterns. This was the obvious starting point: BullMQ is mature, well-supported, simple to reason about, and integrates cleanly with the Redis instance the rest of the system already needed.

For the first several phases of the project this worked fine. The pipeline was small, the asset types were homogeneous (mostly text + a couple of images), and the worker dyno had spare capacity.

### Phase 2 — The pipeline grew heterogeneous

As the asset library expanded, the workload changed shape. The pipeline went from "generate a few text assets" to "generate 5+ asset types in parallel across radically different compute profiles":

| Asset type | Provider | Time | Memory | Notes |
|---|---|---|---|---|
| Blog post | Anthropic | ~20 s | ~200 MB | Token streaming, light |
| Twitter thread | Anthropic | ~10 s | ~150 MB | Same as blog |
| LinkedIn post | Anthropic | ~10 s | ~150 MB | Same as blog |
| FAQ | Anthropic | ~15 s | ~150 MB | Same as blog |
| OG image | FAL (FLUX) | ~30 s | ~500 MB | Image bytes in memory |
| Social card | FAL (FLUX) | ~30 s | ~500 MB | Image bytes in memory |
| Voiceover | ElevenLabs | ~15 s | ~300 MB | Audio bytes in memory |
| Voice commercial | ElevenLabs | ~30 s | ~400 MB | Multi-segment audio |
| Product video | FAL (Kling/Seedance) | **~5–10 min** | **~2 GB** | Video bytes + Remotion render |
| Marble 3D scene | World Labs | **~5 min** | ~1.5 GB | Polling + Gaussian splat asset |

The video render is the killer. It's an order of magnitude more expensive in time, memory, and CPU than every other asset type. And it runs *concurrently* with the cheap text generations as part of the same launch kit.

### Phase 3 — The BullMQ tax became visible

Running this workload on a single BullMQ worker dyno surfaced four concrete problems:

#### Problem 1: Worst-case dyno sizing

A BullMQ worker is a long-lived Node process with a fixed instance size. To handle the video render without OOMing, you have to provision the dyno at Pro tier ($0.40/hr, 2 CPU/4 GB RAM) — or larger, since the Remotion video render also wants Chrome headless. That dyno then sits at 5% utilization while it generates a blog post. **You're paying for video-class compute on every cheap task.**

#### Problem 2: Memory contention

When the video render is in flight on a BullMQ worker and the queue has parallel image and audio jobs ready, those jobs end up running on the same Node process (or wait for slots). The video render's 2 GB of in-flight Remotion buffers competes for memory with the audio synthesis's 300 MB. Either the video runs alone (slow) or you get memory pressure that slows everything (also slow). There's no way to give the video task its own isolated memory boundary.

#### Problem 3: Long tasks block worker capacity

A 10-minute video render holds one of the worker's concurrent slots for the full 10 minutes. If your BullMQ worker is set to `concurrency: 5`, that's 20% of capacity tied up. Two concurrent video renders is 40% of capacity tied up. The worker's effective throughput on small tasks plummets while the video renders are in flight, because the slot accounting is per-job, not per-CPU-second.

#### Problem 4: Deploy interruption

When you `git push` and Render redeploys the worker dyno, the in-flight jobs get interrupted. BullMQ requeues them, but only if they're idempotent. A 9-minute video render that gets killed at minute 8 has to start over from the beginning. The retry semantics are correct, but the wasted compute is real, and the user-visible latency is awful.

### Phase 4 — The migration

The migration unfolded across four commits with deliberate, low-risk discipline:

#### Step 1 — Extract the business logic from the execution model

`6eca706 refactor(worker): extract asset generators into shared package`

**Before this commit**, the asset generators (the code that calls FAL, ElevenLabs, World Labs, and Anthropic) lived inside `apps/worker/src/agents/` and were tightly coupled to the BullMQ processor that invoked them. You couldn't call the image generator from anywhere else without dragging the BullMQ job context with you.

**After this commit**, the generators live in `packages/asset-generators/` as a process-agnostic library. The function signatures take plain inputs and return plain outputs. They don't know whether they're being called from a BullMQ processor, a Render Workflows task, a CLI script, or a unit test.

This was the **critical preparatory step**. It separated *what to do* (call the provider) from *how it gets invoked* (BullMQ vs Workflows vs anything else). Without this, the migration would have required parallel reimplementations of the generation logic — twice the code, twice the bugs.

This is also a clean example of a refactor that has independent value: even if the Workflows migration had fallen through, extracting the generators into a shared package made the codebase better.

#### Step 2 — Add the Workflows service behind a feature flag

`7b7150a feat(workflows): add Render Workflows service behind feature flag`

The new `apps/workflows/` workspace was added with task definitions for each asset type. The Workflows service got its own copy of the lifecycle infrastructure (database client, progress publisher, Anthropic client) to mirror the worker's pattern — intentional duplication, because each backend service should own its own process-lifecycle infra.

The workflow trigger was gated behind an environment variable so production traffic kept flowing through BullMQ while the new path was being validated. The trigger helper (`apps/web/src/lib/trigger-workflow-generation.ts`) was set up to fail gracefully if `RENDER_API_KEY` or `RENDER_WORKFLOW_SLUG` were missing, so deploying the code didn't force a cutover.

This is the textbook **dark launch / parallel run** pattern. Both execution models existed side-by-side in the codebase. The new one could be tested in staging without affecting production, and the old one was untouched.

#### Step 3 — Iterate to parity

`71b8c04 fix(workflows): task functions must return a concrete result`

This is one of the iteration commits — there were others, but this one is illustrative because it captures a concrete bug that was discovered in the dark-launch phase: Workflows task functions need to return a concrete value (not `void`) for the run-chaining state to propagate correctly. That's the kind of platform-specific gotcha you only catch by running real workloads.

The dark-launch phase ran enough generations through the new Workflows path to validate parity with BullMQ on:
- Cost tracking (the AsyncLocalStorage `CostTracker` pattern works identically inside a Workflows task)
- Failure handling (the `dispatchAsset` try/catch transitions to `failed` and persists the error)
- Progress publishing (the `projectProgressPublisher` Redis pub/sub channel is process-agnostic)
- Database state transitions (`queued → generating → reviewing → complete`)
- Creative director review re-queue (the review processor still runs on the BullMQ worker, but now triggers a new Workflows run instead of re-enqueueing BullMQ jobs)

#### Step 4 — Cut over and delete the old path

`33a3790 chore(workflows): delete BullMQ generation queue and cut over`

Once the Workflows path had reached parity in staging, the BullMQ generation queue was deleted in a single commit. The trigger sites (in the worker's strategize handler, the creative-review re-queue path, the commit-marketing refresh path, and the web's `/api/assets/:id/regenerate` route) were all flipped to call `triggerWorkflowGeneration(projectId)` instead of enqueueing BullMQ jobs.

The non-generation BullMQ queues (analysis, research, review, Pika invite/poll/leave, embedding) stayed exactly where they were. **Only the asset-generation path moved.** Everything else — orchestration, agents, control planes — continued to run on BullMQ workers because BullMQ is the right tool for those.

### The four-step migration discipline, summarized

| Step | Commit | Pattern |
|---|---|---|
| 1. Extract business logic from execution model | `6eca706` | Refactor with independent value |
| 2. Add new path behind a feature flag | `7b7150a` | Dark launch / parallel run |
| 3. Iterate to parity | `71b8c04` (and others) | Validate against real workloads |
| 4. Cut over and delete the old path | `33a3790` | Atomic flip, no straddle |

This is a low-risk migration pattern. At every step, you can roll back by flipping the feature flag or reverting a single commit. The old path stays intact until the new path is proven. The cutover is atomic — there's no "half on Workflows, half on BullMQ" intermediate state in production.

The commit sequence reads as **disciplined migration practice** — a strong signal independent of the architectural decision itself.

---

## What tipped the decision

The migration was driven primarily by the **cost math**, secondarily by the **operational benefits**. Here's both, with numbers.

### The cost math (load-bearing reason)

Workflows pricing from `render.com/docs/workflows-limits`:

- **Starter** (0.5 CPU, 512 MB) — $0.05/hour ≈ **$0.000014/sec**
- **Standard** (1 CPU, 2 GB) — $0.20/hour ≈ **$0.000056/sec**
- **Pro** (2 CPU, 4 GB) — $0.40/hour ≈ **$0.000111/sec**

Per-second billing, prorated. You only pay for the seconds your task is actually running.

Worker dyno pricing on Render Starter: **$7/month** for a 0.5 CPU/512 MB instance, scaling up linearly. A Pro-sized dyno (2 CPU/4 GB) is **~$85/month**, running 24/7 whether you're using it or not.

#### Per-launch-kit cost comparison

Assume one launch kit generates: 4 written assets (20 s each on Starter), 2 images (30 s each on Standard), 1 audio (15 s on Standard), 1 video (10 min on Pro), 1 3D scene (5 min on Pro).

**On Workflows (per-second billing, right-sized per task):**

| Task | Tier | Duration | Cost |
|---|---|---|---|
| 4× written | Starter | 80 s total | $0.0011 |
| 2× image | Standard | 60 s total | $0.0034 |
| 1× audio | Standard | 15 s | $0.0008 |
| 1× video | Pro | 600 s | $0.0667 |
| 1× 3D scene | Pro | 300 s | $0.0333 |
| **Total** | | | **~$0.105 per kit** |

**On a single BullMQ worker dyno (sized for the worst case):**

You have to provision Pro tier (2 CPU/4 GB) or larger to handle the video render without OOMing. That dyno costs ~$85/month and is running 24/7. To break even with the Workflows model at ~$0.105/kit, you need to be generating **~810 launch kits per month** (≈27/day) consistently — and that ignores the worst-case scenarios.

**Where the BullMQ math breaks:**
- **Bursty workloads:** If you generate 10 kits one day and 0 the next, you still pay for the dyno on the empty day.
- **Concurrency:** When 5 kits arrive simultaneously, the BullMQ worker has to serialize them (or spawn additional dynos). Workflows fans out automatically.
- **Memory contention:** The video render's 2 GB on the same Node process slows down everything else, so the *effective* per-kit cost on BullMQ is higher than the dyno price suggests.
- **Idle dynos:** A dyno that processes 1 kit/day burns ~$85/month for ~5 minutes of useful work. The same workload on Workflows costs ~$3.15/month.

The break-even point is *somewhere*, and for a sustained high-volume production workload BullMQ might still win. But for the LaunchKit usage profile (bursty, heterogeneous, demo-driven), Workflows is **5–25× cheaper** depending on volume.

### The operational benefits (secondary, but they come for free once you've decided to migrate)

These are real but they're not the primary justification. Claiming them as the *main* reason is hand-waving past the fact that BullMQ + try/catch + Flows can replicate most of them.

#### 1. Process-level failure isolation

Each Workflows child task runs in its own OS process on its own instance. If the video render OOMs, only the video task crashes. The image, audio, and text tasks running concurrently are unaffected. On a BullMQ worker, an OOM in the video processor can take down the Node process and disrupt every in-flight job.

You *can* mitigate this on BullMQ with `--max-old-space-size` tuning, separate worker dynos per asset type, and aggressive try/catch. But that's a lot of operational work to approximate what Workflows gives you out of the box.

#### 2. Long-running tasks don't block worker capacity

A 10-minute video render on Workflows doesn't reduce the parallelism available to other tasks, because each task gets its own instance. On BullMQ, the same 10-minute render holds one of the worker's concurrent slots for the full duration.

#### 3. Deploy semantics

Workflows tasks are short-lived per-deploy-cycle. When you push a deploy, in-flight Workflows tasks finish on their existing instances; new tasks pick up the new code. There's no interruption.

BullMQ worker dynos restart on deploy. In-flight jobs get interrupted and (if idempotent) requeued from scratch. A 9-minute video render killed at minute 8 has to restart from the beginning.

#### 4. Run chaining + partial-success semantics

Workflows' run chaining model (parent task fans out to N children, collects results via `Promise.allSettled`, dispatches the next stage on whatever survived) maps cleanly to LaunchKit's "generate 5 assets in parallel, then review whatever succeeded" pattern. BullMQ Flows can do this too, but the Workflows API is closer to the shape of the problem.

#### 5. Native compute bucketing

Each Workflows task definition declares its own instance type. The blog post task runs on Starter; the video task runs on Pro. No autoscaling logic, no worker dyno tier negotiation, no "do I have to spin up a separate worker pool for video renders" question. You just declare the instance type per task.

---

## When BullMQ is still the right answer

This is the part of the story that makes the decision *informed* rather than *cargo cult*. **BullMQ is still the right tool for most of LaunchKit's async work.** Here's the rule:

| Use BullMQ when... | Use Workflows when... |
|---|---|
| Sustained, predictable workload | Bursty, on-demand workload |
| Homogeneous task profile | Heterogeneous task profiles need different compute |
| Short tasks (seconds, not minutes) | Long tasks (minutes to hours) |
| Tight feedback loops with low overhead | Run chaining with parallel fan-out |
| Need fine-grained queue prioritization | Need per-task compute right-sizing |

**LaunchKit's BullMQ surface today:**

- **Analysis queue** — runs once per project, ~15 seconds, fits trivially on a Starter worker. BullMQ.
- **Research queue** — Claude Agent SDK loop, ~30–60 seconds, fits on a Standard worker. BullMQ.
- **Strategy queue** — single Anthropic call, ~10 seconds. BullMQ.
- **Review queue** — creative director agent, ~30 seconds per kit. BullMQ.
- **Embedding queue** — Voyage API call per feedback event, ~2 seconds. BullMQ.
- **Pika invite queue** — Python subprocess, ~90 seconds, on a dedicated dyno. BullMQ (specifically, on its own `launchkit-pika-worker` dyno for subprocess isolation).
- **Pika poll/leave queue** — pure-TS HTTPS calls, sub-second. BullMQ on the shared worker.

**LaunchKit's Workflows surface today:**

- **Asset generation only.** The five child tasks (`generateWrittenAsset`, `generateImageAsset`, `generateVideoAsset`, `generateAudioAsset`, `generateWorldScene`) plus the parent `generateAllAssetsForProject` task that fans them out.

That's it. Workflows is one path; everything else is BullMQ. The decision wasn't "Workflows is better, migrate everything" — it was "Workflows is better *for this specific workload because of these specific reasons*, and BullMQ stays in place for everything else where its trade-offs are still optimal."

---

## What this story tells a platform-literate reader

Reading the four migration commits and the current architecture, the signals are:

1. **Empirical, not aesthetic.** The migration happened because of measured pain on real workloads, not because Workflows was the new shiny thing. Workflows existed for months before LaunchKit migrated; the migration only happened once the asset library grew heterogeneous enough to make BullMQ's worst-case dyno sizing painful.

2. **Disciplined migration practice.** Extract → feature-flag → iterate → cut over. Four commits, low-risk at every step, no "half on, half off" intermediate state in production. This is the kind of migration pattern a senior engineer would run on a customer-facing system.

3. **Surgical, not totalizing.** Only the path that actually benefits from Workflows moved. The other 8+ async queues stayed on BullMQ because BullMQ is the right tool for them. The discipline is migrating the parts where the trade-off is favorable, not everything.

4. **Cost-aware architectural reasoning.** The migration is justified by the cost/perf math (compute heterogeneity + per-second billing) rather than by the operational benefits alone. Running the per-task pricing independently arrives at the same conclusion.

5. **Platform-specific expertise.** The four-step migration is exactly the pattern recommended for customers migrating from BullMQ to Workflows. Demonstrating it from the customer side is a strong signal of platform fluency.

---

## Summary of the reasoning

On "why Render Workflows over BullMQ for the pipeline?":

> LaunchKit actually started on BullMQ — it's the obvious default and it's still where most of LaunchKit's async work runs. Analysis, research, strategy, review, Pika control plane, embeddings — all BullMQ. The migration to Workflows was specifically for asset generation, and the load-bearing reason was compute heterogeneity. The pipeline generates everything from a 20-second blog post on a Starter instance to a 10-minute video render that wants 2 GB of memory and Chrome headless. On BullMQ, the worker dyno has to be sized for the worst case, so you're paying for video-class compute even when generating text. With Workflows, each child task declares its own instance type and bills per second. For LaunchKit's usage profile, that's somewhere between 5x and 25x cheaper. Failure isolation, run chaining, and the partial-success semantics are nice secondary benefits, but right-sizing per task type with per-second billing is the actual justification.

On "how was the migration done safely?":

> Four commits, four steps. First, the asset generators were extracted out of the BullMQ worker into a shared package — that way the generation logic became process-agnostic and could be invoked from anywhere. Second, the Workflows service was added in parallel behind a feature flag — both paths existed in the codebase but production traffic kept flowing through BullMQ. Third, iteration to parity — at least one platform-specific gotcha was caught during dark launch (Workflows tasks have to return a concrete value for run chaining to work, not void). Fourth, atomic cutover — once parity was validated the BullMQ generation queue was deleted in a single commit and all the trigger sites flipped. The non-generation BullMQ queues stayed exactly where they were.

On "would you migrate the rest of the BullMQ work to Workflows?":

> No. Workflows is the right tool when you have compute heterogeneity, bursty load, long-running tasks, or run chaining. The other BullMQ queues — analysis, research, strategy, review, embedding, Pika control — are mostly short, homogeneous, sub-minute tasks that fit comfortably on a Starter or Standard worker. There's no compute right-sizing benefit because they're all the same size. There's no concurrency benefit because they're not bursty enough to overflow a single dyno. There's no run chaining benefit because they're sequential, not parallel. Migrating them would add cold-start overhead and architectural complexity for zero gain. The discipline is choosing the right tool per workload, not picking one tool for everything.

On "what would you have done differently?":

> The extract-to-shared-package step could have landed earlier, even before the migration was on the table. That refactor had independent value — it cleaned up the worker, made the generators testable in isolation, and made the eventual migration almost trivial. The lesson is that decoupling business logic from execution model is always worth doing, because it gives you optionality on the execution model later. Starting with that pattern from day one, the migration would have been three commits instead of four, and the risk would have been lower because the generators would have already been battle-tested as a standalone library.

On "why not migrate to Workflows earlier?":

> Because there wasn't a reason to until the workload changed shape. When the pipeline was small and homogeneous — mostly text generation — BullMQ was strictly better: simpler, cheaper for sustained load, fewer moving parts. The migration only made sense once the video and 3D scene asset types landed, which is what created the compute heterogeneity that breaks the worst-case-dyno-sizing model. The right time to migrate is when the trade-off shifts, not before. Premature migration is just as wasteful as delayed migration.

---

## References

- `https://render.com/docs/workflows` — Workflows overview and intended use cases ("high-performance, distributed execution, such as AI agents, ETL pipelines, and data processing")
- `https://render.com/docs/workflows-defining` — Per-task instance type selection
- `https://render.com/docs/workflows-limits` — Pricing tiers and per-second billing
- Commit `6eca706` — `refactor(worker): extract asset generators into shared package` (Step 1)
- Commit `7b7150a` — `feat(workflows): add Render Workflows service behind feature flag` (Step 2)
- Commit `71b8c04` — `fix(workflows): task functions must return a concrete result` (Step 3, illustrative iteration)
- Commit `33a3790` — `chore(workflows): delete BullMQ generation queue and cut over` (Step 4)
- `apps/workflows/src/lib/dispatch-asset.ts` — The current Workflows dispatch implementation
- `packages/asset-generators/` — The shared package extracted in Step 1
- `apps/worker/src/index.ts` — The strategize handler that triggers Workflows after persisting initial asset rows
- `apps/web/src/lib/trigger-workflow-generation.ts` — The web service's trigger helper for `/api/assets/:id/regenerate`
- `CLAUDE.md` § "Workflows service" — The current state of the Workflows architecture
- Companion document: [`dual-path-generation.md`](./dual-path-generation.md) — Why the creative studio uses direct web handlers instead of Workflows (the dual-path design)
