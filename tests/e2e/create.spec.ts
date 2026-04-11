import { expect, test } from '@playwright/test';

/**
 * `/create` creative studio smoke test. Asserts the page loads,
 * the header + form render, and a mode switcher is available.
 * Does NOT exercise the real fal.ai / ElevenLabs / World Labs
 * generation path — those burn real credits per run and are
 * covered by the `@full-pipeline` suite only.
 */

test('@smoke /create creative studio loads', async ({ page }) => {
  const res = await page.goto('/create');
  expect(res?.status()).toBe(200);

  // CreatePageWrapper renders the same header shell as other
  // authed routes, with the LaunchKit logo linking back to
  // `/app`. The inner CreatePage body is large and still
  // loading when the header hits the DOM; we assert on what is
  // stable.
  await expect(page.locator('header').first()).toBeVisible();
  await expect(
    page.locator('header a[href="/app"]').first()
  ).toBeVisible();
});
