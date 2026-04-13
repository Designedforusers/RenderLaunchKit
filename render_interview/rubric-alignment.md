# Rubric Alignment: How LaunchKit Maps to the Assessment

## "Does it work well?"

- Full pipeline: GitHub URL → analyze → research → strategize → generate (parallel) → review → done
- 9 asset types generated in parallel via Render Workflows with per-task compute sizing
- Self-learning feedback loop: user edits → Voyage embeddings → pgvector clustering → improved future generations
- Chat endpoint with Claude streaming, deep search tools, and project context
- Real-time progress via SSE
- Cost tracking via AsyncLocalStorage (per-asset, per-provider)

## "Does it demonstrate best practices?"

- Zero TypeScript violations: strict mode + 4 extra flags, zero `@ts-ignore`, 2 documented `as unknown as` casts
- Zod validation at every runtime boundary (HTTP, LLM responses, env vars, webhooks)
- ESLint `--max-warnings=0` with anti-`any` rules
- 170 passing tests
- Rate limiting on all expensive endpoints
- Structured error handling with non-blocking cost tracking
- Optimistic concurrency control on asset writes
- HMAC signature verification on webhooks with timing-safe comparison

## "Can developers learn from it?"

- README has "Patterns you can steal" section
- render.yaml has inline comments explaining every service's role
- Architecture Decisions section with commit SHA links
- Step-by-step deploy instructions with smoke test
- 5 ADRs documenting why, not just what
- `.env.example` with full documentation per variable

## "Does it make Render look appealing?"

Render features used (with architectural justification for each):

| Feature | How it's used | Why it matters |
|---|---|---|
| Workflows | Per-asset compute sizing via run chaining | Starter for text, pro for video — no oversized shared worker |
| Blueprints | 7 services from one `render.yaml` | Fork, click, deploy — reproducible topology |
| Key-Value | Triple duty: queues + pub/sub + cache | One service, three roles, `noeviction` policy |
| Postgres | Relational + pgvector embeddings | One DB for CRUD and similarity search |
| Cron | 6-hourly trending signals + feedback clustering | Scheduled background work |
| Disks | MinIO persistence for rendered videos | Durable storage without external S3 |
| Docker | Renderer + Pika worker | System packages where Node runtime can't |

## Bonus points we hit

- [x] Blueprint — 7 services provisioned from one file
- [x] Background workers — BullMQ on dedicated instances
- [x] Cron Jobs — trending signal ingestion + feedback aggregation
- [x] Render Workflows — per-task compute isolation
- [x] Render Disks — persistent video storage
- [x] Docker services — for system-level runtime needs
