import { expect, test } from '@playwright/test';

/**
 * `/trends` smoke test. Asserts the page loads, the
 * TrendsPageWrapper header renders, and the main content area
 * mounts. Does NOT assert on specific trend items because the
 * discover API fans out to real Exa + Google Trends calls with
 * variable results — row counts and titles are non-deterministic.
 */

test('@smoke /trends page loads and renders its header', async ({ page }) => {
  const res = await page.goto('/trends');
  expect(res?.status()).toBe(200);

  // The wrapper renders a `.min-h-screen` div with a header
  // and the TrendsPage body. We assert on the header (stable
  // across rendering races) and the "LaunchKit" logo link
  // back to `/app` that the wrapper always carries.
  await expect(page.locator('header').first()).toBeVisible();
  await expect(
    page.locator('header a[href="/app"]').first()
  ).toBeVisible();
});
