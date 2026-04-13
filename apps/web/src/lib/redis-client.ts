import Redis from 'ioredis';
import { env } from '../env.js';

const REDIS_URL = env.REDIS_URL;

function createRedisClient(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });
}

let redisClient: Redis | null = null;

// Main Redis client for general operations. Construct lazily so tests
// that only import route modules do not open a reconnect loop just by
// touching the module graph.
export function getRedisClient(): Redis {
  if (redisClient) return redisClient;
  redisClient = createRedisClient();

  redisClient.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  redisClient.on('connect', () => {
    console.info('[Redis] Connected');
  });

  return redisClient;
}

// Factory for creating subscriber connections (SSE needs its own connection)
export function createRedisSubscriberClient(): Redis {
  return createRedisClient();
}

export async function closeRedisClient(): Promise<void> {
  if (!redisClient) return;
  const client = redisClient;
  redisClient = null;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
