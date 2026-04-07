import type { Context, Next } from 'hono';

/**
 * Optional API key auth middleware.
 * If API_KEY env var is set, requires Authorization: Bearer <key> header.
 * If not set, allows all requests (open access for demo purposes).
 */
export async function authMiddleware(c: Context, next: Next) {
  const apiKey = process.env.API_KEY;

  // No API key configured — open access
  if (!apiKey) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  if (token !== apiKey) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  return next();
}
