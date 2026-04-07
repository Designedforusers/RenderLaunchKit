import { useState, useEffect, useCallback } from 'react';

export interface ProjectPipelineEvent {
  type: string;
  phase?: string;
  data: Record<string, any>;
  timestamp: number;
}

export function useProjectEventStream(projectId: string | undefined) {
  const [events, setEvents] = useState<ProjectPipelineEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!projectId) return;

    const source = new EventSource(`/api/projects/${projectId}/events`);

    source.addEventListener('connected', () => {
      setConnected(true);
    });

    source.addEventListener('update', (e) => {
      try {
        const event = JSON.parse(e.data) as ProjectPipelineEvent;
        setEvents((prev) => [...prev, event]);
      } catch {
        // Ignore parse errors
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
