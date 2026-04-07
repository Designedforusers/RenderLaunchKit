import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { enqueueAnalysis } from '../lib/queue.js';
import {
  projects,
  assets,
  jobs,
  parseRepoUrl,
  buildRepoUrl,
} from '@launchkit/shared';

const app = new Hono();

// ── POST /api/projects — Create a new project from a repo URL ──

const createProjectSchema = z.object({
  repoUrl: z.string().min(1, 'Repo URL is required'),
});

app.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createProjectSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const repo = parseRepoUrl(parsed.data.repoUrl);
  if (!repo) {
    return c.json(
      { error: 'Invalid GitHub repo URL. Expected format: https://github.com/owner/repo' },
      400
    );
  }

  // Check if project already exists
  const existing = await db.query.projects.findFirst({
    where: eq(projects.repoUrl, buildRepoUrl(repo.owner, repo.name)),
  });

  if (existing) {
    return c.json(
      {
        id: existing.id,
        repoUrl: existing.repoUrl,
        repoOwner: existing.repoOwner,
        repoName: existing.repoName,
        status: existing.status,
        createdAt: existing.createdAt.toISOString(),
        message: 'Project already exists',
      },
      200
    );
  }

  // Create new project
  const [project] = await db
    .insert(projects)
    .values({
      repoUrl: buildRepoUrl(repo.owner, repo.name),
      repoOwner: repo.owner,
      repoName: repo.name,
      status: 'pending',
    })
    .returning();

  // Enqueue the analysis pipeline
  await enqueueAnalysis({
    projectId: project.id,
    repoUrl: project.repoUrl,
    repoOwner: project.repoOwner,
    repoName: project.repoName,
  });

  // Update status to analyzing
  await db
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

app.get('/', async (c) => {
  const allProjects = await db.query.projects.findMany({
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

app.get('/:id', async (c) => {
  const id = c.req.param('id');

  const project = await db.query.projects.findFirst({
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
      version: a.version,
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

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const [deleted] = await db.delete(projects).where(eq(projects.id, id)).returning();

  if (!deleted) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({ ok: true, id: deleted.id });
});

// ── PATCH /api/projects/:id/webhook — Toggle webhook ──

app.patch('/:id/webhook', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const enabled = Boolean(body.enabled);

  const [updated] = await db
    .update(projects)
    .set({ webhookEnabled: enabled, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({ id: updated.id, webhookEnabled: updated.webhookEnabled });
});

export default app;
