import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { database } from '../lib/database.js';
import { analysisJobQueue } from '../lib/job-queue-clients.js';
import {
  GitHubWebhookPayloadSchema,
  projects,
  webhookEvents,
} from '@launchkit/shared';
import { env } from '../env.js';

const githubWebhookRoutes = new Hono();

// 1 MB ceiling on the webhook payload. GitHub's documented max delivery
// size is much smaller than this (typical push events are <100 KB), so any
// request that exceeds 1 MB is either a misconfiguration or an abuse
// attempt. We reject before reading the body into memory.
const WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024;

// ── Signature Verification ──

function verifyGitHubSignature(body: string, signature: string | undefined): boolean {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signature) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  // `timingSafeEqual` throws on mismatched lengths. The early length check
  // is therefore load-bearing, not just an optimization — without it the
  // function would throw on a wrong-size signature instead of returning false.
  if (signature.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// ── POST /api/webhooks/github — GitHub webhook receiver ──

githubWebhookRoutes.post(
  '/github',
  bodyLimit({
    maxSize: WEBHOOK_BODY_LIMIT_BYTES,
    onError: (c) => c.json({ error: 'Webhook payload too large' }, 413),
  }),
  async (c) => {
    const signature = c.req.header('x-hub-signature-256');
    const deliveryId = c.req.header('x-github-delivery');
    const body = await c.req.text();

    // Verify webhook signature.
    if (!verifyGitHubSignature(body, signature)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Replay protection: every GitHub delivery (including manual
    // redeliveries from the UI) carries a unique x-github-delivery UUID.
    // We require it and dedupe on it before doing any work.
    if (!deliveryId) {
      return c.json({ error: 'Missing x-github-delivery header' }, 400);
    }

    const alreadyProcessed = await database.query.webhookEvents.findFirst({
      where: eq(webhookEvents.deliveryId, deliveryId),
    });
    if (alreadyProcessed) {
      return c.json({ ok: true, deduped: true, deliveryId });
    }

    // Parse the JSON envelope first, then validate it against the
    // GitHub webhook schema. The schema covers only the fields the
    // receiver actually reads (`repository.html_url`, `after`,
    // `head_commit.message`, `release.tag_name`, `release.name`) and
    // passes everything else through, so a payload format change
    // upstream cannot break this route unless one of those specific
    // fields disappears.
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(body);
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    const parsed = GitHubWebhookPayloadSchema.safeParse(rawJson);
    if (!parsed.success) {
      const formatted = parsed.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
          return `${path}: ${issue.message}`;
        })
        .join('; ');
      return c.json(
        { error: `Webhook payload did not match the expected shape: ${formatted}` },
        400
      );
    }
    const event = parsed.data;
    const eventType = c.req.header('x-github-event') ?? 'unknown';

    // Only process push and release events.
    if (!['push', 'release'].includes(eventType)) {
      return c.json({ ok: true, skipped: true, reason: 'Unhandled event type' });
    }

    // Find matching project. `repository.html_url` is a required
    // field on `GitHubWebhookPayloadSchema`, so the safeParse above
    // already rejected any payload without it — no fallback guard
    // needed here.
    // Lowercase the incoming URL so it matches the canonical form
    // stored by project creation (which lowercases owner/name).
    const repoUrl = event.repository.html_url.toLowerCase();

    const project = await database.query.projects.findFirst({
      where: and(eq(projects.repoUrl, repoUrl), eq(projects.webhookEnabled, true)),
    });

    if (!project) {
      return c.json({ ok: true, skipped: true, reason: 'No matching project or webhooks disabled' });
    }

    // Store the webhook event.
    const [webhookEvent] = await database
      .insert(webhookEvents)
      .values({
        projectId: project.id,
        deliveryId,
        eventType,
        payload: event,
        commitSha: event.after ?? event.release?.tag_name,
        commitMessage: event.head_commit?.message ?? event.release?.name,
      })
      .returning();

    if (!webhookEvent) {
      // Drizzle's `.returning()` is typed as `T[]`, so the strict
      // flags require this guard. Reaching it means the insert was
      // accepted but no row came back — a server-side invariant
      // violation, not a request validation problem. The 500 carries
      // a precise message so the response body is not mistaken for a
      // 4xx-style validation failure.
      return c.json(
        { error: 'Internal error: webhook insert returned no row' },
        500
      );
    }

    // Queue the filtering decision. If the enqueue fails, remove
    // the webhook_events row so GitHub's automatic redelivery is
    // not deduped against a delivery we never actually processed.
    try {
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
    } catch {
      await database.delete(webhookEvents).where(eq(webhookEvents.id, webhookEvent.id));
      return c.json(
        { error: 'Failed to enqueue webhook processing — GitHub will redeliver' },
        503
      );
    }

    return c.json({ ok: true, queued: true, webhookEventId: webhookEvent.id });
  }
);

export default githubWebhookRoutes;
