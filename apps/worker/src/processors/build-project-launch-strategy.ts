import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  parseJsonbColumn,
  RepoAnalysisSchema,
  ResearchResultSchema,
} from '@launchkit/shared';
import type { JobData } from '@launchkit/shared';
import { createLaunchStrategy } from '../agents/launch-strategy-agent.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';
import { database as db } from '../lib/database.js';

export async function buildProjectLaunchStrategy(data: JobData): Promise<void> {
  const { projectId } = data;

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });

  if (!project || !project.repoAnalysis || !project.research) {
    throw new Error(`Project ${projectId} not ready for strategy`);
  }

  await projectProgressPublisher.phaseStart(
    projectId,
    'strategizing',
    'Crafting go-to-market strategy'
  );

  // Parse the jsonb columns through their schemas. If a previous
  // worker run wrote a row that does not match the current schema,
  // this throws a structured error naming the failing field — that
  // is the right behaviour for a stale row, not a silent crash later.
  const repoAnalysis = parseJsonbColumn(
    RepoAnalysisSchema,
    project.repoAnalysis,
    'project.repo_analysis'
  );
  const research = parseJsonbColumn(
    ResearchResultSchema,
    project.research,
    'project.research'
  );
  const strategy = await createLaunchStrategy(repoAnalysis, research);

  // Create asset records for everything the strategist wants to
  // generate. `asset.type` no longer needs an `as any` cast because
  // `AssetType` is now derived from the drizzle pgEnum directly
  // (see `packages/shared/src/enums.ts`) — drizzle's column type and
  // the schema-derived type are the same identity.
  const assetRecords = strategy.assetsToGenerate.map((asset) => ({
    projectId,
    type: asset.type,
    status: 'queued' as const,
    metadata: {
      generationInstructions: asset.generationInstructions,
      priority: asset.priority,
    },
  }));

  // Insert the queued asset records. We don't read the returned
  // rows here — the worker fan-out re-queries by `projectId` —
  // so the result is intentionally discarded.
  //
  // NOTE: this processor intentionally does NOT kick off the Render
  // Workflows parent task. The trigger lives one level up in the
  // analysis job handler at `apps/worker/src/index.ts` (the STRATEGIZE
  // branch calls `triggerWorkflowGeneration(projectId)` immediately
  // after this processor returns). The side-effect stays in the
  // handler so the processor remains pure and unit-testable. See also
  // CLAUDE.md § "Workflows service" for the three documented trigger
  // call sites.
  await db.insert(schema.assets).values(assetRecords);

  // Update project with strategy
  await db
    .update(schema.projects)
    .set({
      strategy,
      status: 'generating',
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  await projectProgressPublisher.phaseComplete(
    projectId,
    'strategizing',
    `Strategy: ${strategy.tone} tone, ${strategy.assetsToGenerate.length} assets, ${strategy.skipAssets.length} skipped`
  );

  console.log(
    `[Strategy] ${project.repoOwner}/${project.repoName}: ${strategy.positioning.slice(0, 80)}`
  );

  // Return asset IDs for the fan-out generation phase
  // The worker index will handle enqueueing generation jobs
  return;
}
