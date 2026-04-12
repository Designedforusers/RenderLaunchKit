---
paths:
  - "**/feedback*"
  - "**/insight*"
  - "**/strategy_insights*"
  - "apps/cron/src/aggregate-feedback-insights.ts"
  - "**/project-insight-memory*"
  - "**/embed-feedback-event*"
---

# Self-learning loop

Three-layer feedback system. User actions on generated assets become prompt context for future generations.

## Layer 1 — stat-based insights

6-hourly cron reads `asset_feedback_events` (30 days), writes `strategy_insights` rows for:
- `insight_type='approval_rate_by_type'` — high/low approval rates per `(asset_type, category)`
- `insight_type='trend_velocity'` — trend velocity vs asset quality on commit-marketing runs

## Layer 3 — semantic edit clustering

User edits → Voyage embeddings (`vector(1024)`) → pgvector cosine-similarity clustering (`≥ 0.7`, `≥ 3` members) → Claude Haiku compresses cluster to imperative directive → `insight_type='edit_pattern'`. Falls back to longest raw edit when `ANTHROPIC_API_KEY` is unset.

## Read path

`project-insight-memory.ts` exposes two accessors (mirrored in worker and workflows):
- `getInsightsForCategory(category)` — stat-based rows (consumed by all agents)
- `getEditPatternsForCategory(category)` — edit pattern rows, top-10 by confidence

Three agents read both: `launch-strategy-agent`, `written-asset-agent`, and voice/podcast agents via `WriterInput.editPatterns`.

## Local demo

```bash
npm run seed && npm run seed:run-feedback-cron
```

Seeds realistic edit clusters + runs aggregation. Next strategy-build sees the cluster summaries.
