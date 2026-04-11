/**
 * Shared constants for E2E specs.
 *
 * `TEST_REPO` is the GitHub URL every test uses for
 * end-to-end pipeline runs. `sindresorhus/slugify` is picked
 * because the analyze phase is fast (small README, small file
 * tree, few deps) and the repo is active — the original
 * choice `sindresorhus/nanoid` returns 404 on the GitHub API
 * as of the last E2E run, so it was swapped out.
 */
export const TEST_REPO = 'https://github.com/sindresorhus/slugify';
