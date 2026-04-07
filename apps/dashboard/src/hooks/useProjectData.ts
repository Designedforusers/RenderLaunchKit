import { useState, useEffect, useCallback } from 'react';
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
    refresh();
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

  useEffect(() => {
    refresh();
    // Auto-refresh every 5 seconds if project is in progress
    const interval = setInterval(() => {
      if (project && !['complete', 'failed'].includes(project.status)) {
        refresh();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [refresh, project?.status]);

  return { project, loading, error, refresh };
}
