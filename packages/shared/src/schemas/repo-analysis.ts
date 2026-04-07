import { z } from 'zod';

/**
 * Schemas for the repo analysis phase of the launch pipeline.
 *
 * Mirrors the original hand-written interfaces in `types.ts:3-38` but
 * with runtime validation. Used by:
 *
 *   - `apps/worker/src/processors/analyze-project-repository.ts`
 *     (writes the result to the `projects.repo_analysis` jsonb column)
 *   - Every downstream agent that reads `repo_analysis` back from the
 *     database — they must validate the column shape on read with
 *     `parseJsonbColumn(RepoAnalysisSchema, row.repoAnalysis, ...)`
 *     once the boundary-validation PR lands.
 */

export const ProjectCategorySchema = z.enum([
  'cli_tool',
  'web_app',
  'mobile_app',
  'library',
  'api',
  'framework',
  'devtool',
  'infrastructure',
  'data',
  'other',
]);
export type ProjectCategory = z.infer<typeof ProjectCategorySchema>;

export const CommitSummarySchema = z.object({
  sha: z.string(),
  message: z.string(),
  date: z.string(),
  author: z.string(),
});
export type CommitSummary = z.infer<typeof CommitSummarySchema>;

export const RepoAnalysisSchema = z.object({
  readme: z.string(),
  description: z.string(),
  language: z.string(),
  techStack: z.array(z.string()),
  framework: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
  topics: z.array(z.string()),
  license: z.string().nullable(),
  hasTests: z.boolean(),
  hasCi: z.boolean(),
  recentCommits: z.array(CommitSummarySchema),
  fileTree: z.array(z.string()),
  packageDeps: z.record(z.string(), z.string()),
  category: ProjectCategorySchema,
});
export type RepoAnalysis = z.infer<typeof RepoAnalysisSchema>;
