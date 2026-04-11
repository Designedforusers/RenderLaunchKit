import { expect, test } from '@playwright/test';

/**
 * Navigation smoke test. Asserts every top-level dashboard
 * route loads without error and that the back-navigation from
 * deep routes lands on `/app` (the authed home), not `/` (the
 * marketing landing). This is the regression guard for the
 * Phase 3 landing-page commit where the root route was
 * swapped from the project list to the marketing page —
 * leftover `Link to="/"` references would send logged-in users
 * to the wrong place.
 */

test('@smoke every top-level route loads without error', async ({ page }) => {
  const routes = ['/', '/app', '/trends', '/create'];
  for (const route of routes) {
    const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);
    // React has had time to mount — `#root` should be populated.
    await expect(page.locator('#root').first()).toBeVisible();
  }
});

test('@smoke authed wrappers route LaunchKit logo back to /app (not /)', async ({ page }) => {
  // TrendsPageWrapper header LaunchKit logo
  await page.goto('/trends');
  const trendsHeaderLink = page.locator('header a[href="/app"]').first();
  await expect(trendsHeaderLink).toBeVisible();

  // CreatePageWrapper header LaunchKit logo
  await page.goto('/create');
  const createHeaderLink = page.locator('header a[href="/app"]').first();
  await expect(createHeaderLink).toBeVisible();
});
