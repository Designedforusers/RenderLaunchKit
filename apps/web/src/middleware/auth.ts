import type { Context, Next } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Optional API key auth middleware.
 *
 * If the `API_KEY` env var is set, requires `Authorization: Bearer <key>`
 * on every request. If unset, the middleware allows all requests so the
 * demo can run with no key configured.
 *
 * The provided token is compared to the configured key in constant time.
 * Both inputs are first SHA-256 hashed so the lengths are always equal —
 * this avoids leaking the configured key length via the comparison and
 * lets us use `timingSafeEqual` without a length-mismatch branch.
 */
export async function authMiddleware(c: Context, next: Next) {
  const apiKey = process.env.API_KEY;

  // No API key configured — open access (demo default).
  if (!apiKey) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);

  // SHA-256 both sides so the buffers are always 32 bytes.
  // `timingSafeEqual` requires equal-length inputs and runs in constant time.
  const tokenDigest = createHash('sha256').update(token).digest();
  const apiKeyDigest = createHash('sha256').update(apiKey).digest();

  if (!timingSafeEqual(tokenDigest, apiKeyDigest)) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  return next();
}
