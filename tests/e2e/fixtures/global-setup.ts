import type { FullConfig } from '@playwright/test';

/**
 * Playwright global setup — runs once before any `.spec.ts` fires.
 *
 * Kept deliberately light. The LaunchKit tests do NOT truncate
 * + reseed the dev database between runs because:
 *
 *   1. The user runs the suite against their own local dev stack
 *      (`npm run dev`), which is often populated with in-progress
 *      projects they want to keep.
 *   2. Most specs assert on route shapes and UI behavior, not on
 *      a specific set of rows — tests tolerate empty or populated
 *      state.
 *   3. The full-pipeline spec creates its own project via the
 *      normal `POST /api/projects` endpoint, so it does not
 *      depend on seeded state at all.
 *
 * CI gets a fresh Postgres via GitHub Actions `services:`, so
 * there is no state to preserve there — the same specs work
 * against an empty DB because they are shape-asserting, not
 * row-asserting.
 *
 * What this setup DOES do: probes the dashboard at
 * `http://localhost:5173` with a short timeout and fails loud
 * if the dev stack is not running. This gives a clear error
 * message on the most common operator mistake (running
 * `npm run test:e2e` without `npm run dev` in another terminal)
 * instead of a cryptic connection refused somewhere mid-spec.
 */
async function globalSetup(_config: FullConfig): Promise<void> {
  const base = 'http://localhost:5173';
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 5000);
  try {
    const res = await fetch(base, { signal: controller.signal });
    if (res.status !== 200) {
      throw new Error(
        `[playwright global-setup] Dashboard responded with ${String(res.status)} — expected 200. Is \`npm run dev\` running?`
      );
    }
  } catch (err) {
    throw new Error(
      `[playwright global-setup] Cannot reach dashboard at ${base}. Start the full dev stack in another terminal with \`npm run dev\` before running the E2E suite. Underlying error: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }
}

export default globalSetup;
