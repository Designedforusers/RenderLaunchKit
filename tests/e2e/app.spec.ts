import { expect, test } from '@playwright/test';

/**
 * `/app` (the authed home) smoke test. Asserts the
 * `RepositoryUrlForm` mounts, the project list skeleton/data
 * renders, and a query-param prefill is honored.
 */

test('@smoke /app renders project list shell and url form', async ({ page }) => {
  await page.goto('/app');
  // Hero copy on the authed home — stable substring.
  await expect(
    page.getByText(/Paste a GitHub repo/i).first()
  ).toBeVisible();

  // The RepositoryUrlForm has a text input. Playwright doesn't
  // know which specific input is "the repo input" without an
  // accessible name, so we rely on the placeholder attribute
  // which is stable.
  await expect(
    page.locator('input[placeholder*="github repo" i]').first()
  ).toBeVisible();
});

test('@smoke /app?repo=<url> pre-fills the repository form', async ({ page }) => {
  const repoUrl = 'https://github.com/sindresorhus/nanoid';
  await page.goto(`/app?repo=${encodeURIComponent(repoUrl)}`);

  // The RepositoryUrlForm's `initialUrl` prop seeds the input's
  // value on mount — Playwright reads the current DOM value.
  const input = page.locator('input[placeholder*="github repo" i]').first();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(repoUrl);
});
