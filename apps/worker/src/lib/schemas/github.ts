import { z } from 'zod';

/**
 * Zod schemas for the GitHub REST API responses we consume in
 * `apps/worker/src/tools/github-repository-tools.ts`.
 *
 * Each schema describes only the fields we actually read from the
 * response — GitHub returns hundreds of fields per repo and we do
 * not want to validate (or document) every one of them. Strict mode
 * is intentionally OFF (the schemas use `.passthrough()` semantics)
 * so the upstream API can add new fields without breaking us.
 *
 * Co-located with the consumer rather than in `@launchkit/shared`
 * because these are worker-specific HTTP-boundary schemas — no other
 * package needs them, and putting them in `shared` would force a
 * dependency that does not exist.
 */

// ── Repo metadata: GET /repos/:owner/:name ──────────────────────────

export const GitHubLicenseSchema = z
  .object({
    spdx_id: z.string().nullable().optional(),
  })
  .passthrough();

export const GitHubRepoSchema = z
  .object({
    description: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    stargazers_count: z.number().int().nonnegative().optional(),
    forks_count: z.number().int().nonnegative().optional(),
    license: GitHubLicenseSchema.nullable().optional(),
  })
  .passthrough();
export type GitHubRepo = z.infer<typeof GitHubRepoSchema>;

// ── README: GET /repos/:owner/:name/readme ──────────────────────────

export const GitHubReadmeSchema = z
  .object({
    content: z.string(),
  })
  .passthrough();

// ── File tree: GET /repos/:owner/:name/git/trees/HEAD?recursive=1 ──

export const GitHubTreeEntrySchema = z
  .object({
    path: z.string(),
    type: z.string(),
  })
  .passthrough();

export const GitHubTreeSchema = z
  .object({
    tree: z.array(GitHubTreeEntrySchema).optional(),
  })
  .passthrough();

// ── Recent commits: GET /repos/:owner/:name/commits ─────────────────

export const GitHubCommitAuthorSchema = z
  .object({
    name: z.string(),
    date: z.string(),
  })
  .passthrough();

export const GitHubCommitDetailsSchema = z
  .object({
    message: z.string(),
    author: GitHubCommitAuthorSchema,
  })
  .passthrough();

export const GitHubCommitSchema = z
  .object({
    sha: z.string(),
    commit: GitHubCommitDetailsSchema,
  })
  .passthrough();

export const GitHubCommitListSchema = z.array(GitHubCommitSchema);

// ── Search: GET /search/repositories ────────────────────────────────

export const GitHubSearchRepoSchema = z
  .object({
    full_name: z.string(),
    description: z.string().nullable().optional(),
    stargazers_count: z.number().int().nonnegative().optional(),
    language: z.string().nullable().optional(),
    html_url: z.string(),
    topics: z.array(z.string()).optional(),
  })
  .passthrough();

export const GitHubSearchResponseSchema = z
  .object({
    items: z.array(GitHubSearchRepoSchema).optional(),
  })
  .passthrough();

// ── Languages: GET /repos/:owner/:name/languages ────────────────────

export const GitHubLanguagesSchema = z.record(z.string(), z.number());

// ── Topics: GET /repos/:owner/:name/topics ──────────────────────────

export const GitHubTopicsSchema = z
  .object({
    names: z.array(z.string()).optional(),
  })
  .passthrough();

// ── Raw package.json (loose: only the fields we read) ───────────────

export const PackageJsonSchema = z
  .object({
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
export type PackageJson = z.infer<typeof PackageJsonSchema>;
