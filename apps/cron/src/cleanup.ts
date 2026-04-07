import { sql, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import Redis from 'ioredis';
import * as schema from '@launchkit/shared';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

/**
 * Clean up stale data:
 * - Old failed jobs (> 30 days)
 * - Expired GitHub API cache entries
 * - Orphaned webhook events
 */
export async function cleanup(): Promise<void> {
  console.log('[Cron:Cleanup] Running cleanup...');

  // Clean old failed jobs (> 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const deletedJobs = await db
    .delete(schema.jobs)
    .where(lt(schema.jobs.createdAt, thirtyDaysAgo))
    .returning({ id: schema.jobs.id });

  if (deletedJobs.length > 0) {
    console.log(`[Cron:Cleanup] Deleted ${deletedJobs.length} old job records`);
  }

  // Clean old webhook events (> 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const deletedEvents = await db
    .delete(schema.webhookEvents)
    .where(lt(schema.webhookEvents.createdAt, ninetyDaysAgo))
    .returning({ id: schema.webhookEvents.id });

  if (deletedEvents.length > 0) {
    console.log(`[Cron:Cleanup] Deleted ${deletedEvents.length} old webhook events`);
  }

  // Clean Redis cache entries
  try {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });

    const cacheKeys = await redis.keys('github:cache:*');
    if (cacheKeys.length > 100) {
      // Only clean if cache is large
      const toDelete = cacheKeys.slice(0, cacheKeys.length - 50);
      if (toDelete.length > 0) {
        await redis.del(...toDelete);
        console.log(`[Cron:Cleanup] Cleared ${toDelete.length} cached entries`);
      }
    }

    await redis.disconnect();
  } catch (err) {
    console.error('[Cron:Cleanup] Redis cleanup error:', err instanceof Error ? err.message : err);
  }

  console.log('[Cron:Cleanup] Cleanup complete');
}
