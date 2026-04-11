import { expect, test } from '@playwright/test';
import { TEST_REPO } from './fixtures/test-repos.js';

/**
 * Full-pipeline E2E test. Tagged `@full-pipeline` so the smoke
 * suite skips it by default — this spec creates a real project
 * via `POST /api/projects`, polls the progress feed through the
 * full `analyze → research → strategize → generating → reviewing
 * → complete` lifecycle, and asserts generated assets appear.
 *
 * Runs against real providers: Anthropic, Voyage, fal.ai (if
 * configured), ElevenLabs (if configured), World Labs (if
 * configured). Costs real money per run (~$0.10-0.50 typical)
 * and takes 5-15 minutes wall-clock. Does NOT run on every PR;
 * CI gates it behind a `run-e2e-full` label.
 *
 * Invoke manually via `npm run test:e2e:full` against a running
 * dev stack.
 */

test.describe.configure({ timeout: 20 * 60 * 1000 }); // 20 min

test('@full-pipeline paste URL → analyze → strategize → generate → reviewing → complete', async ({
  page,
}) => {
  // Start at the landing page to exercise the full user flow.
  await page.goto('/');

  // Fill the hero form and click "Launch it" — should forward
  // to `/app?repo=...` with the form pre-filled.
  await page.locator('#landing-repo-input').fill(TEST_REPO);
  await Promise.all([
    page.waitForURL(/\/app\?repo=/),
    page.getByRole('button', { name: /^Launch it$/ }).click(),
  ]);

  // On `/app`, the real RepositoryUrlForm submit button fires
  // the `POST /api/projects` call. The button appears after the
  // URL pre-fill settles.
  const submitButton = page
    .locator('button[type="submit"]')
    .filter({ hasText: /Analyze|Launch|Submit|Create/i })
    .first();
  await expect(submitButton).toBeVisible({ timeout: 15_000 });
  await Promise.all([
    page.waitForURL(/\/projects\//, { timeout: 30_000 }),
    submitButton.click(),
  ]);

  // On `/projects/:id` we should be watching the progress feed.
  // Stages roll through analyze → research → strategize →
  // generating → reviewing → complete. We just watch for the
  // terminal "complete" (or "reviewing" as a proxy if the review
  // loop is fast) marker rather than asserting every stage.
  //
  // Timeout budget: 15 minutes. nanoid is a small repo so
  // research + strategize + generate + review typically land
  // in under 8 minutes when all providers are configured.
  const completeMarker = page
    .getByText(/complete|reviewing/i)
    .first();
  await expect(completeMarker).toBeVisible({ timeout: 15 * 60 * 1000 });

  // Once at least one asset has been generated, it should render
  // in the project detail grid. We assert the generic shape
  // (asset cards visible) without pinning to a specific count
  // because the asset fan-out varies with provider availability.
  const assetCards = page
    .locator('[data-asset-type], article, [class*="asset"]')
    .first();
  await expect(assetCards).toBeVisible({ timeout: 30_000 });

  // Back-nav regression: the project detail's back arrow should
  // land on `/app`, not `/`. Direct guard for the Phase 3c fix.
  const backLink = page
    .locator('a[href="/app"]')
    .filter({ hasText: /back|←|Projects/i })
    .first();
  if (await backLink.isVisible()) {
    await backLink.click();
    await expect(page).toHaveURL(/\/app$/);
  }
});
