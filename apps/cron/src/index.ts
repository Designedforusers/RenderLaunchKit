import { syncGitHubProjectActivity } from './sync-github-project-activity.js';
import { aggregateFeedbackInsights } from './aggregate-feedback-insights.js';
import { cleanupStaleLaunchData } from './cleanup-stale-launch-data.js';

async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║  LaunchKit Cron Service                  ║
║  Schedule: every 6 hours                 ║
║  Env: ${(process.env.NODE_ENV || 'development').padEnd(34)}║
╚══════════════════════════════════════════╝
  `);

  const startTime = Date.now();

  try {
    // Run all cron tasks sequentially
    console.log('[Cron] Starting scheduled tasks...');

    // 1. Check repos for new activity
    await syncGitHubProjectActivity();

    // 2. Aggregate learning insights
    await aggregateFeedbackInsights();

    // 3. Clean up stale data
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

main();
