---
paths:
  - "**/pika*"
  - "apps/worker/src/index.pika.ts"
  - "vendor/pikastream-video-meeting/**"
---

# Pika video meeting integration

Real-time AI avatar joins meetings via [Pika](https://www.pika.me). User clicks "Invite AI teammate to a meet" on the dashboard.

## Two-service split

| Service | Queue | What it does |
|---|---|---|
| `launchkit-pika-worker` (dedicated) | `pika-invite` | Spawns Python subprocess for ~90s join handshake |
| `launchkit-worker` (shared) | `pika-control` | Pure-TS `fetch()` for poll + leave |

Both compile from `apps/worker/` — two entry points (`index.js`, `index.pika.js`), shared code.

## Session lifecycle

```
pending → joining → active → ending → ended
                 ↘ failed
```

## Critical invariants

- **Never auto-invoked.** Every session requires explicit user click. No strategist, review loop, or cron triggers it.
- **60-minute safety cap** on bot runtime (runaway protection, not usage limit).
- **Env var mapping:** codebase uses `PIKA_API_KEY`, Python CLI reads `PIKA_DEV_KEY` — renamed at subprocess spawn time.
- **`PIKA_AVATAR` is user-private** — never commit, log, or echo. Only the pika-worker service has it.
- **Exit code 6 / `checkoutUrl` presence** = insufficient credits, regardless of actual exit code.

## Cost

$0.275/minute flat rate. Leave processor writes cost event with `asset_id=NULL` to `asset_cost_events`.
