# Contributing to LaunchKit

LaunchKit is a public Render showcase. Code that lands on `main` is graded as much for engineering discipline as for what it does, so the contribution bar is intentionally high. This file is the short version of the rules; **`CLAUDE.md` is the canonical spec** — read it before opening a PR.

---

## Quick start

```bash
git clone <your-fork>
cd renderlaunchkit
npm install            # also installs lefthook + git hooks via `prepare`
cp .env.example .env   # then fill in your API keys
npm run setup:local
npm run dev
```

The dashboard is at `http://localhost:5173`, the API at `http://localhost:3000`. `npm run setup:local` uses the tracked `docker-compose.yml` stack: Postgres on `localhost:5432`, Redis on `localhost:6379`, and MinIO on `localhost:9000` / `localhost:9001`. See `README.md` for the full deployment story.

---

## Before you push

The `lefthook` prepush hook runs the same chain CI runs:

```bash
npm run typecheck   # tsc -b, all four strict flags on
npm run lint        # eslint . --max-warnings=0, every rule at error
npm run build       # web/worker/cron tsc + dashboard vite
npm test            # node:test smoke tests
```

If any step fails, the push is rejected. Don't `LEFTHOOK=0 git push` to skip it — CI will catch the same failure on the server, only slower.

---

## PR requirements

- **Atomic and reviewable.** One concern per PR. If you need to refactor a file to make a fix possible, the refactor and the fix can land together as long as the diff is small enough to read in one sitting.
- **Conventional commit subject.** `type(scope): summary`. The body explains *why*, not *what* — the diff already shows what.
- **Code-reviewer self-review.** Run the `code-reviewer` Claude Code subagent against the diff before pushing (`/review` in a Claude Code session, or spawn a `code-reviewer` subagent manually).
- **CI green.** The CI workflow re-runs the prepush chain on the server. A red build blocks merge.
- **Rebase-merge only.** Linear history is enforced via `gh pr merge --rebase` (or the GitHub UI's "Rebase and merge"). No squash, no merge commits.

---

## What goes in `CLAUDE.md`

`CLAUDE.md` is the file Claude Code auto-loads as project context every time someone opens this repo in a Claude Code session. It's also the file a human reviewer (or a future you) reads to understand the conventions. If you change a convention, update `CLAUDE.md` in the same PR.

It documents:

- The CI/CD philosophy and the local + cloud review chain
- The strict TypeScript flags and what they imply for new code
- Boundary validation rules (every external input parses through Zod)
- The env-module pattern (`apps/{web,worker,cron,workflows}/src/env.ts`)
- The Render Workflows architecture (the asset-generation fan-out lives there, behind a seven-task registration; the worker still owns analyze/research/strategize/review)
- The cost tracking design and the non-blocking invariant (long-form explainer at `docs/cost-tracking.md`)
- The local `code-reviewer` subagent setup for contributors using Claude Code
- The on-demand `@claude review` cloud reviewer for everyone else

---

## Scope and license

LaunchKit is MIT-licensed. By contributing you agree your contribution is licensed under the same terms.
