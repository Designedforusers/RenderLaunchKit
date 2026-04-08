import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getRedis } from './trending-signal-types.js';

/**
 * Shared types + Redis cache helpers for the Phase 5 influencer
 * enrichment tools (`enrich-github-user`, `enrich-devto-user`,
 * `enrich-hn-user`, `enrich-x-user`).
 *
 * The Phase 3 trending-signal source tools walk *outward* from a
 * topic/query to a list of posts and authors. The Phase 5 enrichment
 * tools walk *inward* from a known handle back to the profile shape
 * the influencer-discovery agent needs (display name, bio, follower
 * count, and a small bag of source-specific metrics). Same plumbing,
 * inverse direction — so we keep the tool pattern (Zod boundary
 * validation + Redis cache + soft-fail to `null`) but scope the types
 * to the enrichment side.
 *
 * Why a separate source enum
 * --------------------------
 *
 * `TrendSourceSchema` in `@launchkit/shared` enumerates "where the
 * trend came from" (`grok`, `exa`, `hn`, `devto`, `reddit`,
 * `producthunt`, `github`). The enrichment side wants a different
 * alphabet: it resolves *users* on specific identity surfaces, so
 * `github_user`, `devto_user`, `hn_user`, and `x_user` read cleanly
 * and do not collide with the trend-side values when both live in
 * Redis at the same time. Keeping the two enums separate also means
 * a future "enrich a Reddit user" tool can be added without touching
 * the trend-side schema.
 *
 * Why the Redis client is borrowed, not re-instantiated
 * ------------------------------------------------------
 *
 * `trending-signal-types.ts` already owns one lazy ioredis client per
 * worker process. Instantiating a second client here would double the
 * connection count on a free-tier Redis plan for no benefit — the
 * enrichment tools do exactly the same kind of short read/write
 * pattern as the trend tools. We import `getRedis` and reuse the
 * same connection.
 */

// ── Source enum ───────────────────────────────────────────────────

/**
 * Identity surface an enrichment tool resolves against. Intentionally
 * distinct from `TrendSourceSchema` — see the module header for why.
 */
export const EnrichmentSourceSchema = z.enum([
  'github_user',
  'devto_user',
  'hn_user',
  'x_user',
]);
export type EnrichmentSource = z.infer<typeof EnrichmentSourceSchema>;

// ── Normalized profile shape ──────────────────────────────────────

/**
 * Shape every enrichment tool returns on success. The influencer
 * discovery agent consumes `InfluencerProfile` regardless of which
 * upstream produced the row, so ranking and persistence do not need
 * to branch on source.
 *
 * `additionalMetrics` is an open-ended map for per-source numbers
 * that do not map cleanly onto `followers` — GitHub's `public_repos`,
 * dev.to's `post_count`, HN's `karma`, X's `following_count` /
 * `tweet_count` / `listed_count`. Keeping the bag permissive means a
 * new metric does not require schema changes to every consumer.
 */
export const InfluencerProfileSchema = z.object({
  source: EnrichmentSourceSchema,
  /** Canonical handle on the source platform (no leading `@`). */
  handle: z.string().min(1),
  /** Human-friendly display name. `null` when the source omits one. */
  displayName: z.string().nullable(),
  /** Free-text bio / about / summary. `null` when absent. */
  bio: z.string().nullable(),
  /**
   * Follower count on the source platform. `null` for platforms that
   * do not expose one (HN has karma instead — karma is carried in
   * `additionalMetrics` rather than pretended-into `followers`).
   */
  followers: z.number().int().nonnegative().nullable(),
  /**
   * Per-source numeric metrics the ranker may use. Every entry is
   * optional — the ranker does `metrics.karma ?? 0` at call sites.
   */
  additionalMetrics: z.object({
    karma: z.number().int().nonnegative().optional(),
    publicRepos: z.number().int().nonnegative().optional(),
    postCount: z.number().int().nonnegative().optional(),
    followingCount: z.number().int().nonnegative().optional(),
    tweetCount: z.number().int().nonnegative().optional(),
    listedCount: z.number().int().nonnegative().optional(),
    verified: z.boolean().optional(),
  }),
});
export type InfluencerProfile = z.infer<typeof InfluencerProfileSchema>;

// ── Shared Redis cache ────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'enrich:';
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours — user profiles drift slowly.

function cacheKey(source: EnrichmentSource, handle: string): string {
  const hash = createHash('sha1').update(handle).digest('hex').slice(0, 16);
  return `${CACHE_KEY_PREFIX}${source}:${hash}`;
}

/**
 * Read a previously cached enrichment response. Returns `null` on
 * cache miss, cache disabled, or JSON parse failure — callers treat
 * all three the same way.
 */
export async function readEnrichmentCache(
  source: EnrichmentSource,
  handle: string
): Promise<unknown> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(cacheKey(source, handle));
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * Write an enrichment response to the cache. An optional `ttlSeconds`
 * override lets the paid X enrichment tool bump the TTL when the
 * operator has set a longer cadence — every other tool passes the
 * shared 24-hour default. Silently swallows cache failures.
 */
export async function writeEnrichmentCache(
  source: EnrichmentSource,
  handle: string,
  value: unknown,
  ttlSeconds: number = CACHE_TTL_SECONDS
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  if (ttlSeconds <= 0) return;
  try {
    await redis.set(
      cacheKey(source, handle),
      JSON.stringify(value),
      'EX',
      ttlSeconds
    );
  } catch {
    // Cache failures must never fail the request.
  }
}

/**
 * Re-validate a cached JSON blob into a typed `InfluencerProfile`,
 * returning `null` when the cached row does not match the expected
 * source. A stale cache from a previous schema version returns `null`
 * and the caller falls through to a fresh fetch.
 *
 * Every enrichment tool calls this — the validation is shared so a
 * schema change to `InfluencerProfile` does not require editing four
 * files.
 */
export function rehydrateEnrichmentCache(
  cached: unknown,
  expectedSource: EnrichmentSource
): InfluencerProfile | null {
  const parsed = InfluencerProfileSchema.safeParse(cached);
  if (!parsed.success) return null;
  if (parsed.data.source !== expectedSource) return null;
  return parsed.data;
}

