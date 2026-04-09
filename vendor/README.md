# vendor/ — vendored third-party CLI tools

> Note: the top-level `skills/` directory is reserved for the
> `npx skills add` symlink farm (see the comment at `.gitignore:58`).
> Runtime third-party code that our backend shells out to lives here
> under `vendor/` instead, following the conventional cross-language
> third-party vendoring location.

This directory holds **vendored, pinned, Apache-2.0 licensed** CLI tools
that the LaunchKit backend shells out to as subprocesses. Vendoring
(rather than installing via a package manager) gives us three things:

1. **Reproducibility** — the exact bytes we run locally and in
   production are committed to the repo and tied to a single upstream
   commit SHA, so a rebuild a year from now produces the same behavior.
2. **Offline-first installs** — the Render build does not need to
   reach out to a third-party git remote at deploy time. The Python
   dependency install (`pip install -r requirements.txt`) stays
   online, but the source code itself is on the filesystem.
3. **Visible provenance** — every vendored skill carries its upstream
   `LICENSE`, `NOTICE`, and a `Source:` comment at the top of every
   copied file naming the upstream repo and commit SHA. A single
   `grep` tells you where a file came from.

## Vendored tools

| Directory                     | Upstream                             | License    | Used by                                              |
|-------------------------------|--------------------------------------|------------|------------------------------------------------------|
| `pikastream-video-meeting/`   | [Pika-Labs/Pika-Skills][pika-skills] | Apache-2.0 | `apps/worker/src/lib/pika-stream.ts` (BullMQ `pika`) |

[pika-skills]: https://github.com/Pika-Labs/Pika-Skills

## Refreshing a vendored tool

The tool is pinned to a single upstream commit SHA. To refresh it:

1. Find the new commit SHA on the upstream repo's `main` branch.
2. Re-download every file from `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`
   (see the example below for `pikastream-video-meeting`).
3. Update the `Commit:` line in the provenance header at the top of
   every modified file (e.g. `SKILL.md`, `scripts/*.py`).
4. Run `npm run typecheck && npm run lint && npm test` to catch any
   CLI-contract drift in the TypeScript wrapper.
5. Commit the refresh as a single atomic PR with a commit message
   that records the old SHA → new SHA and links the upstream diff.

### Example refresh command — `pikastream-video-meeting`

```bash
SHA=<new-commit-sha>
cd vendor/pikastream-video-meeting
curl -sSL -o SKILL.md \
  "https://raw.githubusercontent.com/Pika-Labs/Pika-Skills/$SHA/pikastream-video-meeting/SKILL.md"
curl -sSL -o requirements.txt \
  "https://raw.githubusercontent.com/Pika-Labs/Pika-Skills/$SHA/pikastream-video-meeting/requirements.txt"
curl -sSL -o scripts/pikastreaming_videomeeting.py \
  "https://raw.githubusercontent.com/Pika-Labs/Pika-Skills/$SHA/pikastream-video-meeting/scripts/pikastreaming_videomeeting.py"
curl -sSL -o assets/placeholder-avatar.jpg \
  "https://raw.githubusercontent.com/Pika-Labs/Pika-Skills/$SHA/pikastream-video-meeting/assets/placeholder-avatar.jpg"
curl -sSL -o LICENSE \
  "https://raw.githubusercontent.com/Pika-Labs/Pika-Skills/$SHA/LICENSE"
curl -sSL -o NOTICE \
  "https://raw.githubusercontent.com/Pika-Labs/Pika-Skills/$SHA/NOTICE"
```

Then edit the `Commit:` line in `SKILL.md` to the new SHA and commit
the full diff in one PR.

## Why Python, given the rest of the repo is TypeScript

The LaunchKit backend is a TypeScript monorepo — web, worker, cron,
workflows, and the asset-generators package are all TypeScript. The
`pikastream-video-meeting` skill is a ~600-line Python CLI wrapping
Pika's HTTPS API, and its only runtime dep is `requests`. We had two
choices:

1. **Reimplement the CLI in TypeScript** — port the four subcommands
   (`join`, `leave`, `generate-avatar`, `clone-voice`) to Node, write
   our own `fetch` + FormData + polling loop, and maintain parity with
   every upstream API change.
2. **Vendor Pika's reference client and shell out to it** — install
   Python 3 + `requests` in the worker's Render build command, copy
   the skill verbatim, and wrap the subprocess in a typed TypeScript
   client (`apps/worker/src/lib/pika-stream.ts`) that handles stdin/
   stdout/exit-code translation.

We picked option 2. The wrapper is ~60 lines of `child_process.spawn`
plus a Zod schema for the streaming JSON stdout. Every upstream API
change lands in our tree as a verbatim re-vendor instead of a port.
The same pattern is already used by the worker for the Claude Agent
SDK (see `apps/worker/src/lib/agent-sdk-runner.ts`) — an established
"TypeScript → subprocess" precedent in this repo.

## What a vendored tool is NOT

- Not a runtime dependency of the `@launchkit/*` packages — the
  tool is only referenced from `apps/worker/src/lib/*-stream.ts` via
  an absolute path resolved from the repo root at spawn time.
- Not installed via `npm` or `pnpm` — it ships as filesystem content
  under `vendor/` and is picked up by its path.
- Not hot-reloadable — refreshing a vendored tool requires a new PR.
  If you need fast iteration, edit a local copy outside `vendor/` and
  only vendor when the upstream behavior is stable.
