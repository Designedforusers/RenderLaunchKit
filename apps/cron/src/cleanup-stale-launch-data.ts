import { and, eq, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import Redis from 'ioredis';
import * as schema from '@launchkit/shared';
import { env } from './env.js';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool, { schema });

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

  const deletedJobs = await db
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

  const deletedEvents = await db
    .delete(schema.webhookEvents)
    .where(lt(schema.webhookEvents.createdAt, ninetyDaysAgo))
    .returning({ id: schema.webhookEvents.id });

  if (deletedEvents.length > 0) {
    console.log(
      `[Cron:CleanupStaleLaunchData] Deleted ${deletedEvents.length} old webhook events`
    );
  }

  // Clean Redis cache entries
  try {
    const redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });

    const cacheKeys = await redis.keys('github:cache:*');
    if (cacheKeys.length > 100) {
      // Only clean if cache is large
      const toDelete = cacheKeys.slice(0, cacheKeys.length - 50);
      if (toDelete.length > 0) {
        await redis.del(...toDelete);
        console.log(
          `[Cron:CleanupStaleLaunchData] Cleared ${toDelete.length} cached entries`
        );
      }
    }

    // ioredis `disconnect()` is synchronous (returns void). The
    // earlier `await` was a no-op the linter correctly flagged.
    redis.disconnect();
  } catch (err) {
    console.error(
      '[Cron:CleanupStaleLaunchData] Redis cleanup error:',
      err instanceof Error ? err.message : err
    );
  }

  console.log('[Cron:CleanupStaleLaunchData] Cleanup complete');
}
