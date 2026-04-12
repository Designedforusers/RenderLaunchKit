import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { database } from '../lib/database.js';
import { enqueueRepositoryAnalysis } from '../lib/job-queue-clients.js';
import { expensiveRouteRateLimit } from '../middleware/rate-limit.js';
import {
  projects,
  assets,
  jobs,
  parseRepoUrl,
  buildRepoUrl,
  CreateProjectRequestSchema,
} from '@launchkit/shared';
import {
  encryptGithubToken,
  GithubTokenEncryptionDisabledError,
} from '../lib/github-token-crypto.js';
import {
  parseUuidParam,
  invalidUuidResponse,
} from '../lib/validate-uuid.js';

const projectApiRoutes = new Hono();

// ── POST /api/projects — Create a new project from a repo URL ──

const createProjectSchema = CreateProjectRequestSchema;

// Project creation triggers an Anthropic agentic research loop, fal.ai
// image/video generation, and uses the GitHub API budget. Apply the
// stricter expensive-route limit (10 req/min/IP) on top of the global
// /api/* limit (100 req/min/IP).
projectApiRoutes.post('/', expensiveRouteRateLimit, async (c) => {
  const body: unknown = await c.req.json();
  const parsed = createProjectSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
  }

  const repo = parseRepoUrl(parsed.data.repoUrl);
  if (!repo) {
    return c.json(
      { error: 'Invalid GitHub repo URL. Expected format: https://github.com/owner/repo' },
      400
    );
  }
  // GitHub treats owner/name as case-insensitive. Normalize here so
  // the findFirst lookup, the insert, and the unique constraint on
  // (lower(repo_owner), lower(repo_name)) all agree.
  repo.owner = repo.owner.toLowerCase();
  repo.name = repo.name.toLowerCase();

  // Encrypt a user-supplied GitHub personal access token before we
  // touch the database. Doing this up-front keeps the "private-repo
  // support is not configured" error out of the partially-written
  // state where a row exists without a usable token.
  let githubTokenEncrypted: string | null = null;
  if (parsed.data.githubToken !== undefined) {
    try {
      githubTokenEncrypted = encryptGithubToken(parsed.data.githubToken);
    } catch (err) {
      if (err instanceof GithubTokenEncryptionDisabledError) {
        return c.json({ error: err.message }, 503);
      }
      throw err;
    }
  }

  // Check if project already exists. In-progress projects return
  // 200 to prevent double work. Terminal-state projects (complete /
  // failed) are replaced inside a transaction so the prior run
  // survives if the insert fails. If the enqueue also fails after
  // the transaction commits, the new row is cleaned up (see the
  // catch block below).
  const existing = await database.query.projects.findFirst({
    where: eq(projects.repoUrl, buildRepoUrl(repo.owner, repo.name)),
  });

  if (existing) {
    if (existing.status !== 'complete' && existing.status !== 'failed') {
      return c.json(
        {
          id: existing.id,
          repoUrl: existing.repoUrl,
          repoOwner: existing.repoOwner,
          repoName: existing.repoName,
          status: existing.status,
          createdAt: existing.createdAt.toISOString(),
          message: 'Project already exists and is in progress',
        },
        200
      );
    }
  }

  // Create new project (or replace a terminal-state run). The unique
  // index on (lower(repo_owner), lower(repo_name)) turns a concurrent
  // duplicate insert into a Postgres 23505 error instead of a silent
  // second row. Reruns wrap the delete + insert in a transaction so
  // the prior run survives if the insert fails for any reason.
  const newProjectValues = {
    repoUrl: buildRepoUrl(repo.owner, repo.name),
    repoOwner: repo.owner,
    repoName: repo.name,
    status: 'pending' as const,
    // `exactOptionalPropertyTypes` forbids an explicit `undefined`
    // on an optional column, so only spread the field when we have
    // a ciphertext to store. Null-valued public-repo projects get
    // the column default (NULL) from the migration.
    ...(githubTokenEncrypted !== null ? { githubTokenEncrypted } : {}),
  };
  let project;
  try {
    if (existing) {
      // Terminal rerun — atomic delete + insert. ON DELETE CASCADE
      // cleans up child rows (assets, jobs, cost events, feedback).
      [project] = await database.transaction(async (tx) => {
        await tx.delete(projects).where(eq(projects.id, existing.id));
        return tx.insert(projects).values(newProjectValues).returning();
      });
    } else {
      [project] = await database
        .insert(projects)
        .values(newProjectValues)
        .returning();
    }
  } catch (err) {
    // Unique constraint violation — a concurrent insert won the race.
    // Return the existing project instead of a 500.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      const raceWinner = await database.query.projects.findFirst({
        where: eq(projects.repoUrl, buildRepoUrl(repo.owner, repo.name)),
      });
      if (raceWinner) {
        return c.json({
          id: raceWinner.id,
          repoUrl: raceWinner.repoUrl,
          repoOwner: raceWinner.repoOwner,
          repoName: raceWinner.repoName,
          status: raceWinner.status,
          createdAt: raceWinner.createdAt.toISOString(),
          message: 'Project already exists',
        });
      }
    }
    throw err;
  }

  if (!project) {
    // Drizzle's `.returning()` is typed as `T[]`, so the strict
    // flags require this guard. Reaching it means the insert was
    // accepted but no row came back — a server-side invariant
    // violation rather than a request validation problem.
    return c.json(
      { error: 'Internal error: project insert returned no row' },
      500
    );
  }

  // Enqueue the analysis pipeline. If the queue is transiently
  // unavailable, mark the row as failed so the next submit sees a
  // terminal project and can retry cleanly via the rerun path.
  try {
    await enqueueRepositoryAnalysis({
      projectId: project.id,
      repoUrl: project.repoUrl,
      repoOwner: project.repoOwner,
      repoName: project.repoName,
    });
  } catch {
    await database
      .update(projects)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    return c.json(
      { error: 'Failed to enqueue analysis — please retry' },
      503
    );
  }

  // Update status to analyzing
  await database
    .update(projects)
    .set({ status: 'analyzing', updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  return c.json(
    {
      id: project.id,
      repoUrl: project.repoUrl,
      repoOwner: project.repoOwner,
      repoName: project.repoName,
      status: 'analyzing',
      createdAt: project.createdAt.toISOString(),
    },
    201
  );
});

