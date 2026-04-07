# CLAUDE.md

Project context for [Claude Code](https://claude.com/claude-code) sessions opened against this repo. Auto-loaded by Claude Code on every conversation. Also the canonical engineering spec for any human contributor — start here, then `README.md` for what the product does.

---

## What this repo is

LaunchKit is an AI-powered go-to-market teammate. The pipeline:

```
GitHub URL → Analyze → Research (Agent SDK) → Strategize → Generate (parallel) → Review → Done
```

Five Render services (web, worker, cron, redis, postgres). One TypeScript monorepo. Public showcase for Render — every PR is graded on engineering discipline as much as product behavior. See `README.md` for the architectural rationale and `CONTRIBUTING.md` for the short-form contribution rules.

---

## Engineering invariants

These are the rules every PR has to clear. They're enforced in CI; they're listed here so you know *why* they're enforced before you fight them.

### TypeScript: all four strict flags on

`tsconfig.base.json` runs with `strict: true` plus:

- `noUncheckedIndexedAccess` — array and `Record` reads return `T | undefined`. Narrow with an `if (!row)` guard, not a `!` assertion.
- `exactOptionalPropertyTypes` — `field?: T` does not accept `undefined` as an explicit value, only as an absent property. Use the `...(value !== undefined ? { field: value } : {})` spread pattern at object literals.
- `noPropertyAccessFromIndexSignature` — bracket notation required when reading from a `Record<string, X>` (jsonb metadata, headers, lookup tables).
- `noImplicitOverride` — `override` is mandatory on subclass methods (no inheritance in this repo today, but the flag is on so any future class hierarchy gets it for free).

If a strict-flag fix needs an `as`, you're patching the wrong thing. Read the type, find the real shape, and narrow honestly.

### ESLint: every rule at `error`, `--max-warnings=0`

`eslint.config.mjs` is at error severity for the entire `recommendedTypeChecked` preset plus the anti-`any` family (`no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-argument`, `no-unsafe-return`). `npm run lint` runs with `--max-warnings=0` so a future warning is a hard CI failure.

Two scoped relaxations:

- `no-misused-promises` is set with `{ checksVoidReturn: { attributes: false } }` for the React surfaces only. Server-side files keep the strict default. (The default forces a `void` wrapper on every `onClick={async () => …}`, which is noise without catching real bugs.)
- `no-explicit-any` and `no-non-null-assertion` are turned off for `seed.ts` and the config-file glob. Both files type-erase at the boundary on purpose; runtime schemas catch shape mistakes.

### Zod at every runtime boundary

Every external input parses through a Zod schema:

- HTTP request bodies (`apps/web/src/routes/*.ts` use `zodSchema.safeParse(rawBody)` — never `body.field` directly)
- Drizzle jsonb columns (the `parseJsonbColumn(Schema, value, context)` helper in `@launchkit/shared`)
- LLM responses (`generateJSON(Schema, ...)` in `apps/worker/src/lib/anthropic-claude-client.ts`)
- External API responses (fal.ai, GitHub REST, ElevenLabs)
- Server-Sent Event payloads on the dashboard
- `process.env` (the typed `env` modules below)
- GitHub webhook payloads
- pgvector raw-SQL row results

There are exactly two live `as unknown as` casts in source code, both under `apps/`, both with an explanatory comment at the call site:

- `apps/worker/src/agents/launch-research-agent.ts` — SDK contravariance bridging the heterogeneous Zod tool union to the SDK's `SdkMcpToolDefinition<any>` array.
- `apps/web/src/routes/asset-api-routes.ts` — Node `Readable.toWeb()` returns `ReadableStream<Uint8Array>` from `node:stream/web`, which TypeScript treats as nominally distinct from the WHATWG `ReadableStream<Uint8Array>` the platform `Response` constructor expects. The double cast bridges the two structurally identical types.

The phrase `as unknown as` also appears inside two doc comments (`apps/worker/src/index.ts`, `packages/shared/src/schemas/index.ts`) — both narrate prior history, neither is a live cast. A grep for the phrase returns four hits; only the two listed above are real casts. If you're tempted to add a third, talk yourself out of it first.

### Typed env modules, lazy parsed

Each backend service has its own env module:

- `apps/web/src/env.ts`
- `apps/worker/src/env.ts`
- `apps/cron/src/env.ts`

Each exports a Zod-validated `env` object that lazy-parses `process.env` on first field access via a `Proxy`. The Proxy carries explicit `set`/`deleteProperty` traps and a symbol-key guard in `get`. Never read `process.env.X` directly in backend code — import `env` and read `env.X`.

The dashboard and `@launchkit/shared` intentionally do not get an env module: the dashboard runs in the browser, and `@launchkit/shared` must stay browser-buildable.

### Domain types come from Zod schemas

`packages/shared/src/schemas/*.ts` define every cross-package domain shape. The corresponding TypeScript types are `z.infer<typeof Schema>` re-exports in `packages/shared/src/types.ts`. Drizzle pgEnums are the source of truth for status/type unions (`AssetType`, `AssetStatus`, `ProjectStatus`).

If you need a new domain type, write the Zod schema first.

### Conventions worth knowing

- `ProjectProgressPublisher` means internal Redis/SSE progress events. `SocialPublisher` (future) means external posting to a platform. Don't confuse the two.
- `generationInstructions` always means the exact instructions used to create or regenerate an asset. It is not a synonym for `brief`, `prompt`, or `description`.
- Role-based agent names (`launch-research-agent`, `launch-strategy-agent`, `creative-director-agent`) describe the AI persona. Processor names (`analyze-project-repository`, `build-project-launch-strategy`) describe the concrete system action.

---

## CI/CD philosophy

The repo runs **two layers of the same chain**:

1. **Local prepush** (`lefthook.yml`) — `npm run typecheck && npm run lint && npm run build && npm test`
2. **GitHub Actions** (`.github/workflows/ci.yml`) — same four steps, on `push: main` and `pull_request: main`

Two layers, same rules. Local prepush exists so a developer fails fast on their own machine instead of waiting for CI. CI exists because lefthook can be skipped (`LEFTHOOK=0 git push`) and because a fork PR will not have lefthook installed at all. Both layers must be green.

The workflows live in `.github/workflows/`. CI uses `cancel-in-progress: true` so a stale PR run is killed when a new commit lands — CI minutes are not free on a private repo and there is no value in finishing a stale build.

### What CI does *not* do

- **No deployment.** Render handles deploys via the Blueprint in `render.yaml`. CI is a quality gate, not a delivery pipeline.
- **No coverage gating.** The `tests/` directory contains smoke tests that exercise the import surface and the validators that the agentic loops rely on. Real end-to-end tests against the Agent SDK live in a separate deploy-time integration check, not in this repo.
- **No auto-merge.** PRs are merged manually after human + AI review. Branch protection requires the CI check to pass before merge is allowed; nothing automates the actual click.

---

## Code review chain

Every PR goes through **two** review passes before it lands on `main`:

### 1. Local code review (mandatory, runs before push)

The author runs the bundled `code-reviewer` Claude Code subagent against the staged diff before pushing. This is the primary line of defense — the reviewer reads the diff, the surrounding files, and the engineering invariants above, and returns blocking issues / non-blocking nits / a "looks good" list.

**Why it's mandatory:** the cloud reviewer (next section) costs API credits and runs only when explicitly invoked. The local pass is free, runs in seconds, and catches the kind of bugs that would otherwise reach production unnoticed because the human author is too close to the code.

**How to run it (Claude Code session):**

> Use the `code-reviewer` subagent to review the staged diff against `main`. Focus on:
> 1. Strict-flag soundness — no new `any`, no unsafe member access, no non-null assertion regressions
> 2. Boundary validation — every new external input parses through a Zod schema
> 3. Real bugs the diff might mask — silently dropped behavior, broken error paths, async race conditions
> 4. CLAUDE.md alignment — call out drift from the conventions documented here
>
> Be specific. Quote `file:line` for every issue. Reply with blocking issues first, then non-blocking nits, then a "looks good" list.

The reviewer is a Claude Code feature. If you're not using Claude Code, the cloud reviewer below is your alternative.

### 2. On-demand cloud review (`@claude review`)

`.github/workflows/claude-review.yml` wires up [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action). Comment `@claude review` (case-sensitive — `contains()` in GitHub Actions expressions does not lowercase) anywhere on the PR conversation tab and the action posts a review back as a PR comment. The action only fires on comments containing the literal string `@claude review`, so casual `@claude` mentions in conversation do not burn API credits.

**When to invoke:**

- After a tricky refactor — second opinion on the local reviewer's pass.
- On a PR opened by a contributor who isn't using Claude Code locally.
- Before a high-risk merge (large diff, security-sensitive change, schema migration) — pay the credits, get the second pair of eyes.

**Setup:** the GitHub App is installed via `claude /install-github-app` from a local Claude Code session. That command walks through the App install and the `ANTHROPIC_API_KEY` repository secret in one step.

### Why both, and why local first

The local reviewer is **fast, free, and contextual** — it reads the diff alongside `CLAUDE.md` and the surrounding files in the same conversation, so it catches drift from project conventions. The cloud reviewer is **independent, asynchronous, and visible to the team** — its review lands as a PR comment that anyone can read, and it runs in a clean environment without the author's working-tree state biasing it. They catch different bugs, so we use both.

The order matters: local first (always) → cloud on demand (sometimes). Reversing the order would mean the cloud reviewer becomes the only check, which is both more expensive and less aligned to the codebase conventions.

### Setting this up in your own repo

The pattern generalizes. To copy it:

1. **Local reviewer.** No setup beyond having Claude Code installed. The `code-reviewer` subagent ships with Claude Code.
2. **Cloud reviewer — install the GitHub App.** From a Claude Code session in your repo, run `claude /install-github-app`. The command is mandatory, not optional: it installs the Claude GitHub App on the repo and configures the `ANTHROPIC_API_KEY` repository secret in one step. Without it, the workflow file in step 3 will fail with a missing-secret error on first invocation.
3. **Cloud reviewer — drop the workflow.** Copy `.github/workflows/claude-review.yml` from this repo as a starting point. The `prompt:` field is project-specific — adapt it to call out the conventions your codebase cares about (strict-flag soundness, boundary validation, naming conventions, etc.).
4. **Discipline.** Add a CONTRIBUTING.md or similar file that says "run the local reviewer before push." Without that, the workflow becomes "I'll just push and let CI tell me." The whole point is to fail fast on your own machine.

---

## Local development

```bash
git clone <your-fork>
cd renderlaunchkit
npm install              # also installs lefthook + git hooks via `prepare`
docker compose up -d     # local Postgres + Redis
cp .env.example .env     # then fill in your API keys
npm run db:push          # apply schema
npm run seed             # demo data
npm run dev              # web, worker, cron, dashboard concurrently
```

The dashboard is at `http://localhost:5173`, the API at `http://localhost:3000`.

### Useful scripts

| Script | What it does |
|---|---|
| `npm run dev` | Concurrent web + worker + cron + dashboard with HMR |
| `npm run build` | Composite tsc for backends + Vite build for the dashboard |
| `npm run typecheck` | `tsc -b` + dashboard `tsc --noEmit` (the prepush gate) |
| `npm run lint` | `eslint . --max-warnings=0` (the prepush gate) |
| `npm test` | Smoke tests via `node:test` against compiled worker output |
| `npm run db:push` | Apply Drizzle schema to the local database |
| `npm run db:studio` | Open Drizzle Studio against the local database |
| `npm run seed` | Reseed the local database with the demo project + insights |

---

## Anti-patterns (do not do these)

- **Adding `as any` or `as unknown as X` casts.** The boundary-validation pass already deleted every cast in the repo. The two remaining casts are documented at the call site. Adding a third without first proving the underlying type is wrong is a regression.
- **Reading `process.env.X` directly.** Use the typed `env` modules.
- **Skipping the prepush hook with `LEFTHOOK=0`.** CI will catch the same failure on the server, only slower.
- **Squash-merging.** History is linear via rebase-merge.
- **Adding a feature flag for code that already works.** Trust internal code; validate at system boundaries only. Don't ship "just in case" toggles.
- **Adding error handling for impossible cases.** If the type system says the value can't be null and the code path proves it, don't add a defensive check that pollutes the diff. Validate at the boundary and trust the rest.
- **Auto-formatting unrelated code in a PR.** Reviewers cannot read 200 lines of whitespace changes. Keep the diff focused.

---

## Where the spec lives

- `README.md` — what the product does and how to deploy it
- `CONTRIBUTING.md` — short-form contribution rules (points back here)
- `CLAUDE.md` (this file) — engineering invariants and the review chain
- `.github/workflows/ci.yml` — the CI gate
- `.github/workflows/claude-review.yml` — the on-demand cloud reviewer
- `lefthook.yml` — the local prepush gate
- `eslint.config.mjs` — every lint rule with rationale comments
- `tsconfig.base.json` — every strict flag

If something is documented in two places, the file closest to the code wins. If you change a convention, update this file in the same PR.
