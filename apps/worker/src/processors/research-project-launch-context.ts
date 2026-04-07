import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import type { JobData, RepoAnalysis } from '@launchkit/shared';
import { runResearchAgent } from '../agents/launch-research-agent.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';
import { database as db } from '../lib/database.js';

export async function researchProjectLaunchContext(data: JobData): Promise<void> {
  const { projectId } = data;

  // Get the project with repo analysis
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });

  if (!project || !project.repoAnalysis) {
    throw new Error(`Project ${projectId} not found or not analyzed`);
  }

  await projectProgressPublisher.phaseStart(
    projectId,
    'researching',
    'Starting agentic research loop'
  );

  const repoAnalysis = project.repoAnalysis as unknown as RepoAnalysis;
  const research = await runResearchAgent(projectId, repoAnalysis);

  // Update project with research results
  await db
    .update(schema.projects)
    .set({
      research,
      status: 'strategizing',
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  await projectProgressPublisher.phaseComplete(
    projectId,
    'researching',
    `Found ${research.competitors.length} competitors, ${research.uniqueAngles.length} angles`
  );

  console.log(
    `[Research] ${project.repoOwner}/${project.repoName}: ${research.competitors.length} competitors, audience: ${research.targetAudience.slice(0, 50)}`
  );
}