// ── GET /api/projects — List all projects ──

projectApiRoutes.get('/', async (c) => {
  const allProjects = await database.query.projects.findMany({
    orderBy: [desc(projects.createdAt)],
    with: {
      assets: {
        columns: {
          id: true,
          type: true,
          status: true,
          qualityScore: true,
        },
      },
    },
  });

  return c.json(
    allProjects.map((p) => ({
      id: p.id,
      repoUrl: p.repoUrl,
      repoOwner: p.repoOwner,
      repoName: p.repoName,
      status: p.status,
      reviewScore: p.reviewScore,
      revisionCount: p.revisionCount,
      webhookEnabled: p.webhookEnabled,
      assetCount: p.assets.length,
      completedAssets: p.assets.filter((a) => a.status === 'complete').length,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }))
  );
});

// ── GET /api/projects/:id — Get project detail ──

projectApiRoutes.get('/:id', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  const project = await database.query.projects.findFirst({
    where: eq(projects.id, id),
    with: {
      assets: {
        orderBy: [desc(assets.createdAt)],
      },
      jobs: {
        orderBy: [desc(jobs.createdAt)],
      },
    },
  });

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({
    id: project.id,
    repoUrl: project.repoUrl,
    repoOwner: project.repoOwner,
    repoName: project.repoName,
    status: project.status,
    repoAnalysis: project.repoAnalysis,
    research: project.research,
    strategy: project.strategy,
    reviewScore: project.reviewScore,
    reviewFeedback: project.reviewFeedback,
    revisionCount: project.revisionCount,
    webhookEnabled: project.webhookEnabled,
    assets: project.assets.map((a) => ({
      id: a.id,
      projectId: a.projectId,
      type: a.type,
      status: a.status,
      content: a.content,
      mediaUrl: a.mediaUrl,
      metadata: a.metadata,
      qualityScore: a.qualityScore,
      reviewNotes: a.reviewNotes,
      userApproved: a.userApproved,
      userEdited: a.userEdited,
      userEditedContent: a.userEditedContent,
      version: a.version,
      costCents: a.costCents,
      costBreakdown: a.costBreakdown,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
    jobs: project.jobs.map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status,
      attempts: j.attempts,
      duration: j.duration,
      error: j.error,
      startedAt: j.startedAt?.toISOString(),
      completedAt: j.completedAt?.toISOString(),
      createdAt: j.createdAt.toISOString(),
    })),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

// ── DELETE /api/projects/:id — Delete a project ──

projectApiRoutes.delete('/:id', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  const [deleted] = await database
    .delete(projects)
    .where(eq(projects.id, id))
    .returning();

  if (!deleted) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({ ok: true, id: deleted.id });
});

// ── PATCH /api/projects/:id/webhook — Toggle webhook ──

const toggleWebhookSchema = z.object({
  enabled: z.boolean(),
});

projectApiRoutes.patch('/:id/webhook', async (c) => {
  const id = parseUuidParam(c);
  if (!id) return invalidUuidResponse(c);

  const rawBody: unknown = await c.req.json();
  const parsedBody = toggleWebhookSchema.safeParse(rawBody);

  if (!parsedBody.success) {
    return c.json(
      { error: parsedBody.error.issues[0]?.message ?? 'Invalid request body' },
      400
    );
  }

  const enabled = parsedBody.data.enabled;

  const [updated] = await database
    .update(projects)
    .set({ webhookEnabled: enabled, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({ id: updated.id, webhookEnabled: updated.webhookEnabled });
});

export default projectApiRoutes;
