import { useState, useEffect, useCallback } from 'react';
import { ProgressEventSchema, type ProgressEvent } from '@launchkit/shared';

/**
 * Subscribe to the SSE event stream for a single project.
 *
 * Parses every incoming event through `ProgressEventSchema` so the
 * dashboard never holds an `unknown`-shaped event in state. Malformed
 * events (the server is on a newer schema, the JSON is corrupted) are
 * dropped silently — the chat UI does not need to surface a parse
 * error to the user, but a future enhancement could add a `lastError`
 * piece of state for debugging.
 */
export function useProjectEventStream(projectId: string | undefined) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!projectId) return;

    const source = new EventSource(`/api/projects/${projectId}/events`);

    source.addEventListener('connected', () => {
      setConnected(true);
    });

    source.addEventListener('update', (e) => {
      // `MessageEvent.data` is typed as `any` by the DOM lib (it can
      // be a string for SSE, or an arbitrary structured-clone payload
      // for postMessage). We narrow before parsing.
      const messageEvent = e as MessageEvent<unknown>;
      const data = messageEvent.data;
      if (typeof data !== 'string') {
        return;
      }
      try {
        const raw: unknown = JSON.parse(data);
        const parsed = ProgressEventSchema.safeParse(raw);
        if (parsed.success) {
          setEvents((prev) => [...prev, parsed.data]);
        }
      } catch {
        // Ignore parse errors — the next valid event will succeed.
      }
    });

    source.addEventListener('heartbeat', () => {
      // Connection still alive
    });

    source.onerror = () => {
      setConnected(false);
    };

    return () => {
      source.close();
      setConnected(false);
    };
  }, [projectId]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return { events, connected, clearEvents };
}
