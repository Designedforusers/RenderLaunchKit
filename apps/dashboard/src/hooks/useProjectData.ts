import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import type { ProjectDetail, ProjectSummary } from '../lib/api.js';

// Project status values that are "in progress" — polling continues
// while any visible project is in one of these states. Terminal
// states (`complete`, `failed`) stop contributing to the polling
// decision so a list of fully-settled projects does not burn CPU
// on a 5-second interval.
const IN_PROGRESS_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'analyzing',
  'researching',
  'strategizing',
  'generating',
  'reviewing',
  'regenerating',
]);

export function useProjectListData() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Only show the full skeleton on the first load; subsequent
      // polling refreshes should NOT flip `loading` back to `true`
      // or the list UI flashes to an empty state on every tick.
      const data = await api.listProjects();
      setProjects(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  // Mirror the latest project list into a ref so the polling
  // interval below can inspect current statuses without re-firing
  // the effect on every payload change. Same pattern as
  // `useProjectDetailData` below.
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    void refresh();

    // Auto-refresh every 5 seconds while ANY project in the list
    // is in a non-terminal state. This matches the project detail
    // page's polling behavior and means a user who just created a
    // project, or who is watching an in-flight analyze/generate
    // run, does not need to manually press the Refresh button to
    // see status updates. Once every project has settled into
    // `complete` / `failed`, polling becomes a no-op and stays
    // scheduled only as a lightweight heartbeat for new projects
    // another user might have created.
    const interval = setInterval(() => {
      const current = projectsRef.current;
      // Always refresh at least one tick after mount so a freshly
      // created project shows up on the next cycle — empty list
      // still benefits from polling to catch newly inserted rows.
      const hasInProgress =
        current.length === 0 ||
        current.some((p) => IN_PROGRESS_PROJECT_STATUSES.has(p.status));
      if (hasInProgress) {
        void refresh();
      }
    }, 5000);

    return () => clearInterval(interval);
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
