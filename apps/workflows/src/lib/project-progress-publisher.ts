import Redis from 'ioredis';
import { REDIS_CHANNELS } from '@launchkit/shared';
import type { ProgressEvent } from '@launchkit/shared';
import { env } from '../env.js';

/**
 * Lazy Redis publisher for progress events emitted by workflow task
 * runs. Parallel to `apps/worker/src/lib/project-progress-publisher.ts`
 * — same event schema (so the web service's SSE subscription does not
 * need to know which publisher emitted each event) and same lazy
 * construction pattern (the Redis connection is only opened on the
 * first publish, not at module load).
 *
 * Each task run spins up on its own Render instance and therefore
 * creates its own Redis publisher. That's fine — Redis pub/sub
 * tolerates many publishers natively, and the connection is
 * deprovisioned along with the instance when the run completes.
 */
let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  redisClient ??= new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return redisClient;
}

/**
 * Publish a progress event for a project via Redis pub/sub.
 * The web service SSE endpoint picks this up and forwards to the client.
 */
export async function publishProjectProgressEvent(
  projectId: string,
  event: Partial<ProgressEvent> & { type: ProgressEvent['type'] }
): Promise<void> {
  const channel = REDIS_CHANNELS.PROJECT_EVENTS(projectId);
  const payload: ProgressEvent = {
    type: event.type,
    phase: event.phase,
    data: event.data ?? {},
    timestamp: Date.now(),
  };

  await getRedisClient().publish(channel, JSON.stringify(payload));
}

/**
 * Convenience helpers for common events. Event shape matches the
 * worker's publisher exactly — the two publishers are
 * interchangeable from the web service's perspective.
 */
export const projectProgressPublisher = {
  phaseStart(projectId: string, phase: string, detail?: string) {
    return publishProjectProgressEvent(projectId, {
      type: 'phase_start',
      phase,
      data: { detail: detail ?? `Starting ${phase}` },
    });
  },

  phaseComplete(projectId: string, phase: string, detail?: string) {
    return publishProjectProgressEvent(projectId, {
      type: 'phase_complete',
      phase,
      data: { detail: detail ?? `Completed ${phase}` },
    });
  },

  assetReady(projectId: string, assetId: string, assetType: string) {
    return publishProjectProgressEvent(projectId, {
      type: 'asset_ready',
      data: { assetId, assetType },
    });
  },

  statusUpdate(projectId: string, status: string, detail?: string) {
    return publishProjectProgressEvent(projectId, {
      type: 'status_update',
      data: { status, detail },
    });
  },

  error(projectId: string, phase: string, message: string) {
    return publishProjectProgressEvent(projectId, {
      type: 'error',
      phase,
      data: { message },
    });
  },
};
