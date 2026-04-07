import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { generationQueue } from '../lib/queue.js';
import { assets, projects } from '@launchkit/shared';

const app = new Hono();

// ── GET /api/assets/:id — Get a single asset ──

app.get('/:id', async (c) => {
  const id = c.req.param('id');

  const asset = await db.query.assets.findFirst({
    where: eq(assets.id, id),
  });

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  return c.json({
    id: asset.id,
    projectId: asset.projectId,
    type: asset.type,
    status: asset.status,
    content: asset.content,
    mediaUrl: asset.mediaUrl,
    metadata: asset.metadata,
    qualityScore: asset.qualityScore,
    reviewNotes: asset.reviewNotes,
    userApproved: asset.userApproved,
    userEdited: asset.userEdited,
    userEditedContent: asset.userEditedContent,
    version: asset.version,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  });
});

// ── POST /api/assets/:id/approve — Approve an asset ──

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id');

  const [updated] = await db
    .update(assets)
    .set({ userApproved: true, updatedAt: new Date() })
    .where(eq(assets.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  return c.json({ id: updated.id, userApproved: true });
});

// ── POST /api/assets/:id/reject — Reject an asset ──

app.post('/:id/reject', async (c) => {
  const id = c.req.param('id');

  const [updated] = await db
    .update(assets)
    .set({ userApproved: false, updatedAt: new Date() })
    .where(eq(assets.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  return c.json({ id: updated.id, userApproved: false });
});

// ── PUT /api/assets/:id/content — Edit asset content ──

app.put('/:id/content', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  if (!body.content || typeof body.content !== 'string') {
    return c.json({ error: 'Content is required and must be a string' }, 400);
  }

  const [updated] = await db
    .update(assets)
    .set({
      userEdited: true,
      userEditedContent: body.content,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  return c.json({ id: updated.id, userEdited: true });
});

// ── POST /api/assets/:id/regenerate — Regenerate an asset ──

app.post('/:id/regenerate', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const asset = await db.query.assets.findFirst({
    where: eq(assets.id, id),
  });

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  // Get the parent project for context
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, asset.projectId),
  });

  if (!project) {
    return c.json({ error: 'Parent project not found' }, 404);
  }

  // Update asset status
  await db
    .update(assets)
    .set({
      status: 'regenerating',
      version: asset.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, id));

  // Enqueue regeneration job
  const jobName = `generate-${asset.type.replace(/_/g, '-')}`;
  await generationQueue.add(jobName, {
    projectId: asset.projectId,
    assetId: asset.id,
    assetType: asset.type,
    brief: body.instructions || 'Regenerate with improvements based on previous feedback',
    repoAnalysis: project.repoAnalysis,
    research: project.research,
    strategy: project.strategy,
    pastInsights: [],
    revisionInstructions: body.instructions,
  });

  return c.json({ id: asset.id, status: 'regenerating', version: asset.version + 1 });
});

export default app;
