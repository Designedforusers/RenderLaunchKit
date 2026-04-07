import { Queue } from 'bullmq';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import { GITHUB_API_BASE, JOB_NAMES, QUEUE_NAMES } from '@launchkit/shared';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
const analysisQueue = new Queue(QUEUE_NAMES.ANALYSIS, {
  connection: {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port || '6379', 10),
    password: redisUrl.password || undefined,
  },
});

function githubHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'LaunchKit/1.0',
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
}

/**
 * Check webhook-enabled repos for new activity.
 * Runs periodically as a supplement to webhooks (in case webhooks fail).
 */
export async function syncGitHubProjectActivity(): Promise<void> {
  console.log('[Cron:SyncGitHubProjectActivity] Checking for repo updates...');

  const webhookProjects = await db.query.projects.findMany({
    where: and(
      eq(schema.projects.webhookEnabled, true),
      eq(schema.projects.status, 'complete')
    ),
  });

  if (webhookProjects.length === 0) {
    console.log(
      '[Cron:SyncGitHubProjectActivity] No webhook-enabled projects to check'
    );
    return;
  }

  for (const project of webhookProjects) {
    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/repos/${project.repoOwner}/${project.repoName}/commits?per_page=1`,
        {
          headers: githubHeaders(),
        }
      );

      if (!response.ok) continue;

      const [latestCommit] = (await response.json()) as Array<{
        sha: string;
        commit: {
          message: string;
          author: { name: string };
        };
      }>;
      if (!latestCommit) continue;

      const latestSha = latestCommit.sha;

      if (!project.lastCommitSha) {
        await db
          .update(schema.projects)
          .set({ lastCommitSha: latestSha, updatedAt: new Date() })
          .where(eq(schema.projects.id, project.id));
        continue;
      }

      if (project.lastCommitSha && project.lastCommitSha !== latestSha) {
        console.log(
          `[Cron:SyncGitHubProjectActivity] New commit detected for ${project.repoOwner}/${project.repoName}: ${latestSha.slice(0, 7)}`
        );

        // Store webhook event for new commit
        const [webhookEvent] = await db
          .insert(schema.webhookEvents)
          .values({
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
          })
          .returning();

        await analysisQueue.add(
          JOB_NAMES.FILTER_WEBHOOK,
          {
            projectId: project.id,
            webhookEventId: webhookEvent.id,
          },
          {
            jobId: `cron-webhook__${project.id}__${latestSha}`,
          }
        );

        // Update last known commit
        await db
          .update(schema.projects)
          .set({ lastCommitSha: latestSha, updatedAt: new Date() })
          .where(eq(schema.projects.id, project.id));
      }
    } catch (err) {
      console.error(
        `[Cron:SyncGitHubProjectActivity] Error checking ${project.repoOwner}/${project.repoName}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[Cron:SyncGitHubProjectActivity] Checked ${webhookProjects.length} repos`
  );
}
