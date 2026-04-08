import { sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import {
  IngestTrendingSignalsJobDataSchema,
  type IngestTrendingSignalsJobData,
  type TrendSource,
} from '@launchkit/shared';
import {
  runTrendingSignalsAgent,
  type TrendingSignalCluster,
} from '../agents/trending-signals-agent.js';
import { database as db } from '../lib/database.js';
import { generateVoyageEmbedding } from '../lib/voyage-embeddings.js';
import { env } from '../env.js';

/**
 * BullMQ processor that runs the trending-signals agent for a single
 * project category and persists the resulting clusters into the
 * `trend_signals` table.
 *
 * Enqueued by `apps/cron/src/ingest-trending-signals.ts` on the
 * 6-hour cron cadence — one job per distinct category in the active
 * project set. The cron does not wait for completion; each job is
 * fire-and-forget on the BullMQ side so a slow upstream on one
 * category does not block the others.
 *
 * Failure tolerance
 * -----------------
 *
 * Each cluster is embedded + inserted independently — a Voyage
 * outage on one cluster does not lose the entire batch, it just
 * inserts the offending row with `embedding IS NULL` so the
 * pgvector matcher falls back to category-only filtering until the
 * embedding is backfilled on the next ingest cycle.
 */
export async function processIngestTrendingSignals(
  job: Job<unknown>
): Promise<{ inserted: number; skipped: number; category: string }> {
  // Every processor validates its own `job.data` at the boundary —
  // the BullMQ payload is `unknown` because the queue is loosely
  // typed, and we would rather fail fast with a structured error
  // than propagate a malformed payload into the agent loop.
  const parsed = IngestTrendingSignalsJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(
      `[ingest-trending-signals] invalid job payload: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  const data: IngestTrendingSignalsJobData = parsed.data;

  console.log(
    `[ingest-trending-signals] running for category "${data.category}"`
  );

  if (!env.ANTHROPIC_API_KEY) {
    console.warn(
      '[ingest-trending-signals] ANTHROPIC_API_KEY not set — skipping agent run'
    );
    return { inserted: 0, skipped: 0, category: data.category };
  }

  const clusters = await runTrendingSignalsAgent({
    category: data.category,
    ...(data.seedKeywords !== undefined
      ? { seedKeywords: data.seedKeywords }
      : {}),
  });

  if (clusters.length === 0) {
    console.log(
      `[ingest-trending-signals] ${data.category}: agent returned 0 clusters`
    );
    return { inserted: 0, skipped: 0, category: data.category };
  }

  const expiresAt =
    data.expiresAt ??
    new Date(Date.now() + env.TRENDING_SIGNAL_TTL_HOURS * 60 * 60 * 1000);

  let inserted = 0;
  let skipped = 0;
  for (const cluster of clusters) {
    try {
      const embedding = await embedClusterText(cluster);
      await insertTrendRow(data.category, cluster, embedding, expiresAt);
      inserted++;
    } catch (err) {
      console.warn(
        '[ingest-trending-signals] cluster insert failed —',
        err instanceof Error ? err.message : String(err)
      );
      skipped++;
    }
  }

  console.log(
    `[ingest-trending-signals] ${data.category}: ${String(inserted)} inserted, ${String(skipped)} skipped`
  );
  return { inserted, skipped, category: data.category };
}

async function embedClusterText(
  cluster: TrendingSignalCluster
): Promise<number[] | null> {
  if (!env.VOYAGE_API_KEY) return null;
  const text = `${cluster.topic}. ${cluster.headline}`;
  try {
    return await generateVoyageEmbedding(text, { inputType: 'document' });
  } catch (err) {
    console.warn(
      '[ingest-trending-signals] embedding failed —',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// Hand-written SQL insert because Drizzle's typed query builder does
// not know how to serialize a `number[]` into a pgvector literal.
// Every column — including the vector — is bound as a prepared
// parameter: `sql\`${x}::vector\`` passes `x` as a `$n` placeholder
// and concatenates `::vector` in the SQL text, so the value never
// becomes raw SQL. Same pattern as the existing pgvector call in
// `apps/worker/src/tools/project-insight-memory.ts`. The vector
// string is safe to construct from `embedding.join(',')` because
// `embedding` is typed `number[]` — every element is a finite
// number and JavaScript's `.toString()` for finite numbers never
// produces characters that are meaningful to Postgres.
async function insertTrendRow(
  category: string,
  cluster: TrendingSignalCluster,
  embedding: number[] | null,
  expiresAt: Date
): Promise<void> {
  const source: TrendSource = cluster.source;
  const rawPayload = {
    clusterVelocityScore: cluster.velocityScore,
    rawSignals: cluster.rawSignals,
  };
  const vectorLiteral =
    embedding !== null
      ? sql`${`[${embedding.join(',')}]`}::vector`
      : sql`NULL`;

  await db.execute(sql`
    INSERT INTO trend_signals (
      source,
      topic,
      headline,
      url,
      raw_payload,
      velocity_score,
      embedding,
      category,
      expires_at
    ) VALUES (
      ${source},
      ${cluster.topic},
      ${cluster.headline},
      ${cluster.url},
      ${JSON.stringify(rawPayload)}::jsonb,
      ${cluster.velocityScore},
      ${vectorLiteral},
      ${category},
      ${expiresAt}
    )
  `);
}
