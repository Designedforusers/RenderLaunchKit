/**
 * Shared constants for E2E specs.
 *
 * `TEST_REPO` is the GitHub URL every test uses for
 * end-to-end pipeline runs. `sindresorhus/nanoid` is picked
 * because the analyze phase is fast (small README, small file
 * tree, few deps) and the repo is stable — no flaky network
 * rate limits on the GitHub API, no risk of the repo being
 * renamed or deleted out from under the test.
 */
export const TEST_REPO = 'https://github.com/sindresorhus/nanoid';
