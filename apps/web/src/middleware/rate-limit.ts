import type { Store } from 'hono-rate-limiter';
import { rateLimiter } from 'hono-rate-limiter';
import type { Context } from 'hono';
import { redisClient } from '../lib/redis-client.js';

/**
 * Rate-limit middleware for the public API.
 *
 * Backed by the same Redis instance the rest of the app uses, so the
 * counters are shared across every web replica behind Render's load
 * balancer. Without a shared store, each replica would track its own
 * counts and an attacker could effectively get N × the limit by
 * round-robining across replicas.
 *
 * Two presets:
 *
 *   - `apiRateLimit` — 100 requests/minute per IP. Mounted globally on
 *     `/api/*`. Catches generic API abuse.
 *
 *   - `expensiveRouteRateLimit` — 10 requests/minute per IP. Mounted
 *     specifically on routes that trigger Anthropic, fal.ai, or other
 *     paid downstream services. The cost-exhaustion vector matters more
 *     than the request-volume vector here.
 *
 * Both presets key on the caller's IP, derived from `x-forwarded-for`
 * (Render terminates TLS at the edge and sets this header) with a
 * fall-back to `cf-connecting-ip`.
 */

function getClientKey(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; the first entry is
    // the original client. Render's edge always sets this.
    const first = forwarded.split(',')[0];
    if (first) return first.trim();
  }
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

/**
 * Minimal Redis-backed Store for `hono-rate-limiter`.
 *
 * Implemented inline because the upstream `@hono-rate-limiter/redis`
 * adapter is pinned to an older `hono-rate-limiter` major and would force
 * us off the current line. The interface is small enough that maintaining
 * a 25-line implementation in-tree is the right trade.
 *
 * Per-key state lives at `<prefix><key>` and uses `INCR` + `EXPIRE` on
 * first write. The `EXPIRE` is set with the `NX` flag so it is only
 * applied when the key is newly created — subsequent INCRs within the
 * window do not extend the expiry, which is what we want for fixed-window
 * rate limiting.
 */
function createRedisStore(prefix: string, windowMs: number): Store {
  const ttlSeconds = Math.ceil(windowMs / 1000);

  return {
    async increment(key) {
      const redisKey = `${prefix}${key}`;
      const totalHits = await redisClient.incr(redisKey);
      if (totalHits === 1) {
        await redisClient.expire(redisKey, ttlSeconds, 'NX');
      }
      const ttl = await redisClient.pttl(redisKey);
      const resetTime =
        ttl > 0 ? new Date(Date.now() + ttl) : new Date(Date.now() + windowMs);
      return { totalHits, resetTime };
    },
    async decrement(key) {
      const redisKey = `${prefix}${key}`;
      await redisClient.decr(redisKey);
    },
    async resetKey(key) {
      const redisKey = `${prefix}${key}`;
      await redisClient.del(redisKey);
    },
  };
}

const API_WINDOW_MS = 60 * 1000;
const EXPENSIVE_WINDOW_MS = 60 * 1000;

export const apiRateLimit = rateLimiter({
  windowMs: API_WINDOW_MS,
  limit: 100,
  standardHeaders: 'draft-7',
  keyGenerator: getClientKey,
  store: createRedisStore('ratelimit:api:', API_WINDOW_MS),
  message: { error: 'Too many requests. Please slow down.' },
});

export const expensiveRouteRateLimit = rateLimiter({
  windowMs: EXPENSIVE_WINDOW_MS,
  limit: 10,
  standardHeaders: 'draft-7',
  keyGenerator: getClientKey,
  store: createRedisStore('ratelimit:expensive:', EXPENSIVE_WINDOW_MS),
  message: {
    error:
      'Too many expensive operations. This route triggers paid downstream services and is rate-limited more strictly.',
  },
});
