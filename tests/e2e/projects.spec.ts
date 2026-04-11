import { expect, test } from '@playwright/test';
import { TEST_REPO } from './fixtures/test-repos.js';

/**
 * Full-pipeline E2E test. Tagged `@full-pipeline` so the smoke
 * suite skips it by default — this spec creates a real project
 * via `POST /api/projects`, polls the status badge through the
 * full `analyzing → researching → strategizing → generating →
 * reviewing → complete` lifecycle, and asserts generated asset
 * cards appear.
 *
 * Runs against real providers: Anthropic, Voyage, fal.ai,
 * ElevenLabs, World Labs, Exa. Costs real money per run
 * (~$0.10-0.50 typical) and takes 5-15 minutes wall-clock.
 * Does NOT run on every PR; CI gates it behind a
 * `run-e2e-full` label.
 *
 * Selector strategy: the spec uses discrete `data-*` attributes
 * on `LaunchStatusBadge` (`data-status`, `data-testid=
 * launch-status-badge`) and `GeneratedAssetCard`
 * (`data-asset-card`, `data-asset-type`, `data-asset-status`).
 * These are stable across copy tweaks, motion animations, and
 * CSS refactors.
 *
 * Invoke manually via `npm run test:e2e:full` against a running
 * dev stack (`npm run dev` in another terminal).
 */

test.describe.configure({ timeout: 20 * 60 * 1000 }); // 20 min

test('@full-pipeline paste URL → analyze → strategize → generate → reviewing → complete', async ({
  page,
  request,
}) => {
  // Programmatic cleanup: find any existing project for the
  // `TEST_REPO` URL and delete it via the DELETE /api/projects/:id
  // endpoint. The `POST /api/projects` path dedupes on repo_url,
  // so without this cleanup a second run of this spec would
  // silently fast-forward to the already-completed project and
  // skip the actual pipeline execution this test exists to
  // verify. `GET /api/projects` returns a bare array, not a
  // `{ projects: [...] }` envelope — match that shape.
  const existingProjectsResponse = await request.get(
    'http://localhost:3000/api/projects'
  );
  if (existingProjectsResponse.ok()) {
    const existing: Array<{ id: string; repoUrl: string }> =
      await existingProjectsResponse.json();
    const stale = existing.filter((p) => p.repoUrl === TEST_REPO);
    for (const project of stale) {
      await request.delete(`http://localhost:3000/api/projects/${project.id}`);
    }
  }

  // Start at the landing page to exercise the full user flow.
  await page.goto('/');

  // Fill the hero form and click "Launch it" — should forward
  // to `/app?repo=...` with the form pre-filled.
  await page.locator('#landing-repo-input').fill(TEST_REPO);
  await Promise.all([
    page.waitForURL(/\/app\?repo=/),
    page.getByRole('button', { name: /^Launch it$/ }).click(),
  ]);

  // On `/app`, the real `RepositoryUrlForm` submit button fires
  // the `POST /api/projects` call. The form input already
  // carries the pre-filled URL from the `?repo=` query param;
  // we just need to click submit. The form has one submit
  // button in its mounted tree.
  const submitButton = page.locator('form button[type="submit"]').first();
  await expect(submitButton).toBeVisible({ timeout: 15_000 });
  await Promise.all([
    page.waitForURL(/\/projects\//, { timeout: 60_000 }),
    submitButton.click(),
  ]);

  // We are now on `/projects/:id` watching the live pipeline.
  // The `LaunchStatusBadge` flips atomically with `project.status`
  // as the pipeline progresses through each stage. We wait for a
  // terminal state (`complete`, `reviewing`, or `failed`) via the
  // discrete `data-status` attribute on the badge — resilient
  // across the motion.span re-key animations and copy tweaks.
  //
  // React Router transitions are not instant — `waitForURL`
  // resolves as soon as the URL changes, but the old `HomePage`
  // project list can still be in the DOM for a few frames while
  // the new `ProjectDetailView` mounts. Scoping to
  // `[data-testid="project-detail-view"]` guarantees we read the
  // badge on the detail page, not a stale one on the project
  // list. Then scoping further to `[data-testid="project-header"]`
  // isolates the project-level status badge from the per-asset
  // `LaunchStatusBadge` instances inside each `GeneratedAssetCard`
  // (otherwise strict-mode matches all N+1 badges once the grid
  // renders).
  //
  // Timeout budget: 15 minutes. slugify is a small repo so
  // analyze + research + strategize lands in 1-2 minutes when
  // all providers are configured, and generate + review lands
  // in 5-10 minutes under normal load. 15 minutes leaves
  // headroom for provider rate limits or slow paths.
  const detailView = page.locator('[data-testid="project-detail-view"]');
  await expect(detailView).toBeVisible({ timeout: 30_000 });
  const statusBadge = detailView.locator(
    '[data-testid="project-header"] [data-testid="launch-status-badge"]'
  );

  // Log the initial badge status for diagnostics. The pipeline
  // moves through `pending → analyzing → researching →
  // strategizing → generating → reviewing` on a small repo in
  // 60-180 seconds, so the "initial" status Playwright captures
  // depends on render timing — this is informational only, not
  // an assertion.
  const initialStatus = await statusBadge.getAttribute('data-status');
  console.log(`[e2e] @full-pipeline: initial status = ${String(initialStatus)}`);

  // Poll the badge until it reaches a terminal state. `reviewing`
  // counts as success for this test because the review loop
  // itself is a separate Phase-6 LangGraph run that can take
  // another 2-3 minutes; once `reviewing` is reached we know the
  // generation fan-out succeeded.
  await expect
    .poll(async () => statusBadge.getAttribute('data-status'), {
      timeout: 15 * 60 * 1000,
      intervals: [5_000, 10_000, 15_000],
    })
    .toMatch(/^(complete|reviewing|failed)$/);

  // If the pipeline failed, capture which stage broke via the
  // stuck badge text before throwing a useful error message.
  const terminalStatus = await statusBadge.getAttribute('data-status');
  if (terminalStatus === 'failed') {
    throw new Error(
      `Pipeline reached 'failed' terminal state — check worker logs for the broken stage`
    );
  }

  // At least one `GeneratedAssetCard` should have mounted by
  // now via the stable `data-asset-card` hook. We do not pin
  // to a specific count because the asset fan-out varies with
  // provider availability (fal.ai down → skips image/video,
  // ElevenLabs down → skips audio, etc.). Scope to the detail
  // view for the same reason as the status badge — avoid any
  // cards that might be rendered elsewhere on the tree.
  const assetCards = detailView.locator('[data-asset-card]');
  await expect(assetCards.first()).toBeVisible({ timeout: 30_000 });

  const cardCount = await assetCards.count();
  expect(cardCount).toBeGreaterThan(0);
  console.log(
    `[e2e] @full-pipeline: project reached ${String(terminalStatus)} with ${String(cardCount)} asset cards`
  );
});
