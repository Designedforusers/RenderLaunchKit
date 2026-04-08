import type { z } from 'zod';

export * from './agent-outputs.js';
export * from './api.js';
export * from './asset-feedback-event.js';
export * from './commit-marketing-run.js';
export * from './dev-influencer.js';
export * from './github-webhook.js';
export * from './job-data.js';
export * from './outreach-draft.js';
export * from './progress-event.js';
export * from './repo-analysis.js';
export * from './research.js';
export * from './review.js';
export * from './strategy-insight.js';
export * from './strategy.js';
export * from './trend-signal.js';
export * from './voiceover.js';

/**
 * Validate a value read from a Postgres `jsonb` column against a Zod
 * schema. Throws an `Error` with a descriptive message naming the
 * column and the failing field path if the value does not match.
 *
 * Drizzle types every `jsonb` column as `unknown` because the database
 * does not enforce a shape — that's correct, but the existing
 * codebase routes around it with `as unknown as RepoAnalysis` casts
 * scattered through the worker. Those casts are the entire reason
 * this PR exists. The boundary-validation PR will replace each one
 * with `parseJsonbColumn(RepoAnalysisSchema, project.repoAnalysis,
 * 'project.repo_analysis')`, which:
 *
 *   1. Catches drift between the writer and the reader at parse time
 *      with a structured error that names the failing field, instead
 *      of a confusing `undefined is not an object` ten lines later.
 *
 *   2. Narrows the return type to `z.infer<typeof Schema>` so the
 *      caller no longer needs the cast at all.
 *
 *   3. Documents at the call site which column the value came from,
 *      so a parse failure has actionable provenance.
 *
 * Implemented with `safeParse` rather than `parse` so the helper can
 * compose the error message with the column context before throwing —
 * `parse`'s default error formatter does not know which column it was
 * called against.
 */
export function parseJsonbColumn<S extends z.ZodType>(
  schema: S,
  value: unknown,
  context: string
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Zod v4's `error.message` is a JSON-stringified array of issue
    // objects, which is unreadable in structured log aggregators
    // (Datadog, Render's log viewer). Format the issues into a
    // single line of `path: message` pairs so the failure has
    // actionable provenance at a glance.
    const formatted = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(`Invalid ${context} in database: ${formatted}`);
  }
  return result.data;
}
