import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createRedisSubscriberClient } from '../lib/redis-client.js';
import { REDIS_CHANNELS } from '@launchkit/shared';
import { parseUuidParam, invalidUuidResponse } from '../lib/validate-uuid.js';

const projectEventStreamRoutes = new Hono();

// ── GET /api/projects/:id/events — SSE endpoint for real-time updates ──

projectEventStreamRoutes.get('/:id/events', (c) => {
  const projectId = parseUuidParam(c);
  if (!projectId) return invalidUuidResponse(c);
  const channel = REDIS_CHANNELS.PROJECT_EVENTS(projectId);

  return streamSSE(c, async (stream) => {
    const subscriber = createRedisSubscriberClient();
    let alive = true;

    // Send initial connection event
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ projectId, timestamp: Date.now() }),
    });

    // Set up heartbeat to keep connection alive. The interval
    // callback is sync; it kicks off the writeSSE and intentionally
    // discards the resulting promise via `void` so a slow client
    // can't accumulate unhandled rejections.
    const heartbeat = setInterval(() => {
      if (!alive) return;
      void stream
        .writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({ timestamp: Date.now() }),
        })
        .catch(() => {
          alive = false;
        });
    }, 15_000);

    // Subscribe to project events. ioredis `subscribe` returns a
    // promise we need to await to guarantee the subscription is
    // active before the first publish lands.
    await subscriber.subscribe(channel);

    // Hold a reference to the message handler so we can remove it
    // on abort. ioredis emits to every attached `message` listener,
    // so leaving a handler attached on a torn-down `stream` would
    // either fire writes against a dead connection or — worse —
    // accumulate one stale listener per reconnect on a long-lived
    // process.
    const messageHandler = (_ch: string, message: string) => {
      if (!alive) return;
      void stream
        .writeSSE({
          event: 'update',
          data: message,
        })
        .catch(() => {
          alive = false;
        });
    };
    subscriber.on('message', messageHandler);

    // Wait for the stream to close (client disconnect). The
    // unsubscribe call returns a promise; we discard it via `void`
    // because the disconnect that follows tears the connection
    // down regardless of whether the unsubscribe ack lands first.
    stream.onAbort(() => {
      alive = false;
      clearInterval(heartbeat);
      subscriber.removeListener('message', messageHandler);
      void subscriber.unsubscribe(channel);
      subscriber.disconnect();
    });

    // Keep stream open until aborted
    while (alive) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });
});

export default projectEventStreamRoutes;
