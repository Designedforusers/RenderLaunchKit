import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import {
  JOB_NAMES,
  ProjectCategorySchema,
  QUEUE_NAMES,
  type IngestTrendingSignalsJobData,
  type ProjectCategory,
} from '@launchkit/shared';
import { env } from './env.js';

/**
 * Enqueue trending-signal ingest jobs for every distinct project
 * category in the active projects set.
 *
 * Runs on the cron's 6-hour cadence. Cron is the scheduler; the
 * worker is the executor — we deliberately do not run the agent
 * loop inline here because the cron service does not depend on
 * `@anthropic-ai/claude-agent-sdk` and pulling the SDK into the
 * cron bundle would double its deploy footprint. The worker
 * process picks up each enqueued job, runs the agentic fan-out
 * (Grok + Exa + 5 free APIs), clusters the results, and writes
 * them to `trend_signals`.
 *
 * Failure tolerance
 * -----------------
 *
 * Each category is enqueued independently. A single enqueue
 * failure is logged and the rest of the categories still go out.
 * The BullMQ worker has its own retry + removal policy configured
 * in `packages/shared/src/constants.ts` — the cron does not wait
 * for completion.
 *
 * Bypass mode
 * -----------
 *
 * When `ANTHROPIC_API_KEY` is unset the cron still enqueues jobs;
 * the worker-side processor checks the same env var and no-ops
 * cleanly so there is no surprise at enqueue time. We only skip
 * the enqueue entirely when the cron cannot even reach Postgres
 * to load the category list.
 */

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = drizzle(pool, { schema });

// Fallback categories used when the projects table is empty (fresh
// deploy, demo environment). Keeps the cron producing useful data
// from day one instead of silently no-op'ing. Matches a sensible
// subset of the `ProjectCategory` enum values.
const DEFAULT_CATEGORIES = [
  'framework',
  'devtool',
  'library',
  'infrastructure',
  'data',
] as const satisfies readonly ProjectCategory[];

export async function ingestTrendingSignals(): Promise<void> {
  console.log(
    '[Cron:IngestTrendingSignals] Enqueuing ingest jobs for active project categories...'
  );

  const categories = await loadActiveCategories();
  if (categories.length === 0) {
    console.log(
      '[Cron:IngestTrendingSignals] No active categories found — nothing to enqueue'
    );
    return;
  }

  console.log(
    `[Cron:IngestTrendingSignals] Enqueuing for ${String(categories.length)} categories: ${categories.join(', ')}`
  );

  // Construct a transient Queue client against the same Redis the
  // worker consumes from. The cron exits immediately after main()
  // in `index.ts`, so we close the queue inside this function
  // rather than holding a process-lifetime singleton.
  const redisUrl = new URL(env.REDIS_URL);
  const trendingQueue = new Queue(QUEUE_NAMES.TRENDING, {
    connection: {
      host: redisUrl.hostname,
      port: parseInt(redisUrl.port || '6379', 10),
      password: redisUrl.password || undefined,
    },
  });

  const expiresAt = new Date(
    Date.now() + env.TRENDING_SIGNAL_TTL_HOURS * 60 * 60 * 1000
  );

  let enqueued = 0;
  for (const category of categories) {
    try {
      const payload: IngestTrendingSignalsJobData = {
        category,
        expiresAt,
      };
      await trendingQueue.add(JOB_NAMES.INGEST_TRENDING_SIGNALS, payload, {
        // Deterministic job ID per category per 10-minute bucket so a
        // double invocation of the cron inside the same window is
        // deduplicated by BullMQ rather than doubling the upstream
        // API calls.
        jobId: `${JOB_NAMES.INGEST_TRENDING_SIGNALS}__${category}__${computeBucket()}`,
      });
      enqueued++;
    } catch (err) {
      console.warn(
        `[Cron:IngestTrendingSignals] enqueue failed for ${category} —`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  await trendingQueue.close();
  console.log(
    `[Cron:IngestTrendingSignals] Enqueued ${String(enqueued)} of ${String(categories.length)} categories.`
  );
}

/**
 * Load the set of distinct project categories currently in the
 * database. Falls back to a hard-coded default list when the
 * projects table is empty (first deploy, demo environment).
 */
async function loadActiveCategories(): Promise<ProjectCategory[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT repo_analysis ->> 'category' AS category
    FROM projects
    WHERE repo_analysis IS NOT NULL
      AND repo_analysis ->> 'category' IS NOT NULL
  `);

  const categories: ProjectCategory[] = [];
  for (const row of rows.rows) {
    // `db.execute` already types rows as `Record<string, unknown>`
    // for hand-written SQL, so we read with bracket notation to
    // satisfy `noPropertyAccessFromIndexSignature` and then validate
    // the value against the enum schema at the boundary.
    const parsed = ProjectCategorySchema.safeParse(row['category']);
    if (parsed.success) categories.push(parsed.data);
  }

  if (categories.length === 0) {
    return [...DEFAULT_CATEGORIES];
  }
  return categories;
}

/**
 * 10-minute bucket used to deduplicate repeat cron invocations.
 * Exposed as its own function so tests can mock it and so the
 * bucket size is documented at the single call site.
 */
function computeBucket(): number {
  const tenMinMs = 10 * 60 * 1000;
  return Math.floor(Date.now() / tenMinMs);
}
