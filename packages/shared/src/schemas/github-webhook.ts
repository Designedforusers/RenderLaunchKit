import { z } from 'zod';

/**
 * Schemas for the GitHub webhook payloads we consume in
 * `apps/web/src/routes/github-webhook-routes.ts`.
 *
 * GitHub webhook payloads are large and shape-stable but contain
 * dozens of fields per event type that we never read. The schemas
 * below describe only the subset we actually consume — `repository.
 * html_url`, `after`, `head_commit.message`, `release.tag_name`,
 * `release.name`. Everything else passes through with `.passthrough()`
 * so the upstream payload format can grow without breaking us.
 *
 * Why these live in `@launchkit/shared` instead of `apps/web`
 * ---------------------------------------------------------
 *
 * The webhook payload is persisted to the `webhook_events.payload`
 * jsonb column on insert and could be re-parsed by future cron jobs
 * (e.g. a re-evaluation pass over recent webhook events). Putting
 * the schemas in `shared` lets the cron and the worker import the
 * same parser the web app used to write the row.
 */

// ── /repos/:owner/:name top-level subset on every push event ────────

export const GitHubWebhookRepositorySchema = z
  .object({
    html_url: z.string(),
  })
  .passthrough();

// ── push fields (optional, present on push events) ─────────────────
//
// `head_commit` is null on a force-push that landed at an earlier
// commit, on a delete event, or on the initial commit of a new
// branch. The schema models that explicitly so the webhook receiver
// can fall back to the release fields without throwing.
//
// `added`, `modified`, and `removed` are the file-path arrays GitHub
// ships with every push head_commit. Phase 6's commit-marketing-run
// processor reads them to compose the context text the agent sees,
// so they are typed here (not left to `.passthrough()`) to keep the
// consumer code free of `unknown` narrowing at the call site.

export const GitHubWebhookHeadCommitSchema = z
  .object({
    message: z.string(),
    added: z.array(z.string()).optional(),
    modified: z.array(z.string()).optional(),
    removed: z.array(z.string()).optional(),
  })
  .passthrough();

// ── release fields (optional, present on release events) ────────────
//
// `body` is the release-notes markdown the author wrote. Phase 6's
// processor reads it alongside `name`/`tag_name` to compose the
// release-marketing-run context, so it is typed here for the same
// reason as the push-commit file arrays above.

export const GitHubWebhookReleaseSchema = z
  .object({
    tag_name: z.string().optional(),
    name: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
  })
  .passthrough();

// ── Combined payload (push or release) ──────────────────────────────
//
// The webhook receiver does not know up-front which event type the
// payload is for — that comes from the `x-github-event` header. We
// use a single schema with every field optional except `repository`
// (which both event types have) so the receiver can read whichever
// fields are present without TypeScript needing to discriminate the
// union shape.
//
// This is laxer than the per-event schemas would be, but it matches
// the receiver's actual contract: the receiver wants `repository`
// for the project lookup, then opportunistically reads commit/release
// fields to populate the audit row. A wrong-event-type payload that
// somehow got through the `x-github-event` filter would still parse;
// the missing fields would just be undefined.

export const GitHubWebhookPayloadSchema = z
  .object({
    repository: GitHubWebhookRepositorySchema,
    after: z.string().optional(),
    head_commit: GitHubWebhookHeadCommitSchema.nullable().optional(),
    release: GitHubWebhookReleaseSchema.optional(),
  })
  .passthrough();
export type GitHubWebhookPayload = z.infer<typeof GitHubWebhookPayloadSchema>;
