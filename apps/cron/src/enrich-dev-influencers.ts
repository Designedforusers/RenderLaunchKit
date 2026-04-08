import { Queue } from 'bullmq';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  type EnrichDevInfluencersJobData,
} from '@launchkit/shared';
import { env } from './env.js';

/**
 * Enqueue a single dev_influencers enrichment job for the worker to
 * process on the next run.
 *
 * Phase 5 — same enqueue/execute split as Phase 3's
 * `ingest-trending-signals.ts`. The cron is the scheduler; the worker
 * is the executor. We deliberately do NOT call the enrichment tools
 * inline here because:
 *
 *   1. The enrichment tools live in `apps/worker/src/tools/` and
 *      pulling them into the cron bundle would couple the two services
 *      and bloat the cron deploy.
 *   2. The Voyage embed call (and the X API call when enabled) belong
 *      on the worker, where every other agent / tool credential lives.
 *   3. The cron's role is to fire jobs on a cadence; the worker's role
 *      is to do the actual work. Splitting them keeps each service's
 *      env surface minimal and matches the existing trending-signal
 *      pattern at `ingest-trending-signals.ts:62-123`.
 *
 * The single job covers ALL stale influencers in one batch (the worker
 * processes them sequentially). Per-cron-run idempotency is enforced
 * via a deterministic `jobId` based on a 6-hour bucket — a re-invocation
 * of the cron inside the same window is deduplicated by BullMQ rather
 * than doubling the upstream API calls.
 *
 * Bypass mode
 * -----------
 *
 * The cron always enqueues the job, even when `VOYAGE_API_KEY` is
 * unset on the worker. The worker-side processor checks its own env
 * vars and no-ops cleanly if it cannot do the work — no surprises at
 * enqueue time.
 */

export async function enrichDevInfluencers(): Promise<void> {
  console.log(
    '[Cron:EnrichDevInfluencers] Enqueuing enrichment job...'
  );

  // Open a transient Queue against the same Redis the worker reads
  // from. The cron exits immediately after main(), so we close the
  // queue inside this function rather than holding a singleton.
  const redisUrl = new URL(env.REDIS_URL);
  const trendingQueue = new Queue(QUEUE_NAMES.TRENDING, {
    connection: {
      host: redisUrl.hostname,
      port: parseInt(redisUrl.port || '6379', 10),
      password: redisUrl.password || undefined,
    },
  });

  try {
    const payload: EnrichDevInfluencersJobData = {
      batchSize: 50,
      xEnrichmentIntervalHours: env.X_API_ENRICHMENT_INTERVAL_HOURS,
    };
    await trendingQueue.add(JOB_NAMES.ENRICH_DEV_INFLUENCERS, payload, {
      // 6-hour bucket matches the cron cadence so two runs inside the
      // same window dedupe to one enqueue. Same idiom as Phase 3's
      // 10-minute bucket at `ingest-trending-signals.ts:159-162`.
      jobId: `${JOB_NAMES.ENRICH_DEV_INFLUENCERS}__${computeBucket()}`,
    });
    console.log(
      `[Cron:EnrichDevInfluencers] Enqueued enrichment job (batchSize=50, xIntervalHours=${String(env.X_API_ENRICHMENT_INTERVAL_HOURS)}).`
    );
  } catch (err) {
    console.warn(
      '[Cron:EnrichDevInfluencers] enqueue failed —',
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    await trendingQueue.close();
  }
}

function computeBucket(): number {
  const sixHourMs = 6 * 60 * 60 * 1000;
  return Math.floor(Date.now() / sixHourMs);
}
