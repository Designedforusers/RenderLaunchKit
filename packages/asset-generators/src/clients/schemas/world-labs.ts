import { z } from 'zod';

/**
 * Zod schemas for the World Labs (Marble) API responses we consume in
 * `./clients/world-labs.ts`.
 *
 * The World Labs API is a polling-based long-running operation API:
 *
 *   1. `POST /marble/v1/worlds:generate` returns an `Operation` with
 *      `done: false` immediately.
 *   2. `GET /marble/v1/operations/{operation_id}` is polled until
 *      `done: true`, at which point the completed operation's
 *      `response` field carries a snapshot of the generated `World`.
 *   3. (Optional) `GET /marble/v1/worlds/{world_id}` returns the most
 *      up-to-date version of the world wrapped in a `{ world }` envelope.
 *
 * Each schema is `.passthrough()` so we tolerate extra fields the
 * upstream may add without forcing a parse failure on every minor
 * release. We only validate the fields the worker actually reads;
 * the rest of the response is ignored.
 *
 * The `response` and `metadata` shapes on an in-progress operation
 * are `null`/`undefined`. We model them as `.nullish()` so the same
 * schema parses both the in-flight and completed forms — the polling
 * helper checks `done` and only dereferences `response` when it's set.
 */

// ── Generated world (snapshot or canonical fetch) ─────────────────────
//
// Both the operation `response` field and the `GET /worlds/{id}`
// envelope return objects with this shape. The interesting fields for
// LaunchKit are:
//
//   - `id`            — used to build the public viewer URL
//   - `assets.thumbnail_url` — surfaced as the asset's mediaUrl thumbnail
//   - `assets.caption`       — stored on metadata so the dashboard
//                              can render the AI caption alongside the
//                              link out to Marble
//   - `assets.imagery.pano_url` — fallback panorama for the dashboard
//                                 when the user's browser cannot render
//                                 a Gaussian-splat scene inline
//   - `world_marble_url`     — direct deep link to the Marble viewer

const WorldSplatsSchema = z
  .object({
    spz_urls: z
      .object({
        '100k': z.string().optional(),
        '500k': z.string().optional(),
        full_res: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const WorldMeshSchema = z
  .object({
    collider_mesh_url: z.string().optional(),
  })
  .passthrough();

const WorldImagerySchema = z
  .object({
    pano_url: z.string().optional(),
  })
  .passthrough();

export const WorldAssetsSchema = z
  .object({
    caption: z.string().nullish(),
    thumbnail_url: z.string().nullish(),
    splats: WorldSplatsSchema.nullish(),
    mesh: WorldMeshSchema.nullish(),
    imagery: WorldImagerySchema.nullish(),
  })
  .passthrough();
export type WorldAssets = z.infer<typeof WorldAssetsSchema>;

export const WorldSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string().nullish(),
    world_marble_url: z.string().nullish(),
    assets: WorldAssetsSchema.nullish(),
  })
  .passthrough();
export type World = z.infer<typeof WorldSchema>;

// ── Operation envelope ────────────────────────────────────────────────
//
// `POST /worlds:generate` and `GET /operations/{id}` both return this
// shape. `done` is the discriminator: while `false`, `response` is
// `null`; once `true`, `response` carries a `World` snapshot (which
// may have several null/empty fields per the API docs — those are
// re-fetched from `GET /worlds/{id}` if the worker needs them).

const OperationProgressSchema = z
  .object({
    status: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

export const OperationMetadataSchema = z
  .object({
    progress: OperationProgressSchema.nullish(),
    world_id: z.string().nullish(),
  })
  .passthrough();

const OperationErrorSchema = z
  .object({
    code: z.union([z.string(), z.number()]).optional(),
    message: z.string().optional(),
  })
  .passthrough();

export const OperationSchema = z
  .object({
    operation_id: z.string().min(1),
    done: z.boolean(),
    error: OperationErrorSchema.nullish(),
    metadata: OperationMetadataSchema.nullish(),
    response: WorldSchema.nullish(),
  })
  .passthrough();
export type Operation = z.infer<typeof OperationSchema>;

// ── Canonical world fetch envelope ────────────────────────────────────
//
// `GET /marble/v1/worlds/{world_id}` wraps the world in a `{ world }`
// object — distinct from the operation `response` field, which is
// the world directly. We model both shapes so the client can normalise
// to a single `World` regardless of which surface produced it.

export const WorldEnvelopeSchema = z
  .object({
    world: WorldSchema,
  })
  .passthrough();
export type WorldEnvelope = z.infer<typeof WorldEnvelopeSchema>;
