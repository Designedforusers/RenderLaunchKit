import { and, eq, lt, inArray } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import { database } from './database.js';

/**
 * Rescue assets stuck in `reviewing` status.
 *
 * The review BullMQ job can be lost between Workflows completion
 * and the worker picking it up — worker restarts, Redis hiccups,
 * or the Workflows callback failing to enqueue. The recovery fix
 * in `review-generated-assets.ts` only catches review LLM
 * failures, not lost jobs.
 *
 * This rescuer scans for assets stuck in `reviewing` for more than
 * STUCK_THRESHOLD_MINUTES and auto-completes them. The asset
 * already exists in the DB with content/mediaUrl populated — it's
 * just waiting for a review score it'll never get. Auto-completing
 * unblocks the project status without losing the asset.
 *
 * Also scans projects stuck in `reviewing` or `revising` whose
 * assets are all in terminal states and finalizes them to
 * `complete`.
 */

const STUCK_THRESHOLD_MINUTES = 5;

export async function rescueStuckAssets(): Promise<void> {
  console.log('[Cron:RescueStuckAssets] Scanning for stuck assets...');

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000);

  // 1. Find assets stuck in `reviewing` past the threshold.
  const stuckAssets = await database
    .select({
      id: schema.assets.id,
      projectId: schema.assets.projectId,
      type: schema.assets.type,
      updatedAt: schema.assets.updatedAt,
    })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.status, 'reviewing'),
        lt(schema.assets.updatedAt, cutoff)
      )
    );

  if (stuckAssets.length > 0) {
    console.log(
      `[Cron:RescueStuckAssets] Auto-completing ${String(stuckAssets.length)} stuck asset(s)`
    );

    for (const asset of stuckAssets) {
      await database
        .update(schema.assets)
        .set({ status: 'complete', updatedAt: new Date() })
        .where(eq(schema.assets.id, asset.id));
    }
  }

  // 2. Find projects stuck in `reviewing` or `revising` whose
  //    assets are all in terminal states (complete/rejected/failed).
  //    These projects never received their final status flip and
  //    need to be finalized.
  const stuckProjects = await database
    .select({
      id: schema.projects.id,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(
      and(
        inArray(schema.projects.status, ['reviewing', 'revising']),
        lt(schema.projects.updatedAt, cutoff)
      )
    );

  for (const project of stuckProjects) {
    const projectAssets = await database
      .select({ status: schema.assets.status })
      .from(schema.assets)
      .where(eq(schema.assets.projectId, project.id));

    const allTerminal = projectAssets.every(
      (a) =>
        a.status === 'complete' ||
        a.status === 'rejected' ||
        a.status === 'failed' ||
        a.status === 'approved'
    );

    if (allTerminal && projectAssets.length > 0) {
      await database
        .update(schema.projects)
        .set({ status: 'complete', updatedAt: new Date() })
        .where(eq(schema.projects.id, project.id));
      console.log(
        `[Cron:RescueStuckAssets] Finalized stuck project ${project.id}`
      );
    }
  }

  console.log('[Cron:RescueStuckAssets] Done');
}
