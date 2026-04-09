import type { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import {
  OperationSchema,
  WorldSchema,
  type Operation,
  type World,
} from './schemas/world-labs.js';
import { computeWorldLabsCostCents, type WorldLabsModel } from '@launchkit/shared';
import { recordCost } from '../cost-tracker.js';

/**
 * Factory-constructed World Labs (Marble) client.
 *
 * World Labs exposes a polling-based long-running operation API for
 * 3D world generation:
 *
 *   1. `POST /marble/v1/worlds:generate` returns an `Operation`
 *      envelope immediately with `done: false`.
 *   2. `GET /marble/v1/operations/{operation_id}` is polled until
 *      `done: true`. The completed operation's `response` field
 *      carries a snapshot of the generated `World` (identified by
 *      `world_id`, not `id`).
 *   3. (Optional) `GET /marble/v1/worlds/{world_id}` returns the most
 *      up-to-date version of the world DIRECTLY (not wrapped in a
 *      `{ world }`
 *      envelope — used here as a fallback when the operation snapshot
 *      is missing the canonical `world_marble_url` field.
 *
 * The full generation cycle runs ~5 minutes per the upstream docs;
 * `generateWorldScene` blocks the calling task for the duration of
 * that cycle. BullMQ concurrency limits (today) and Workflows per-task
 * timeouts (future) keep the back-pressure bounded.
 *
 * Boundary discipline
 * -------------------
 *
 * Every HTTP response goes through a Zod schema in
 * `./schemas/world-labs.ts` before any field is dereferenced. The
 * schemas use `.passthrough()` so the upstream can add fields without
 * breaking the worker, but the fields the client actually reads
 * (`done`, `response.id`, `response.world_marble_url`, …) are
 * validated up front and the parse failure naming the missing field
 * is what bubbles up — not a confusing chained-optional `undefined`
 * ten lines later.
 */

const WORLD_LABS_API_BASE = 'https://api.worldlabs.ai/marble/v1';

export interface WorldLabsClientConfig {
  apiKey: string;
  pollTimeoutSeconds: number;
  pollIntervalSeconds: number;
}

export type WorldLabsGenerateInput = {
  displayName: string;
  worldPrompt: string;
  model: WorldLabsModel;
};

export type WorldLabsGenerateResult = {
  worldId: string;
  operationId: string;
  /**
   * Direct deep link to the interactive Marble viewer for the
   * generated world. The dashboard surfaces this as the asset's
   * `mediaUrl` so a user can click through to walk the scene.
   */
  marbleUrl: string;
  thumbnailUrl: string | null;
  panoUrl: string | null;
  caption: string | null;
  splatUrl: string | null;
  colliderMeshUrl: string | null;
  /**
   * The exact prompt the API received. World Labs may recaption the
   * prompt server-side, so storing the user-facing prompt verbatim on
   * the asset metadata is what lets the regenerate path round-trip
   * the same input.
   */
  prompt: string;
  model: WorldLabsModel;
};

export interface WorldLabsClient {
  generateWorldScene(
    input: WorldLabsGenerateInput
  ): Promise<WorldLabsGenerateResult>;
}

export function createWorldLabsClient(
  config: WorldLabsClientConfig
): WorldLabsClient {
  async function worldLabsFetch<S extends z.ZodType>(input: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    schema: S;
    context: string;
  }): Promise<z.infer<S>> {
    const response = await fetch(`${WORLD_LABS_API_BASE}${input.path}`, {
      method: input.method,
      headers: {
        'WLT-Api-Key': config.apiKey,
        ...(input.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      ...(input.body !== undefined
        ? { body: JSON.stringify(input.body) }
        : {}),
    });

    if (!response.ok) {
      // Pull the error body but bound the included slice so a multi-MB
      // HTML 500 page never lands in our log aggregator. World Labs
      // returns JSON `{ error }` payloads on documented failures and an
      // upstream-edge HTML page on infrastructure errors; both compress
      // fine into the first 200 chars for triage.
      const message = await response.text().catch(() => '<no body>');
      throw new Error(
        `World Labs ${input.context} failed (${response.status}): ${message.slice(0, 200)}`
      );
    }

    const payload: unknown = await response.json();
    const parsed = input.schema.safeParse(payload);
    if (!parsed.success) {
      const formatted = parsed.error.issues
        .map((issue) => {
          const pathStr =
            issue.path.length > 0 ? issue.path.join('.') : '<root>';
          return `${pathStr}: ${issue.message}`;
        })
        .join('; ');
      throw new Error(
        `World Labs ${input.context} response did not match expected shape: ${formatted}`
      );
    }
    return parsed.data;
  }

  async function startGeneration(
    input: WorldLabsGenerateInput
  ): Promise<Operation> {
    return worldLabsFetch({
      method: 'POST',
      path: '/worlds:generate',
      body: {
        display_name: input.displayName,
        model: input.model,
        world_prompt: {
          type: 'text',
          text_prompt: input.worldPrompt,
        },
      },
      schema: OperationSchema,
      context: 'world generation start',
    });
  }

  async function pollOperation(operationId: string): Promise<Operation> {
    const timeoutMs = config.pollTimeoutSeconds * 1000;
    const intervalMs = config.pollIntervalSeconds * 1000;
    const deadline = Date.now() + timeoutMs;

    // First sleep before the first poll: the operation envelope returned
    // by `POST :generate` is always `done: false`, so an immediate poll
    // would just confirm what we already know. Wait one interval, then
    // start the loop.
    await delay(intervalMs);

    while (Date.now() < deadline) {
      const operation = await worldLabsFetch({
        method: 'GET',
        path: `/operations/${encodeURIComponent(operationId)}`,
        schema: OperationSchema,
        context: `operation poll (${operationId})`,
      });

      if (operation.done) {
        if (operation.error) {
          const code = operation.error.code ?? 'unknown';
          const message = operation.error.message ?? '<no message>';
          throw new Error(
            `World Labs operation ${operationId} failed (${String(code)}): ${message}`
          );
        }
        return operation;
      }

      console.log(
        `[world-labs] operation ${operationId} in progress: ${
          operation.metadata?.progress?.description ?? 'pending'
        }`
      );
      await delay(intervalMs);
    }

    throw new Error(
      `World Labs operation ${operationId} did not complete within ${config.pollTimeoutSeconds}s`
    );
  }

  async function fetchCanonicalWorld(worldId: string): Promise<World> {
    // Marble's GET /worlds/{world_id} returns the World object
    // DIRECTLY, not wrapped in a `{ world: ... }` envelope. The docs
    // at https://docs.worldlabs.ai/api/reference/worlds/get.md are
    // explicit: "The World object is returned directly without a
    // wrapper object." An earlier version of this client expected
    // an envelope and it was wrong — verified against the real API
    // after a Marble render surfaced the schema drift.
    return worldLabsFetch({
      method: 'GET',
      path: `/worlds/${encodeURIComponent(worldId)}`,
      schema: WorldSchema,
      context: `world fetch (${worldId})`,
    });
  }

  function buildPublicMarbleUrl(worldId: string): string {
    // The docs guarantee a stable public viewer URL at this path so the
    // client does not need to construct it from the (sometimes-null)
    // `world_marble_url` field on the snapshot. Use the canonical field
    // when present, fall back to the synthesized URL otherwise.
    return `https://marble.worldlabs.ai/world/${worldId}`;
  }

  /**
   * Kick off a Marble world generation, poll until completion, and
   * normalise the result into a single object the consumer can write
   * to the asset row. Throws on every documented failure mode (HTTP
   * error, schema mismatch, polling timeout, operation error) with a
   * structured message naming the failure surface.
   */
  async function generateWorldScene(
    input: WorldLabsGenerateInput
  ): Promise<WorldLabsGenerateResult> {
    const startOperation = await startGeneration(input);
    console.log(
      `[world-labs] started world generation operation ${startOperation.operation_id}`
    );

    const completedOperation = await pollOperation(
      startOperation.operation_id
    );

    // The completed operation's `response` field is the canonical
    // success path. The docs note that some fields on the snapshot may
    // be empty (display_name, world_prompt, model, …); we re-fetch the
    // canonical world only when the snapshot is missing the
    // `world_marble_url` we surface as the asset mediaUrl.
    const snapshot = completedOperation.response;
    if (!snapshot) {
      throw new Error(
        `World Labs operation ${completedOperation.operation_id} reported done=true but carried no response payload`
      );
    }

    // Re-validate the snapshot through `WorldSchema` so an `as` cast
    // is unnecessary at the dereference points below. Even though
    // `OperationSchema.response` is already validated, the explicit
    // re-parse here documents the boundary and keeps the `World` type
    // narrowing in one place.
    const world = WorldSchema.parse(snapshot);

    let canonicalUrl = world.world_marble_url ?? null;
    if (!canonicalUrl) {
      // Snapshot was missing the URL — fetch the canonical world to
      // grab the marble URL from the direct-body response. We only
      // re-fetch on the missing-URL path so the happy path stays at
      // one upstream call after polling.
      try {
        const canonical = await fetchCanonicalWorld(world.world_id);
        canonicalUrl = canonical.world_marble_url ?? null;
      } catch (err) {
        // Don't fail the whole generation just because the canonical
        // re-fetch hiccupped — fall back to the synthesized public URL
        // and log the underlying cause for triage.
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[world-labs] canonical world fetch failed for ${world.world_id}, falling back to public URL: ${message}`
        );
      }
    }

    const marbleUrl = canonicalUrl ?? buildPublicMarbleUrl(world.world_id);
    const assets = world.assets ?? null;
    const splats = assets?.splats?.spz_urls ?? null;
    const splatUrl =
      splats?.['500k'] ?? splats?.['100k'] ?? splats?.full_res ?? null;

    // Record the fixed per-world cost for the successful generation.
    // Every failure path above (polling timeout, operation error,
    // HTTP error, schema mismatch) throws before reaching this line,
    // so we only charge for completed worlds. The canonical-world
    // re-fetch warn-and-continue branch never throws — a failed
    // re-fetch is degraded-but-still-usable, not a generation
    // failure, so it correctly still counts as a completed world.
    recordCost({
      provider: 'world_labs',
      operation: 'marble-generate',
      costCents: computeWorldLabsCostCents(input.model),
      metadata: {
        worldId: world.world_id,
        operationId: completedOperation.operation_id,
        model: input.model,
      },
    });

    return {
      worldId: world.world_id,
      operationId: completedOperation.operation_id,
      marbleUrl,
      thumbnailUrl: assets?.thumbnail_url ?? null,
      panoUrl: assets?.imagery?.pano_url ?? null,
      caption: assets?.caption ?? null,
      splatUrl,
      colliderMeshUrl: assets?.mesh?.collider_mesh_url ?? null,
      prompt: input.worldPrompt,
      model: input.model,
    };
  }

  return {
    generateWorldScene,
  };
}
