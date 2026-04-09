import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import { JOB_NAMES, QUEUE_CONFIG, QUEUE_NAMES } from '@launchkit/shared';
import { processPikaInvite } from './processors/process-pika-invite.js';
import { database as db, databasePool } from './lib/database.js';
import { redisConnection as connection } from './lib/job-queues.js';
import { env } from './env.js';

/**
 * Dedicated entry point for the `launchkit-pika-worker` Render
 * service. This file compiles to `dist/index.pika.js` alongside the
 * shared worker's `dist/index.js`; `render.yaml` has two services
 * pointing at the same workspace with different `startCommand`s.
 *
 * Why a second entry point instead of a separate workspace
 * --------------------------------------------------------
 *
 * The dedicated Pika worker needs ~50 lines of wiring: one BullMQ
 * Worker, the existing `processPikaInvite` processor, the shared
 * database + Redis clients, and graceful shutdown. Everything else
 * it needs already lives in `apps/worker/src/` (the subprocess
 * wrapper, the system prompt builder, the env module, the job
 * logging helpers). Creating a whole new workspace with its own
 * package.json, tsconfig, and node_modules just to host these 50
 * lines would be pure ceremony — and would force a cross-workspace
 * import chain that TypeScript would hate.
 *
 * A second entry point in the SAME workspace gets us:
 *   - Zero code duplication — the processor, subprocess wrapper,
 *     and system prompt builder are imported directly from
 *     `./processors/` and `./lib/`, not copied.
 *   - Zero new dependencies — the workspace's existing
 *     package.json already lists every dep the invite path needs.
 *   - Zero new tsconfig plumbing — tsc compiles both entry points
 *     into `dist/` in one build pass.
 *
 * What the pika-worker service does NOT register
 * ----------------------------------------------
 *
 * This worker process registers ONLY the PIKA_INVITE queue's
 * Worker. It deliberately does NOT consume:
 *
 *   - analysis / review / trending queues (handled by the shared
 *     `launchkit-worker` service)
 *   - `pika-poll` / `pika-leave` jobs on the PIKA_CONTROL queue
 *     (handled by the shared worker — they're pure-TS single-HTTP-
 *     call jobs that do not warrant a dedicated dyno)
 *
 * The ONLY thing this dyno does is spawn the vendored Python CLI
 * for the ~90-second join handshake. Its entire purpose is to be
 * a warm, single-purpose event loop ready to `child_process.spawn`
 * the moment a PIKA_INVITE job arrives on Redis. Click → spawn
 * latency is <100 ms because the dyno has nothing else to do.
 */

const pikaInviteWorker = new Worker(
  QUEUE_NAMES.PIKA_INVITE,
  async (job) => {
    const startTime = Date.now();
    console.log(
      `[PikaInviteWorker] Processing ${job.name} (job id: ${job.id ?? '<unknown>'})`
    );

    // Record the invite job start in the jobs table for audit.
    // Failures on this insert are non-blocking — the invite itself
    // runs regardless, and the `[PikaInvite]` log in the processor
    // carries the full forensic trail for anything that goes wrong.
    try {
      await db.insert(schema.jobs).values({
        projectId:
          typeof job.data === 'object' &&
          job.data !== null &&
          'projectId' in job.data &&
          typeof (job.data as { projectId?: unknown }).projectId === 'string'
            ? (job.data as { projectId: string }).projectId
            : '',
        bullmqJobId: job.id,
        name: job.name,
        status: 'active',
        startedAt: new Date(),
      });
    } catch (err) {
      console.warn(
        `[PikaInviteWorker] failed to write job start row (non-blocking):`,
        err instanceof Error ? err.message : String(err)
      );
    }

    try {
      if (job.name === JOB_NAMES.PIKA_INVITE) {
        await processPikaInvite(job);
      } else {
        console.warn(
          `[PikaInviteWorker] unexpected job name "${job.name}" on PIKA_INVITE queue — skipping`
        );
      }

      await db
        .update(schema.jobs)
        .set({
          status: 'completed',
          duration: Date.now() - startTime,
          completedAt: new Date(),
        })
        .where(eq(schema.jobs.bullmqJobId, job.id ?? ''));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await db
        .update(schema.jobs)
        .set({
          status: 'failed',
          error: error.message,
          duration: Date.now() - startTime,
          attempts: job.attemptsMade + 1,
        })
        .where(eq(schema.jobs.bullmqJobId, job.id ?? ''));
      throw err;
    }
  },
  {
    connection,
    concurrency: QUEUE_CONFIG[QUEUE_NAMES.PIKA_INVITE].concurrency,
  }
);

// ── Event handlers ──

pikaInviteWorker.on('completed', (job) => {
  console.log(
    `[pika-invite] Job ${job.name}:${job.id ?? '<unknown>'} completed`
  );
});

pikaInviteWorker.on('failed', (job, err) => {
  const jobName = job?.name ?? '<unknown>';
  const jobId = job?.id ?? '<unknown>';
  console.error(
    `[pika-invite] Job ${jobName}:${jobId} failed:`,
    err.message
  );
});

pikaInviteWorker.on('error', (err) => {
  console.error('[pika-invite] Worker error:', err.message);
});

// ── Startup banner ──

console.log(`
╔══════════════════════════════════════════════════════╗
║  LaunchKit Pika Worker Service                       ║
║  Queue: pika-invite (dedicated, single-purpose)      ║
║  Python subprocess: vendored pika CLI                ║
║  Env: ${env.NODE_ENV.padEnd(46)}║
╚══════════════════════════════════════════════════════╝
`);

// ── Graceful shutdown ──

async function shutdown(): Promise<void> {
  console.log('[PikaInviteWorker] Shutting down gracefully...');
  await pikaInviteWorker.close();
  await databasePool.end();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
