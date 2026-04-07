import { Hono } from 'hono';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { database } from '../lib/database.js';
import { analysisJobQueue } from '../lib/job-queue-clients.js';
import { projects, webhookEvents } from '@launchkit/shared';

const githubWebhookRoutes = new Hono();

// ── Signature Verification ──

function verifyGitHubSignature(body: string, signature: string | undefined): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signature) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  if (signature.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// ── POST /api/webhooks/github — GitHub webhook receiver ──

githubWebhookRoutes.post('/github', async (c) => {
  const signature = c.req.header('x-hub-signature-256');
  const body = await c.req.text();

  // Verify webhook signature
  if (!verifyGitHubSignature(body, signature)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  let event: Record<string, any>;
  try {
    event = JSON.parse(body) as Record<string, any>;
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }
  const eventType = c.req.header('x-github-event') || 'unknown';

  // Only process push and release events
  if (!['push', 'release'].includes(eventType)) {
    return c.json({ ok: true, skipped: true, reason: 'Unhandled event type' });
  }

  // Find matching project
  const repoUrl = event.repository?.html_url;
  if (!repoUrl) {
    return c.json({ ok: true, skipped: true, reason: 'No repository URL' });
  }

  const project = await database.query.projects.findFirst({
    where: and(eq(projects.repoUrl, repoUrl), eq(projects.webhookEnabled, true)),
  });

  if (!project) {
    return c.json({ ok: true, skipped: true, reason: 'No matching project or webhooks disabled' });
  }

  // Store the webhook event
  const [webhookEvent] = await database
    .insert(webhookEvents)
    .values({
      projectId: project.id,
      eventType,
      payload: event,
      commitSha: event.after || event.release?.tag_name,
      commitMessage: event.head_commit?.message || event.release?.name,
    })
    .returning();

  // Queue the filtering decision
  await analysisJobQueue.add(
    'filter-webhook',
    {
      projectId: project.id,
      webhookEventId: webhookEvent.id,
    },
    {
      jobId: `webhook__${webhookEvent.id}`,
    }
  );

  return c.json({ ok: true, queued: true, webhookEventId: webhookEvent.id });
});

export default githubWebhookRoutes;
