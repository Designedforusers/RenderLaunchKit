import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { z } from 'zod';
import { TrendSourceSchema, type TrendSource } from '@launchkit/shared';
import { env } from '../env.js';

/**
 * Shared types + Redis cache helpers for the Phase 3 trending-signal
 * source tools (`grok-x-search`, `search-hn-algolia`, `search-devto`,
 * `search-reddit`, `search-producthunt`, `search-github-influencers`).
 *
 * Why a shared module
 * -------------------
 *
 * Every source tool returns the same `SignalItem[]` shape, caches its
 * upstream responses in Redis with the same TTL, and has the same
 * "soft fail" contract (one bad source does not break the whole agent
 * turn — we log and return `[]`). Extracting the common pieces keeps
 * each tool file short and focused on "call this API, map to
 * `SignalItem`" rather than re-deriving the cache plumbing six times.
 *
 * Why the Redis client is lazy
 * ----------------------------
 *
 * The worker already instantiates one `ioredis` client in
 * `github-repository-tools.ts` at module load. Adding another top-level
 * client here would double the connection count for a backend service
 * that cares about free-tier Redis slots. Instead we expose a lazy
 * getter that returns the first client construction and reuses it for
 * every subsequent call. The client is null when `REDIS_URL` is unset
 * (test environments); callers treat a null cache as "always miss".
 */

/**
 * Normalized shape every trending-signal source tool returns. The
 * agent consumes `SignalItem[]` regardless of which upstream produced
 * the row, so clustering and persistence do not need to branch on
 * source.
 *
 * Derived via `z.infer` from `SignalItemSchema` below so the runtime
 * validator and the TypeScript type can never silently disagree.
 */
export const SignalItemSchema = z.object({
  source: TrendSourceSchema,
  /**
   * Short topic keyword or tag the signal belongs to. Sources that
   * return posts without an intrinsic topic (HN, Reddit) fall back to
   * the query string the caller passed in.
   */
  topic: z.string().min(1),
  /** Post title or content excerpt. */
  headline: z.string().min(1),
  url: z.string().nullable(),
  author: z.string().nullable(),
  // Open-ended engagement map — every source uses a different set of
  // metrics (X: likes/reposts/replies, HN: points/comments, dev.to:
  // reactions/comments/views, Reddit: upvotes/comments, GitHub:
  // stars-as-upvotes + forks-as-reactions + open-issues-as-comments).
  // Keeping the union permissive means a new source's metric does not
  // require schema changes to every consumer, and cache round-trips
  // preserve the raw numbers for later UI rendering.
  engagement: z.object({
    upvotes: z.number().optional(),
    comments: z.number().optional(),
    points: z.number().optional(),
    likes: z.number().optional(),
    reactions: z.number().optional(),
    followers: z.number().optional(),
    views: z.number().optional(),
    reposts: z.number().optional(),
    replies: z.number().optional(),
  }),
  publishedAt: z.string().nullable(),
  /**
   * Raw upstream row. Persisted verbatim into `trend_signals.raw_payload`
   * so the dashboard can show source-specific UI and downstream agents
   * can re-derive context without a re-fetch. Kept as `unknown` because
   * the shape is source-specific.
   */
  rawPayload: z.unknown(),
});
export type SignalItem = z.infer<typeof SignalItemSchema>;

// ── Shared Redis cache ────────────────────────────────────────────

let cachedRedis: Redis | null | undefined;

/**
 * Shared accessor for the lazily-constructed ioredis client. Exported
 * so neighboring tool modules can reuse the same connection instead
 * of instantiating a second one — see the "Why the Redis client is
 * lazy" note above for why we keep the connection count pinned to
 * one per worker process.
 */
export function getRedis(): Redis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  if (!env.REDIS_URL) {
    cachedRedis = null;
    return null;
  }
  cachedRedis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // The trending-signal tools are called on a cron cadence rather
    // than on the critical path of a user request; lazy-connecting
    // here is fine.
    lazyConnect: false,
  });
  return cachedRedis;
}

const CACHE_KEY_PREFIX = 'trending:';

function cacheKey(source: TrendSource, queryFingerprint: string): string {
  const hash = createHash('sha256')
    .update(queryFingerprint)
    .digest('hex')
    .slice(0, 16);
  return `${CACHE_KEY_PREFIX}${source}:${hash}`;
}

/**
 * Read a previously cached response. Returns `null` on cache miss,
 * cache disabled, or JSON parse failure — callers treat all three
 * the same way.
 */
export async function readSignalCache(
  source: TrendSource,
  queryFingerprint: string
): Promise<unknown> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(cacheKey(source, queryFingerprint));
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * Write a response to the cache with the shared TTL. Silently
 * swallows cache failures — a broken cache must never fail the
 * request on the critical path.
 */
export async function writeSignalCache(
  source: TrendSource,
  queryFingerprint: string,
  value: unknown
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const ttlSeconds = env.TRENDING_SIGNAL_CACHE_TTL_SECONDS;
  if (ttlSeconds <= 0) return;
  try {
    await redis.set(
      cacheKey(source, queryFingerprint),
      JSON.stringify(value),
      'EX',
      ttlSeconds
    );
  } catch {
    // Cache failures must never fail the request.
  }
}

/**
 * Re-validate a cached JSON blob into a typed `SignalItem[]`, filtering
 * out rows whose `source` does not match the expected upstream. A
 * stale cache from a previous schema version returns `[]` and the
 * caller falls through to a fresh fetch.
 *
 * Every source tool calls this — the validation is shared so a schema
 * change to `SignalItem` does not require editing six files.
 */
export function rehydrateSignalCache(
  cached: unknown,
  expectedSource: TrendSource
): SignalItem[] {
  const arr = z.array(z.unknown()).safeParse(cached);
  if (!arr.success) return [];
  const out: SignalItem[] = [];
  for (const row of arr.data) {
    const parsed = SignalItemSchema.safeParse(row);
    if (parsed.success && parsed.data.source === expectedSource) {
      out.push(parsed.data);
    }
  }
  return out;
}
