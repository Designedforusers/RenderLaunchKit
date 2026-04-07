import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Main Redis client for general operations
export const redisClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

// Factory for creating subscriber connections (SSE needs its own connection)
export function createRedisSubscriberClient(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });
}

redisClient.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

redisClient.on('connect', () => {
  console.log('[Redis] Connected');
});
