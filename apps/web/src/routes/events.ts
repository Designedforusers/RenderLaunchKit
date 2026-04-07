import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createSubscriber } from '../lib/redis.js';
import { REDIS_CHANNELS } from '@launchkit/shared';

const app = new Hono();

// ── GET /api/projects/:id/events — SSE endpoint for real-time updates ──

app.get('/:id/events', async (c) => {
  const projectId = c.req.param('id');
  const channel = REDIS_CHANNELS.PROJECT_EVENTS(projectId);

  return streamSSE(c, async (stream) => {
    const subscriber = createSubscriber();
    let alive = true;

    // Send initial connection event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ projectId, timestamp: Date.now() }),
    });

    // Set up heartbeat to keep connection alive
    const heartbeat = setInterval(async () => {
      if (!alive) return;
      try {
        await stream.writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({ timestamp: Date.now() }),
        });
      } catch {
        alive = false;
      }
    }, 15_000);

    // Subscribe to project events
    subscriber.subscribe(channel);

    subscriber.on('message', async (_ch: string, message: string) => {
      if (!alive) return;
      try {
        await stream.writeSSE({
          event: 'update',
          data: message,
        });
      } catch {
        alive = false;
      }
    });

    // Wait for the stream to close (client disconnect)
    stream.onAbort(() => {
      alive = false;
      clearInterval(heartbeat);
      subscriber.unsubscribe(channel);
      subscriber.disconnect();
    });

    // Keep stream open until aborted
    while (alive) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });
});

export default app;
