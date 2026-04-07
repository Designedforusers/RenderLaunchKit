import Redis from 'ioredis';
import { REDIS_CHANNELS } from '@launchkit/shared';
import type { ProgressEvent } from '@launchkit/shared';
import { env } from '../env.js';

/**
 * Lazy Redis client. Held in a module-level slot but only constructed
 * the first time `publishProjectProgressEvent` is called. The lazy
 * pattern matters for two reasons:
 *
 *   1. Importing this module in a test runner that does not have Redis
 *      available no longer hangs the process on a reconnect loop.
 *
 *   2. The worker can import its agent and processor modules at startup
 *      before Redis is reachable (Render brings services up in
 *      parallel) without hitting noisy `ECONNREFUSED` errors. The first
 *      `publish` call is what wires the connection.
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
 * Convenience helpers for common events.
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

  toolCall(projectId: string, phase: string, toolName: string, input: Record<string, unknown>) {
    return publishProjectProgressEvent(projectId, {
      type: 'tool_call',
      phase,
      data: { toolName, input },
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

  /**
   * Publish a model-narration event from the agent SDK runner.
   *
   * Distinct from `statusUpdate` because narration is the *primary*
   * field (the model is telling the user what it is doing right now)
   * while the phase is metadata. Burying narration text in
   * `statusUpdate.detail` would silently make it the secondary field
   * and require the dashboard to know which event variant to render.
   *
   * The dashboard's chat UI subscribes to `status_update` events and
   * checks for the `narration` data field to render an inline
   * "agent is..." line under the user's last message.
   */
  narration(projectId: string, phase: string, text: string) {
    return publishProjectProgressEvent(projectId, {
      type: 'status_update',
      phase,
      data: { narration: text },
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
