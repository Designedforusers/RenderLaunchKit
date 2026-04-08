import { syncGitHubProjectActivity } from './sync-github-project-activity.js';
import { aggregateFeedbackInsights } from './aggregate-feedback-insights.js';
import { cleanupStaleLaunchData } from './cleanup-stale-launch-data.js';
import { ingestTrendingSignals } from './ingest-trending-signals.js';
import { enrichDevInfluencers } from './enrich-dev-influencers.js';
import { env } from './env.js';

async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║  LaunchKit Cron Service                  ║
║  Schedule: every 6 hours                 ║
║  Env: ${env.NODE_ENV.padEnd(34)}║
╚══════════════════════════════════════════╝
  `);

  const startTime = Date.now();

  try {
    // Run all cron tasks sequentially
    console.log('[Cron] Starting scheduled tasks...');

    // 1. Check repos for new activity
    await syncGitHubProjectActivity();

    // 2. Enqueue trending-signal ingest jobs for every active
    //    project category. Fires BullMQ jobs the worker picks up;
    //    the cron does not wait for completion.
    await ingestTrendingSignals();

    // 3. Enqueue a dev_influencers enrichment batch (Phase 5).
    //    Same enqueue/execute split as the trending ingest above —
    //    the cron only fires the job, the worker reads up to 50
    //    stale rows from `dev_influencers` and refreshes their
    //    bios + audience metrics + topic embeddings.
    await enrichDevInfluencers();

    // 4. Aggregate learning insights
    await aggregateFeedbackInsights();

    // 5. Clean up stale data
    await cleanupStaleLaunchData();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Cron] All tasks complete in ${duration}s`);
  } catch (err) {
    console.error('[Cron] Fatal error:', err);
    process.exit(1);
  }

  // Exit cleanly — Render cron jobs should terminate
  process.exit(0);
}

void main();
