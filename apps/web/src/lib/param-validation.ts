import { z } from 'zod';
import type { Context } from 'hono';

const uuidSchema = z.string().uuid();

/**
 * Parse a route param as a UUID. Returns the validated string on
 * success, or a 400 JSON Response on failure. Callers check with
 * `if (typeof result !== 'string') return result;`.
 */
export function parseUuidParam(
  c: Context,
  paramName: string
): string | Response {
  const raw = c.req.param(paramName);
  const result = uuidSchema.safeParse(raw);
  if (!result.success) {
    return c.json({ error: `${paramName} must be a valid UUID` }, 400);
  }
  return result.data;
}
