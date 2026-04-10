import { Queue } from 'bullmq';
import { eq, and } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import { GITHUB_API_BASE, JOB_NAMES, QUEUE_NAMES, parseRedisUrl } from '@launchkit/shared';
import { database } from './database.js';
import { env } from './env.js';

const analysisQueue = new Queue(QUEUE_NAMES.ANALYSIS, {
  connection: parseRedisUrl(env.REDIS_URL),
});

function githubHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'LaunchKit/1.0',
    ...(env.GITHUB_TOKEN
      ? { Authorization: `token ${env.GITHUB_TOKEN}` }
      : {}),
  };
}

/**
 * Check webhook-enabled repos for new activity.
 * Runs periodically as a supplement to webhooks (in case webhooks fail).
 */
export async function syncGitHubProjectActivity(): Promise<void> {
  console.log('[Cron:SyncGitHubProjectActivity] Checking for repo updates...');

  const webhookProjects = await database.query.projects.findMany({
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
        await database
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
        const [webhookEvent] = await database
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

        if (!webhookEvent) {
          // Drizzle's `.returning()` is typed as `T[]`; the strict-flag
          // pass forces us to narrow even though the insert above always
          // produces exactly one row in practice.
          //
          // Throwing here (instead of returning a 500 like the web
          // routes) is intentional: cron jobs run under BullMQ's retry
          // policy, so a thrown error escalates to a retry, while a
          // silent skip would lose the event. The web request handlers
          // do not have a retry surface, so they return 500 to the
          // client and rely on the caller to surface the failure.
          throw new Error(
            `Internal error: cron-derived webhook insert returned no row for project ${project.id}`
          );
        }

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
        await database
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
