import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { database } from '../lib/database.js';
import { outreachDrafts, OutreachStatusUpdateSchema } from '@launchkit/shared';

/**
 * Phase 5 — `mark-sent` route. Updates an `outreach_drafts` row's
 * status from `drafted` → `copied`/`sent`. The dashboard outreach
 * panel (Phase 8) will be the only consumer; the route ships in
 * Phase 5 because the schema is already defined and shipping it
 * now avoids two PRs touching this file.
 */

const outreachApiRoutes = new Hono();

const outreachIdParamSchema = z.string().uuid();

// ── POST /api/outreach/:id/mark-sent — Update outreach draft status ──

outreachApiRoutes.post('/:id/mark-sent', async (c) => {
  const idParse = outreachIdParamSchema.safeParse(c.req.param('id'));
  if (!idParse.success) {
    return c.json(
      { error: 'Outreach draft id must be a valid UUID' },
      400
    );
  }

  const rawBody: unknown = await c.req.json().catch(() => null);
  const bodyParse = OutreachStatusUpdateSchema.safeParse(rawBody);
  if (!bodyParse.success) {
    return c.json(
      { error: bodyParse.error.issues[0]?.message ?? 'Invalid request body' },
      400
    );
  }

  const [updated] = await database
    .update(outreachDrafts)
    .set({ status: bodyParse.data.status, updatedAt: new Date() })
    .where(eq(outreachDrafts.id, idParse.data))
    .returning();

  if (!updated) {
    return c.json({ error: 'Outreach draft not found' }, 404);
  }

  return c.json({
    id: updated.id,
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
  });
});

export default outreachApiRoutes;
