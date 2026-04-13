# ADR-003: Dedicated Pika worker for subprocess isolation

**Status:** Accepted
**Date:** 2026-04-10
**Deciders:** @designforusers

## Context

The Pika video-meeting integration brings a Pika-hosted AI avatar into a live Google Meet when a user clicks **Invite AI teammate to a meet** on the project dashboard. The join handshake is a ~90-second Python subprocess: the vendored `pikastream-video-meeting` CLI at `vendor/pikastream-video-meeting/scripts/pikastreaming_videomeeting.py` opens a headless session with Pika's API, waits for the avatar to reach `status=ready`, and streams progress lines back on stdout. `apps/worker/src/lib/pika-stream.ts:677` does the actual `spawn('python3', ...)` with a bounded stdio buffer and a 240-second wall-clock abort.

The user is staring at a browser tab while this happens. Click-to-avatar-in-meeting has to feel instant — specifically, click-to-`child_process.spawn` has to land in under 100ms. Anything slower and the user assumes the feature is broken and clicks again, which is exactly the kind of double-invite UX that burns Pika credits and embarrasses us on a live call.

The rest of the `launchkit-worker` runs a heterogeneous mix of BullMQ jobs — repository analysis (`analyze-project-repository`), creative-director review (`review-generated-assets`), trending-signals crawls, and the pika-poll/pika-leave control plane. Any of those jobs can hold the Node event loop when a `pika-invite` job lands on Redis. Under load we measured click-to-spawn in the 500–1500ms range on a shared starter instance, which is user-visible.

The integration also introduces a `python3 + pip install requests` build step that is alien to every other LaunchKit service. We do not want it on the critical path of any non-Pika instance.

## Decision

Deploy TWO Render worker services that compile from the SAME `apps/worker` workspace:

- **`launchkit-pika-worker`** (dedicated) — declared in `render.yaml` as the second `type: worker` block. `startCommand: npm run start:pika-worker`, which runs `node apps/worker/dist/index.pika.js`. This entry point (`apps/worker/src/index.pika.ts`) registers exactly ONE BullMQ `Worker` bound to the `pika-invite` queue. Its whole job is to sit warm and ready to spawn the Python CLI the instant a job arrives. Its `buildCommand` installs `python3`, `python3-pip`, and the vendored CLI's sole runtime dep `requests>=2.32.5` via `pip3 install --break-system-packages`.
- **`launchkit-worker`** (shared) — declared in `render.yaml` as the first `type: worker` block. `startCommand: npm run start:worker`, which runs `node apps/worker/dist/index.js`. This entry point registers the analysis, review, trending, AND `pika-control` Workers. The `pika-control` queue handles `pika-poll` (HTTPS GET every 30s to `/proxy/realtime/session/{id}` via `fetchPikaSessionState`) and `pika-leave` (HTTPS DELETE via `endMeeting`). Both are pure-TypeScript `fetch()` calls that take under a second each — no subprocess tax, no Python install. Its `buildCommand` is a plain `npm ci && npm run build`.

Both services share every helper, DB client, env module, and subprocess wrapper. The split is at the PROCESS boundary, not the CODE boundary — `apps/worker/src/index.pika.ts` imports `processPikaInvite` from `./processors/process-pika-invite.js` and the shared DB/Redis clients from `./lib/database.js` and `./lib/job-queues.js` directly. The package.json at `apps/worker/package.json` has a single dependency tree, and the root `package.json:22-25` has two start scripts pointing at two files in the same `dist/` output:

```
"start:worker": "node apps/worker/dist/index.js"
"start:pika-worker": "node apps/worker/dist/index.pika.js"
```

TypeScript compiles both entry points in one `tsc` pass. There is no separate workspace, no separate `node_modules`, no duplicated helper.

## Consequences

### Positive

- **Click-to-spawn latency stays under 100ms regardless of shared-worker load.** The dedicated instance's event loop is idle 99% of the time — its entire purpose is to `child_process.spawn('python3', ...)` the moment a `pika-invite` job lands. A 12-minute repository-analysis job on the shared worker cannot contend with it because they live in different processes on different instances. The "user clicks Invite, bot joins meeting in seconds" UX survives worst-case load.
- **Operational blast radius is bounded.** A misbehaving Python subprocess (OOM from a giant stderr, hung TLS handshake, segfault inside `requests`) crashes the pika-worker instance without touching analysis, review, trending, or the pika control plane. Conversely, if the shared worker is being redeployed or is wedged on a review-queue job, users can still start Pika sessions. Two single-points-of-failure, each with its own failure domain.
- **Code reuse is total.** Adding a helper to `apps/worker/src/lib/` is automatically available to both entry points on the next build. The invite processor uses `startMeeting` from `pika-stream.ts`; the leave processor uses `endMeeting` from the same file. Both entry points see the same module.
- **Python install is scoped to exactly one instance.** The `launchkit-pika-worker` `buildCommand` is the only one in the repo that runs `apt-get install python3`. If a future PR adds a Python dep, the reviewer's first question is "does this belong on the pika-worker or are you leaking Python into a service that should not have it?" The scoping is enforced by the deployment surface, not by convention.
- **Env var surface is scoped by responsibility.** `PIKA_AVATAR` is set ONLY on `launchkit-pika-worker` because it is the only service that passes `--image` to the Python subprocess. `PIKA_API_KEY` is set on both worker services — pika-worker needs it for the subprocess env, shared worker needs it for the `Authorization` header on the pure-TS leave/poll calls. The web service has neither. Pika secrets never touch instances that do not need them.

