import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright end-to-end test config for LaunchKit.
 *
 * Design notes:
 *
 * - **Tests live at `tests/e2e/*.spec.ts`** — colocated with the
 *   existing `tests/*.test.mjs` node:test smoke suite but under a
 *   subdirectory so `npm test` (which globs `tests/*.test.mjs`)
 *   does not accidentally pick them up and fail on `.spec.ts`
 *   files it cannot execute.
 *
 * - **Separate npm scripts** — `npm run test:e2e`,
 *   `npm run test:e2e:ui`, `npm run test:e2e:smoke` (grep
 *   `@smoke`), and `npm run test:e2e:full` (grep
 *   `@full-pipeline`). The lefthook prepush gate does NOT run
 *   any of them because the suite needs a running dev stack
 *   which takes ~45 seconds to boot.
 *
 * - **`webServer` precheck** — probes `http://localhost:5173`
 *   with `reuseExistingServer: true`. The user starts
 *   `npm run dev` in a separate terminal; Playwright does NOT
 *   try to start the full concurrently stack itself (that
 *   approach tangles with the six-process `concurrently` setup
 *   and produces flaky startup races). Fails fast with a clear
 *   "dashboard must be running" error if the user forgot.
 *
 * - **`workers: 1`** — tests run serially so real provider API
 *   rate limits (ElevenLabs, fal.ai) do not race. Can bump on
 *   a per-file basis if needed via `test.describe.configure`.
 *
 * - **Artifact capture** — traces on failure, screenshots on
 *   failure, video on failure. The HTML reporter outputs to
 *   `playwright-report/` which CI uploads as an artifact.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 90 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list']],
  globalSetup: './tests/e2e/fixtures/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Precheck only — Playwright asserts the dashboard is already
    // running (user starts `npm run dev` manually) and does NOT
    // try to start it from here. `reuseExistingServer: true` plus
    // a no-op `command` makes this a passive probe.
    command: 'echo "dashboard must be running at http://localhost:5173"',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 10 * 1000,
  },
});
