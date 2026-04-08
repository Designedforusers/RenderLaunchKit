import { eq, sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import * as schema from '@launchkit/shared';
import {
  AudienceBreakdownSchema,
  EnrichDevInfluencersJobDataSchema,
  InfluencerPlatformsSchema,
  type AudienceBreakdown,
  type EnrichDevInfluencersJobData,
} from '@launchkit/shared';
import { database as db } from '../lib/database.js';
import { generateVoyageEmbedding } from '../lib/voyage-embeddings.js';
import { enrichGitHubUser } from '../tools/enrich-github-user.js';
import { enrichDevtoUser } from '../tools/enrich-devto-user.js';
import { enrichHnUser } from '../tools/enrich-hn-user.js';
import { enrichXUser } from '../tools/enrich-x-user.js';
import type { InfluencerProfile } from '../tools/influencer-enrichment-types.js';
import { env } from '../env.js';

/**
 * BullMQ processor that refreshes a batch of `dev_influencers` rows.
 *
 * Phase 5 — enqueued by `apps/cron/src/enrich-dev-influencers.ts` on
 * the cron's 6-hour cadence. The cron passes `batchSize` (max rows to
 * touch in one run) and `xEnrichmentIntervalHours` (the operator-set
 * cadence for the paid X API path).
 *
 * Two-cadence enrichment in a single processor:
 *
 *   1. **Per-run keyless enrichment** for the `batchSize` stalest rows.
 *      Calls `enrich-github-user`, `enrich-devto-user`, `enrich-hn-user`
 *      based on which platform handles the influencer has set. Most
 *      seeded entries only have 1-2 platforms — the processor never
 *      assumes a platform exists and skips silently when one is absent.
 *
 *   2. **Weekly X enrichment** (or whatever cadence the operator
 *      configured via `xEnrichmentIntervalHours`) for any influencer
 *      whose `platforms.twitter` is set AND whose `last_x_enriched_at`
 *      is older than the cadence threshold (or NULL). Calls
 *      `enrich-x-user`, which gracefully degrades to `null` when
 *      `X_API_BEARER_TOKEN` is unset on the worker — so the entire
 *      X path can be disabled with one missing env var.
 *
 * After both passes:
 *
 *   - The per-source profiles are folded into one `audience_breakdown`
 *     jsonb cell using the per-platform key conventions documented in
 *     `packages/shared/src/schemas/dev-influencer.ts:41-69`.
 *   - The canonical `audience_size` integer is recomputed as the max
 *     across every available metric (Twitter > GitHub > HN karma >
 *     dev.to post_count proxy). This integer is what the influencer
 *     matcher's `ORDER BY audience_size` queries rank on.
 *   - The `topic_embedding` is recomputed via Voyage from a composed
 *     bio + categories + recent topics text.
 *   - `last_enriched_at` (always) and `last_x_enriched_at` (only if
 *     the X path actually ran) are stamped to `now()`.
 *
 * Per-influencer error isolation: one failed enrichment does NOT kill
 * the batch. The processor logs and continues — same posture as Phase
 * 3's `processIngestTrendingSignals` at line 84-96.
 */
export async function processEnrichDevInfluencers(
  job: Job<unknown>
): Promise<{
  enriched: number;
  xEnriched: number;
  skipped: number;
  embeddingsComputed: number;
}> {
  // Boundary validation — the BullMQ payload is `unknown` because the
  // queue is loosely typed. Same idiom as `processIngestTrendingSignals`
  // at lines 43-50.
  const parsed = EnrichDevInfluencersJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(
      `[enrich-dev-influencers] invalid job payload: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  const data: EnrichDevInfluencersJobData = parsed.data;

  console.log(
    `[enrich-dev-influencers] starting batch (size=${String(data.batchSize)}, xIntervalHours=${String(data.xEnrichmentIntervalHours)})`
  );

  // Read the N stalest rows. `last_enriched_at NULLS FIRST, asc` so
  // freshly-seeded rows enrich first and stale rows refresh next.
  // Drizzle's `findMany` doesn't expose NULLS FIRST directly so we
  // use a raw `sql` order clause.
  const candidates = await db.query.devInfluencers.findMany({
    orderBy: [sql`last_enriched_at ASC NULLS FIRST`],
    limit: data.batchSize,
  });

  if (candidates.length === 0) {
    console.log('[enrich-dev-influencers] no rows to enrich');
    return { enriched: 0, xEnriched: 0, skipped: 0, embeddingsComputed: 0 };
  }

  const xCadenceMs = data.xEnrichmentIntervalHours * 60 * 60 * 1000;
  const xCadenceCutoff = new Date(Date.now() - xCadenceMs);

  let enriched = 0;
  let xEnriched = 0;
  let skipped = 0;
  let embeddingsComputed = 0;

  for (const row of candidates) {
    try {
      const platformsParse = InfluencerPlatformsSchema.safeParse(row.platforms);
      if (!platformsParse.success) {
        console.warn(
          `[enrich-dev-influencers] ${row.handle}: platforms jsonb did not parse — skipping`
        );
        skipped++;
        continue;
      }
      const platforms = platformsParse.data;

      // Run keyless enrichments in parallel — each call resolves to
      // an `InfluencerProfile | null`, so a missing platform handle
      // or a 404 just gives us a `null` to ignore.
      const keylessProfiles = await Promise.all([
        platforms.github !== undefined
          ? enrichGitHubUser({ handle: platforms.github })
          : Promise.resolve(null),
        platforms.devto !== undefined
          ? enrichDevtoUser({ handle: platforms.devto })
          : Promise.resolve(null),
        platforms.hackernews !== undefined
          ? enrichHnUser({ handle: platforms.hackernews })
          : Promise.resolve(null),
      ]);

      // X enrichment runs only when (a) the influencer has a Twitter
      // handle, (b) the row's `last_x_enriched_at` is stale, and (c)
      // the X tool's env gate is open. The tool itself returns `null`
      // when `X_API_BEARER_TOKEN` is unset — so even if we call it
      // unconditionally on a stale row, the no-token case is free.
      let xProfile: InfluencerProfile | null = null;
      const xIsStale =
        row.lastXEnrichedAt === null || row.lastXEnrichedAt < xCadenceCutoff;
      if (platforms.twitter !== undefined && xIsStale) {
        xProfile = await enrichXUser({ handle: platforms.twitter });
        if (xProfile !== null) xEnriched++;
      }

      const profiles = [...keylessProfiles, xProfile].filter(
        (p): p is InfluencerProfile => p !== null
      );

      // Even when every enrichment returned null we still stamp
      // `last_enriched_at` so the row rotates to the back of the
      // queue and the next cron run picks fresher candidates.
      const breakdown = composeAudienceBreakdown(profiles);
      const audienceSize = computeAudienceSize(breakdown);
      const recentTopics = composeRecentTopics(profiles, row.recentTopics);
      const bio = pickBestBio(profiles, row.bio);

      // Compute the new topic embedding — soft-fails to the existing
      // value when Voyage isn't configured, so the row still gets its
      // bio + breakdown refresh on a Voyage-disabled deploy.
      const newEmbedding = await embedInfluencerText({
        bio,
        recentTopics,
        categories: row.categories,
      });
      if (newEmbedding !== null) embeddingsComputed++;

      await persistEnrichment({
        id: row.id,
        bio,
        recentTopics,
        audienceSize,
        breakdown,
        newEmbedding,
        // Only stamp `last_x_enriched_at` when we actually called the
        // X tool with a non-null result. A null result (env unset OR
        // 404 OR rate-limited) leaves `last_x_enriched_at` unchanged
        // so the next cron run retries.
        stampXEnrichedAt: xProfile !== null,
      });
      enriched++;
    } catch (err) {
      console.warn(
        `[enrich-dev-influencers] ${row.handle} — enrichment failed:`,
        err instanceof Error ? err.message : String(err)
      );
      skipped++;
    }
  }

  console.log(
    `[enrich-dev-influencers] done — enriched=${String(enriched)}, xEnriched=${String(xEnriched)}, skipped=${String(skipped)}, embeddings=${String(embeddingsComputed)}`
  );
  return { enriched, xEnriched, skipped, embeddingsComputed };
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Fold per-source `InfluencerProfile` results into the multi-source
 * `audience_breakdown` jsonb shape. The platform key conventions live
 * in `packages/shared/src/schemas/dev-influencer.ts:41-69` —
 * `hackernews` is the platforms-handle key but `hn` is the breakdown
 * key, etc. We map between them explicitly here so a future schema
 * change is one place to update.
 */
function composeAudienceBreakdown(
  profiles: InfluencerProfile[]
): AudienceBreakdown {
  const breakdown: AudienceBreakdown = {};
  for (const profile of profiles) {
    if (profile.source === 'github_user') {
      breakdown.github = {
        followers: profile.followers ?? 0,
        ...(profile.additionalMetrics.publicRepos !== undefined
          ? { publicRepos: profile.additionalMetrics.publicRepos }
          : {}),
      };
    } else if (profile.source === 'devto_user') {
      breakdown.devto = {
        postCount: profile.additionalMetrics.postCount ?? 0,
      };
    } else if (profile.source === 'hn_user') {
      breakdown.hn = {
        karma: profile.additionalMetrics.karma ?? 0,
      };
    } else if (profile.source === 'x_user') {
      breakdown.twitter = {
        followers: profile.followers ?? 0,
        ...(profile.additionalMetrics.followingCount !== undefined
          ? { following: profile.additionalMetrics.followingCount }
          : {}),
        ...(profile.additionalMetrics.tweetCount !== undefined
          ? { tweetCount: profile.additionalMetrics.tweetCount }
          : {}),
        ...(profile.additionalMetrics.verified !== undefined
          ? { verified: profile.additionalMetrics.verified }
          : {}),
      };
    }
  }
  // Validate the composed shape against the canonical schema before
  // persisting — catches any drift between this helper and the schema
  // definition at construction time, not at read time.
  return AudienceBreakdownSchema.parse(breakdown);
}

/**
 * Compute the canonical `audience_size` integer as the max across
 * every available platform metric. Twitter wins when present (it's
 * the most-recognized dev audience number); GitHub followers, HN
 * karma, and a dev.to post-count × 100 proxy follow.
 *
 * The dev.to proxy is rough — there's no public dev.to follower
 * endpoint, so we use post count as a "this person actively writes
 * about technical stuff" proxy with the historical ~100 followers
 * per post conversion.
 */
function computeAudienceSize(breakdown: AudienceBreakdown): number {
  const candidates = [
    breakdown.twitter?.followers ?? 0,
    breakdown.github?.followers ?? 0,
    breakdown.hn?.karma ?? 0,
    (breakdown.devto?.postCount ?? 0) * 100,
  ];
  return Math.max(0, ...candidates);
}

/**
 * Compose the `recent_topics` jsonb. Phase 5 doesn't have a topic
 * harvester per se — we keep the existing value when present, otherwise
 * derive a placeholder set from the bios + categories so the embedding
 * has something to work with on the first cron run.
 *
 * Phase 6+ will add a real topic-extraction step (likely sourcing from
 * the X tweets endpoint when X is enabled).
 */
function composeRecentTopics(
  profiles: InfluencerProfile[],
  existing: unknown
): string[] {
  if (Array.isArray(existing) && existing.every((t) => typeof t === 'string')) {
    return existing;
  }
  // Derive a tiny placeholder set from the available bio text. The
  // matcher's embedding query benefits more from a non-empty topics
  // array than from leaving the column null on a fresh row.
  const topics: string[] = [];
  for (const profile of profiles) {
    if (profile.bio !== null && profile.bio.length > 0) {
      // Extract a few comma-separated keyword candidates from the bio.
      // Cheap and good enough for an initial Voyage embedding.
      const keywords = profile.bio
        .split(/[,.;|]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 3 && s.length < 60);
      topics.push(...keywords.slice(0, 3));
    }
  }
  return topics.slice(0, 8);
}

/**
 * Pick the strongest bio across the per-source profiles. Twitter and
 * dev.to bios are usually the most marketing-friendly; GitHub bios are
 * usually the most technical; HN about-text is usually the longest.
 * Pick the longest non-empty string and fall back to the existing row
 * value when nothing was enriched.
 */
function pickBestBio(
  profiles: InfluencerProfile[],
  existing: string | null
): string | null {
  let best = existing;
  for (const profile of profiles) {
    if (profile.bio !== null && profile.bio.length > 0) {
      if (best === null || profile.bio.length > best.length) {
        best = profile.bio;
      }
    }
  }
  return best;
}

async function embedInfluencerText(input: {
  bio: string | null;
  recentTopics: string[];
  categories: string[];
}): Promise<number[] | null> {
  if (!env.VOYAGE_API_KEY) return null;
  const text = `${input.bio ?? ''}\n\nTopics: ${input.recentTopics.join(', ')}\nCategories: ${input.categories.join(', ')}`.trim();
  if (text.length === 0) return null;
  try {
    return await generateVoyageEmbedding(text, { inputType: 'document' });
  } catch (err) {
    console.warn(
      '[enrich-dev-influencers] Voyage embed failed —',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * Persist a single influencer's refreshed enrichment. Embedding write
 * uses raw SQL because Drizzle's typed query builder does not know how
 * to serialize a `number[]` into a pgvector literal — same approach as
 * `storeProjectEmbedding` in `apps/worker/src/tools/project-insight-memory.ts:109-136`.
 *
 * The non-vector columns go through the typed Drizzle update so the
 * compile-time column types catch typos. Two updates in sequence is
 * cheaper than constructing a single hand-written upsert and easier
 * to read.
 */
async function persistEnrichment(input: {
  id: string;
  bio: string | null;
  recentTopics: string[];
  audienceSize: number;
  breakdown: AudienceBreakdown;
  newEmbedding: number[] | null;
  stampXEnrichedAt: boolean;
}): Promise<void> {
  const now = new Date();

  await db
    .update(schema.devInfluencers)
    .set({
      bio: input.bio,
      recentTopics: input.recentTopics,
      audienceSize: input.audienceSize,
      audienceBreakdown: input.breakdown,
      lastEnrichedAt: now,
      ...(input.stampXEnrichedAt ? { lastXEnrichedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(schema.devInfluencers.id, input.id));

  if (input.newEmbedding !== null) {
    const vectorStr = `[${input.newEmbedding.join(',')}]`;
    await db.execute(sql`
      UPDATE dev_influencers
      SET topic_embedding = ${vectorStr}::vector
      WHERE id = ${input.id}
    `);
  }
}

