# CLAUDE.md

Project context for [Claude Code](https://claude.com/claude-code) sessions. Start here, then `README.md` for what the product does.

---

## What this repo is

LaunchKit is an AI-powered go-to-market teammate. Pipeline: `GitHub URL → Analyze → Research → Strategize → Generate (parallel) → Review → Done`. One TypeScript monorepo, eight Render services. Public showcase for Render — every PR is graded on engineering discipline.

```
apps/web/                  → Hono API server + static dashboard hosting
apps/dashboard/            → React SPA (Vite) served by apps/web
apps/worker/               → BullMQ processors + AI agents
apps/workflows/            → Render Workflows asset generation tasks
apps/cron/                 → Scheduled jobs (feedback aggregation, trending)
packages/shared/           → Drizzle schema, Zod schemas, shared types
packages/asset-generators/ → Provider clients (Claude, fal.ai, ElevenLabs, World Labs)
```

## Verification commands

```bash
npm run typecheck    # tsc -b + dashboard tsc --noEmit
npm run lint         # eslint . --max-warnings=0
npm run build        # composite tsc + Vite
npm test             # smoke tests via node:test
npm run dev          # concurrent web + worker + cron + dashboard
```

## Engineering invariants

### TypeScript strict flags

`strict: true` plus four extra flags. The two that trip people up:

- `noUncheckedIndexedAccess` — array/Record reads return `T | undefined`. Narrow with `if (!row)`, never `!`.
- `exactOptionalPropertyTypes` — `field?: T` won't accept explicit `undefined`. Use the `...(value !== undefined ? { field: value } : {})` spread pattern.

If a strict-flag fix needs `as`, you're patching the wrong thing. Narrow honestly.

### ESLint: zero warnings

`--max-warnings=0`. The anti-`any` family is on (`no-explicit-any`, `no-unsafe-*`). See `eslint.config.mjs` for the two scoped relaxations.

### Zod at every runtime boundary

Every external input (HTTP bodies, LLM responses, env vars, jsonb columns, external APIs, webhooks) parses through a Zod schema. Never read raw input directly.

### No new `as unknown as` casts

Two exist in centralised helpers (`asAgentSdkTools` and `fileToWebStream`), both with docstrings. Extend one of those helpers before adding a third.

### Typed env modules

Never read `process.env.X`. Import `env` from the service's `env.ts` and read `env.X`. The dashboard and `@launchkit/shared` intentionally have no env module (browser-buildable).

### Domain types from Zod

Write the Zod schema first in `packages/shared/src/schemas/`. Types are `z.infer<>` re-exports in `packages/shared/src/types.ts`. Drizzle pgEnums are the source of truth for status/type unions.

### Naming conventions

- `generationInstructions` = exact instructions for asset creation. Not `brief`, `prompt`, or `description`.
- `ProjectProgressPublisher` = internal Redis/SSE events. `SocialPublisher` (future) = external platform posting.
- Agent names (`launch-research-agent`) = AI persona. Processor names (`analyze-project-repository`) = system action.

### Worker / workflows deliberate code duplication

Each backend service owns its own `database.ts`, `anthropic-claude-client.ts`, and `project-insight-memory.ts`. This duplication is intentional — do not extract into a shared package.

## Local development

```bash
npm install && docker compose up -d && cp .env.example .env
npm run db:push && npm run seed && npm run dev
```

Dashboard: `http://localhost:5173` — API: `http://localhost:3000`

| Script | What it does |
|---|---|
| `npm run db:push` | Apply Drizzle schema to the local database |
| `npm run db:studio` | Open Drizzle Studio against the local database |
| `npm run seed` | Reseed with demo project + feedback insights |

## Anti-patterns

- Adding `as any` or `as unknown as X` casts
- Reading `process.env.X` directly
- Skipping prepush with `LEFTHOOK=0` (CI catches the same failure, only slower)
- Squash-merging (history is linear via rebase-merge)
- Adding feature flags or error handling for impossible cases
- Auto-formatting unrelated code in a PR

## Workflows service

`apps/workflows/` hosts seven Render Workflows task definitions (one parent, five generation children, one render child). Created manually in the Render dashboard — not via Blueprint (Render Workflows is public beta). Worker and web each have their own `trigger-workflow-generation.ts` (deliberate copy — each service owns its SDK client). See `.claude/rules/workflows.md` for architecture detail.

## Reference docs

- `README.md` — architecture overview and deploy runbook
- `CONTRIBUTING.md` — contribution rules and review workflow
- `docs/cost-tracking.md` — AsyncLocalStorage cost tracking design
