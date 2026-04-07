import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Narrow an unknown thrown value to a numeric HTTP status code.
 *
 * Replaces the previous `(error as any).status` cast. The new shape
 * is type-safe: it inspects the value structurally and falls back to
 * 500 if there's no usable status. This prevents the linter and
 * future strict-mode flags from complaining and, more importantly,
 * documents at the type level that the `status` field is optional.
 */
function getErrorStatus(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return 500;
}

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[Error]', error.message, error.stack);

    const status = getErrorStatus(err);
    return c.json(
      {
        error: error.message || 'Internal server error',
        ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
      },
      status as ContentfulStatusCode
    );
  }
}
