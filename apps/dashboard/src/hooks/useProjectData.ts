import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import type { ProjectDetail, ProjectSummary } from '../lib/api.js';

export function useProjectListData() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.listProjects();
      setProjects(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { projects, loading, error, refresh };
}

export function useProjectDetailData(id: string | undefined) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await api.getProject(id);
      setProject(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Mirror the latest project into a ref so the polling interval
  // below can read the current status without re-firing the effect
  // on every payload change. Without this, either:
  //   (a) we add `project` to the dep array and the interval is
  //       torn down/recreated on every poll, racing the next tick;
  //   (b) we omit it and the interval closes over a stale value.
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    void refresh();
    // Auto-refresh every 5 seconds while the project is in progress.
    // Status terminal states (`complete`, `failed`) stop the poll.
    const interval = setInterval(() => {
      const current = projectRef.current;
      if (current && !['complete', 'failed'].includes(current.status)) {
        void refresh();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [refresh]);

  return { project, loading, error, refresh };
}
