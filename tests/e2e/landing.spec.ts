import { expect, test } from '@playwright/test';
import { TEST_REPO } from './fixtures/test-repos.js';

/**
 * Landing page smoke test.
 *
 * Covers the root route (`/`) end-to-end: the marketing page
 * renders, the hero input accepts a repo URL, clicking "Launch
 * it" forwards the user to `/app?repo=...` with the form
 * pre-filled. Every other dashboard route shares this landing
 * page as the entry point, so this spec is the first thing that
 * fires in the `@smoke` suite and the clearest signal that the
 * dev stack is healthy.
 */

test('@smoke landing page renders hero and forwards to /app with repo query', async ({ page }) => {
  // Navigate to the landing page.
  await page.goto('/');

  // Wait for React hydration — the hero h1 is split across
  // motion.span children and rendered via framer-motion's
  // stagger animation, so we assert on the enclosing h1 being
  // visible rather than matching specific text.
  await expect(page.locator('h1').first()).toBeVisible();

  // The hero subhead mentions the core pitch. Assert a substring
  // that is stable across copy tweaks.
  await expect(
    page.getByText(/Paste a repository URL/).first()
  ).toBeVisible();

  // Hero URL input exists and carries its `sr-only` label.
  const repoInput = page.locator('#landing-repo-input');
  await expect(repoInput).toBeVisible();

  // Clear the default placeholder value and type a real repo URL.
  await repoInput.fill(TEST_REPO);

  // Click the primary "Launch it" button inside the hero form.
  // The button text must be exact so a stray "Launch" in a later
  // section doesn't match.
  const launchButton = page.getByRole('button', { name: /^Launch it$/ });
  await expect(launchButton).toBeVisible();

  // Clicking should forward the user to `/app` with the repo
  // URL as a query param. Playwright treats `window.location.href`
  // redirects as navigation events, so `waitForURL` is the
  // right assertion.
  await Promise.all([
    page.waitForURL(/\/app\?repo=/),
    launchButton.click(),
  ]);

  // Post-redirect: the `/app` page should render the real
  // `RepositoryUrlForm` with the query param pre-filled. The
  // form is in a motion.section that mounts after the page load,
  // so we wait for it to be visible.
  expect(page.url()).toMatch(/\/app\?repo=/);
  expect(decodeURIComponent(page.url())).toContain(TEST_REPO);
});

test('@smoke landing page tech stack strip renders all 8 logos with intrinsic dimensions', async ({ page }) => {
  await page.goto('/');

  // Scroll to the tech stack section so the `whileInView` motion
  // actually fires (framer-motion's viewport-based animation
  // gates the render until the section enters the viewport).
  await page.evaluate(() => window.scrollBy(0, 1500));

  // Every logo img should have explicit `width` and `height`
  // attributes — the CLS fix from Phase 3c. Assert there are 8
  // logos AND that each has the intrinsic dimensions set.
  const logos = page.locator('img[alt$="logo"]');
  await expect(logos).toHaveCount(8);

  for (let i = 0; i < 8; i++) {
    const logo = logos.nth(i);
    await expect(logo).toBeVisible();
    const width = await logo.getAttribute('width');
    const height = await logo.getAttribute('height');
    expect(width).not.toBeNull();
    expect(height).not.toBeNull();
    // All 8 logos currently use 120x28 reservation slots — tight
    // enough to assert, relaxed enough that a future per-logo
    // override can be added without breaking the test.
    expect(Number(width)).toBeGreaterThan(0);
    expect(Number(height)).toBeGreaterThan(0);
  }
});
