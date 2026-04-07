import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import type { JobData, RepoAnalysis, ResearchResult } from '@launchkit/shared';
import { createLaunchStrategy } from '../agents/launch-strategy-agent.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

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

  const repoAnalysis = project.repoAnalysis as unknown as RepoAnalysis;
  const research = project.research as unknown as ResearchResult;
  const strategy = await createLaunchStrategy(repoAnalysis, research);

  // Create asset records for everything the strategist wants to generate
  const assetRecords = strategy.assetsToGenerate.map((asset) => ({
    projectId,
    type: asset.type as any,
    status: 'queued' as const,
    metadata: {
      generationInstructions: asset.generationInstructions,
      priority: asset.priority,
    },
  }));

  const insertedAssets = await db
    .insert(schema.assets)
    .values(assetRecords)
    .returning();

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
