/**
 * One-shot entrypoint for `npm run seed:run-feedback-cron`.
 *
 * Fires `aggregateFeedbackInsights` (the Layer 1 + Layer 3 self-
 * learning aggregator) once and exits. Used by the local demo path
 * to close the seed → cron → strategy_insights → agent prompt loop
 * without waiting for the every-6-hours scheduled cron run.
 *
 * The full cron's `index.ts` runs four jobs in sequence (sync,
 * trending-signal ingest, aggregate, cleanup); none of the other
 * three is interesting for the self-learning demo, so this entry
 * point only invokes the aggregation. The cron's env module is
 * still loaded at module init via the import side-effect on
 * `aggregate-feedback-insights.js`, so `DATABASE_URL` and the
 * optional `ANTHROPIC_API_KEY` are picked up from `.env` at the
 * repo root automatically.
 *
 * Exit codes:
 *   0 — aggregation completed (cluster summaries written or
 *       gracefully skipped on missing API key)
 *   1 — fatal error inside the aggregator (DB outage, schema
 *       drift, ...). The error is logged in full before exit.
 */
import { aggregateFeedbackInsights } from './aggregate-feedback-insights.js';

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════╗
║  LaunchKit Feedback Aggregation (manual) ║
╚══════════════════════════════════════════╝
`);
  const startedAt = Date.now();
  try {
    await aggregateFeedbackInsights();
    const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n[Cron:run-feedback-aggregation] Done in ${duration}s`);
    process.exit(0);
  } catch (err) {
    console.error('[Cron:run-feedback-aggregation] Fatal:', err);
    process.exit(1);
  }
}

void main();
