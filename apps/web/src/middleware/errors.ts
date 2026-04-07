import type { Context, Next } from 'hono';

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[Error]', error.message, error.stack);

    const status = 'status' in error ? (error as any).status : 500;
    return c.json(
      {
        error: error.message || 'Internal server error',
        ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
      },
      status
    );
  }
}
