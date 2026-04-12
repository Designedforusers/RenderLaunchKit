import { and, eq, lt } from 'drizzle-orm';
import Redis from 'ioredis';
import * as schema from '@launchkit/shared';
import { database } from './database.js';
import { env } from './env.js';

/**
 * Clean up stale data:
 * - Old failed jobs (> 30 days)
 * - Expired GitHub API cache entries
 * - Orphaned webhook events
 */
export async function cleanupStaleLaunchData(): Promise<void> {
  console.log('[Cron:CleanupStaleLaunchData] Running cleanup...');

  // Clean old failed jobs (> 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const deletedJobs = await database
    .delete(schema.jobs)
    .where(
      and(
        lt(schema.jobs.createdAt, thirtyDaysAgo),
        eq(schema.jobs.status, 'failed')
      )
    )
    .returning({ id: schema.jobs.id });

  if (deletedJobs.length > 0) {
    console.log(
      `[Cron:CleanupStaleLaunchData] Deleted ${deletedJobs.length} old job records`
    );
  }

  // Clean old webhook events (> 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const deletedEvents = await database
    .delete(schema.webhookEvents)
    .where(lt(schema.webhookEvents.createdAt, ninetyDaysAgo))
    .returning({ id: schema.webhookEvents.id });

  if (deletedEvents.length > 0) {
    console.log(
      `[Cron:CleanupStaleLaunchData] Deleted ${deletedEvents.length} old webhook events`
    );
  }

  // Clean Redis cache entries using SCAN (non-blocking) instead of KEYS,
  // which is O(N) and blocks the Redis event loop on the shared instance
  // that also carries BullMQ queues and SSE pub/sub.
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  try {
    const cacheKeys: string[] = [];
    const stream = redis.scanStream({ match: 'github:cache:*', count: 100 });
    for await (const batch of stream) {
      cacheKeys.push(...(batch as string[]));
    }
    if (cacheKeys.length > 100) {
      const toDelete = cacheKeys.slice(0, cacheKeys.length - 50);
      if (toDelete.length > 0) {
        await redis.del(...toDelete);
        console.log(
          `[Cron:CleanupStaleLaunchData] Cleared ${toDelete.length} cached entries`
        );
      }
    }
  } catch (err) {
    console.error(
      '[Cron:CleanupStaleLaunchData] Redis cleanup error:',
      err instanceof Error ? err.message : err
    );
  } finally {
    // ioredis `disconnect()` is synchronous (returns void).
    redis.disconnect();
  }

  console.log('[Cron:CleanupStaleLaunchData] Cleanup complete');
}
