import { z } from 'zod';
import type { Context } from 'hono';

const uuidSchema = z.string().uuid();

/**
 * Parse a UUID path parameter, returning the value on success or
 * `null` on failure. Call sites pair this with `invalidUuidResponse`
 * for a consistent 400 shape across every route.
 */
export function parseUuidParam(c: Context, param = 'id'): string | null {
  const value = c.req.param(param);
  if (value === undefined) return null;
  return uuidSchema.safeParse(value).success ? value : null;
}

export function invalidUuidResponse(c: Context) {
  return c.json({ error: 'Invalid UUID format' }, 400);
}
