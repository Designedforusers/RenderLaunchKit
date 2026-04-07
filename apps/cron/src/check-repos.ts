import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import { GITHUB_API_BASE } from '@launchkit/shared';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

/**
 * Check webhook-enabled repos for new activity.
 * Runs periodically as a supplement to webhooks (in case webhooks fail).
 */
export async function checkRepos(): Promise<void> {
  console.log('[Cron:CheckRepos] Checking for repo updates...');

  const webhookProjects = await db.query.projects.findMany({
    where: and(
      eq(schema.projects.webhookEnabled, true),
      eq(schema.projects.status, 'complete')
    ),
  });

  if (webhookProjects.length === 0) {
    console.log('[Cron:CheckRepos] No webhook-enabled projects to check');
    return;
  }

  for (const project of webhookProjects) {
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${project.repoOwner}/${project.repoName}/commits?per_page=1`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'LaunchKit/1.0',
          },
        }
      );

      if (!response.ok) continue;

      const [latestCommit] = await response.json();
      if (!latestCommit) continue;

      const latestSha = latestCommit.sha;

      if (project.lastCommitSha && project.lastCommitSha !== latestSha) {
        console.log(
          `[Cron:CheckRepos] New commit detected for ${project.repoOwner}/${project.repoName}: ${latestSha.slice(0, 7)}`
        );

        // Store webhook event for new commit
        await db.insert(schema.webhookEvents).values({
          projectId: project.id,
          eventType: 'push',
          payload: {
            source: 'cron-poll',
            commit: {
              sha: latestSha,
              message: latestCommit.commit.message,
              author: latestCommit.commit.author.name,
            },
          },
          commitSha: latestSha,
          commitMessage: latestCommit.commit.message,
        });

        // Update last known commit
        await db
          .update(schema.projects)
          .set({ lastCommitSha: latestSha, updatedAt: new Date() })
          .where(eq(schema.projects.id, project.id));
      }
    } catch (err) {
      console.error(
        `[Cron:CheckRepos] Error checking ${project.repoOwner}/${project.repoName}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(`[Cron:CheckRepos] Checked ${webhookProjects.length} repos`);
}
