import Redis from 'ioredis';
import { REDIS_CHANNELS } from '@launchkit/shared';
import type { ProgressEvent } from '@launchkit/shared';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

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
    data: event.data || {},
    timestamp: Date.now(),
  };

  await redis.publish(channel, JSON.stringify(payload));
}

/**
 * Convenience helpers for common events.
 */
export const projectProgressPublisher = {
  phaseStart(projectId: string, phase: string, detail?: string) {
    return publishProjectProgressEvent(projectId, {
      type: 'phase_start',
      phase,
      data: { detail: detail || `Starting ${phase}` },
    });
  },

  phaseComplete(projectId: string, phase: string, detail?: string) {
    return publishProjectProgressEvent(projectId, {
      type: 'phase_complete',
      phase,
      data: { detail: detail || `Completed ${phase}` },
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

  error(projectId: string, phase: string, message: string) {
    return publishProjectProgressEvent(projectId, {
      type: 'error',
      phase,
      data: { message },
    });
  },
};