### Negative

- **Two services for one feature.** More Render dashboard surface to monitor, two sets of logs when debugging a single user session (join logs on pika-worker, poll/leave logs on shared worker), and two instances to keep warm. For a solo operator this is not free cognitive overhead.
- **Fixed cost of an additional starter instance.** Pika invites are rare compared to analysis and review jobs — the pika-worker instance is idle most of its life. We pay for idle capacity to guarantee click-to-spawn latency. Acceptable because the alternative — contention on the shared instance — breaks the UX the feature exists to deliver.
- **Python install lives on one specific service.** If a future contributor adds a Python-dependent helper somewhere in `apps/worker/src/` without noticing that the shared worker has no `python3` binary, they will get a runtime `ENOENT` the first time the shared worker tries to spawn it. The shared worker's `buildCommand` comment in `render.yaml` calls this out explicitly, and the `runPikaSubprocess` implementation in `apps/worker/src/lib/pika-stream.ts` documents the deliberate minimal subprocess env — but the surface-area risk is real.
- **Build filters must stay in sync.** Both worker services' `buildFilter.paths` include `apps/worker/**`, so a change to either entry point rebuilds both instances. This is the correct behavior — the shared library code needs both instances rebuilt — but it means a one-line change to `index.ts` also redeploys the pika-worker, and vice versa. Not a problem in practice; noted for completeness.

### Neutral

- **The control plane stays on the shared worker by design.** `pika-poll` and `pika-leave` are single pure-TS HTTPS calls taking under a second each. There is no contention concern at that size, and giving them their own instance would triple the cost for zero UX benefit. The invite path is the only part of the Pika lifecycle that needs isolation.
- **Both entry points compile from one `tsc` invocation.** `apps/worker/package.json`'s `build` script is a plain `tsc` that picks up both `src/index.ts` and `src/index.pika.ts`. No composite project split, no separate tsconfig, no extra npm script.

## Alternatives considered

- **One shared worker handles everything, including Pika subprocesses.** Simplest possible topology. Rejected: measured click-to-spawn in the 500–1500ms range on a shared starter instance under realistic load (one analysis job + one review job in flight), which is user-visible on a feature where the user is actively staring at a browser tab. The isolation is the point.
- **Run Pika invites as Render Cron jobs or one-shot workers (fresh instance per invite).** No persistent queue, no idle instance cost. Rejected: instance cold-boot on Render starter is 30–60 seconds. That blows the click-to-spawn budget by two orders of magnitude before the subprocess has even started. Warm dedicated instance is the only topology that meets the latency target.
- **Separate code workspace (`apps/pika-worker/`) instead of a second entry point in the same workspace.** Cleaner mental model — one directory per service, one package.json per service. Rejected: the invite path needs the same database client, the same env module, the same Redis connection factory, the same job-row logging helper, and the same subprocess wrapper that the rest of `apps/worker/` already owns. A separate workspace would either duplicate all of that (a guaranteed drift hazard on a public showcase repo) or force a cross-workspace package import chain that TypeScript's composite build would fight us on. A second entry point in the same workspace costs 50 lines of wiring (`apps/worker/src/index.pika.ts`), reuses every helper by direct relative import, and keeps the `tsc` build path as a single pass. The top-of-file docstring in `apps/worker/src/index.pika.ts` documents this reasoning at the source.
- **Call Pika's API directly from the web service without a queue at all.** Skip BullMQ, skip the worker, have the HTTP request handler spawn the subprocess synchronously. Rejected on two grounds: the 90-second subprocess lifetime would hold the inbound HTTP connection open for the whole duration, which breaks the web instance's request budget and leaves no room for the poll/leave control plane to run on a separate timescale from the join; and a crashed web instance mid-join would leave an orphan Pika session on the remote side with no one polling to leave it. The queue-plus-worker split is what makes the lifecycle state machine (`pending → joining → active → ending → ended`) auditable across instance restarts.

## References

- [`CLAUDE.md`](../../CLAUDE.md) § "Pika video meeting integration" — the canonical integration doc, including the full session state machine, the exit-code → error-class mapping, and the env-var scoping rules.
- `render.yaml` — the first `type: worker` block declares the shared `launchkit-worker` service; the second declares the dedicated `launchkit-pika-worker` service with the Python install `buildCommand` and the scoped `PIKA_AVATAR` env var.
- `apps/worker/src/index.pika.ts` — dedicated entry point, registers only the PIKA_INVITE Worker. The top-of-file docstring is the load-bearing rationale for this ADR.
- `apps/worker/src/index.ts` — shared entry point's `pikaControlWorker` block, handling `pika-poll` and `pika-leave` on the same event loop as analysis/review/trending.
- `apps/worker/src/lib/pika-stream.ts` — `runPikaSubprocess` spawn implementation (minimal subprocess env that forwards only `PATH`, `HOME`, and `PIKA_DEV_KEY`) and `mapExitCodeToError` exit-code-to-error-class mapping referenced by the invite processor's catch block.
- `apps/worker/src/processors/process-pika-invite.ts` — the one processor that runs on the dedicated pika-worker instance.
- `apps/worker/src/processors/process-pika-poll.ts` and `process-pika-leave.ts` — the two pure-TS control-plane processors that run on the shared worker instance.
- `apps/worker/package.json` — single workspace, single dependency tree, single `tsc` build.
- Root `package.json` `start:worker` / `start:pika-worker` scripts — point at `dist/index.js` and `dist/index.pika.js` respectively.
