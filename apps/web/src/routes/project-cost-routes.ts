import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import {
  assetCostEvents,
  ProjectCostsResponseSchema,
} from '@launchkit/shared';
import { database } from '../lib/database.js';
import { parseUuidParam, invalidUuidResponse } from '../lib/validate-uuid.js';

/**
 * Project-level cost aggregation route. Serves the dashboard's
 * "Generated for $X.XX" chip and the per-provider breakdown modal.
 *
 * One-shot aggregate
 * ------------------
 *
 * The handler runs a single `SUM() GROUP BY provider` query against
 * `asset_cost_events` and returns the per-provider rows alongside a
 * grand total. A per-asset query is intentionally NOT exposed — the
 * per-asset surface lives on `assets.cost_cents` (denormalized by
 * `persistCostEvents`) and the dashboard reads it off the existing
 * project detail response. Keeping the two surfaces distinct means
 * the dashboard can render the chip in one round trip and the
 * per-asset labels in zero additional round trips.
 *
 * Boundary validation
 * -------------------
 *
 * The response is parsed through `ProjectCostsResponseSchema` before
 * return so a schema invariant violation (unknown provider string,
 * malformed cents count) shows up as a structured 500 instead of
 * rendering garbage on the dashboard. The schema's provider enum is
 * the source of truth for "what providers exist" — if a future
 * provider lands on the `asset_cost_events.provider` column without
 * a corresponding enum update, this handler fails fast at the parse
 * step rather than leaking an unknown string to the UI.
 *
 * Mounted at `/api/projects/:projectId/costs` in `apps/web/src/index.ts`
 * alongside the existing `projectApiRoutes` entries.
 */

const projectCostRoutes = new Hono();

projectCostRoutes.get('/:projectId/costs', async (c) => {
  const projectId = parseUuidParam(c, 'projectId');
  if (!projectId) return invalidUuidResponse(c);

  // Per-provider aggregate. The `::integer` cast is load-bearing:
  // Postgres's default numeric type for SUM() is `numeric`, which
  // drizzle maps to a string on the way out. Coercing to integer in
  // SQL keeps the return type numeric at the application layer and
  // avoids a parseInt round-trip (and the error path that comes
  // with it).
  const rows = await database
    .select({
      provider: assetCostEvents.provider,
      totalCents: sql<number>`COALESCE(SUM(${assetCostEvents.costCents}), 0)::integer`,
    })
    .from(assetCostEvents)
    .where(eq(assetCostEvents.projectId, projectId))
    .groupBy(assetCostEvents.provider);

  // Grand total = sum of per-provider totals. A separate
  // `SUM(cost_cents) WHERE project_id = ?` query would also work but
  // would double the round-trips for zero gain — summing the same
  // numbers twice on the server is cheaper than a second DB call.
  const grandTotalCents = rows.reduce(
    (sum, row) => sum + row.totalCents,
    0
  );

  // The drizzle row's `provider` column is typed as `string` because
  // the DB column is a plain `varchar(32)` rather than a pgEnum. Build
  // the response as an unknown-typed literal and hand it to Zod —
  // the schema's closed provider enum is the boundary check, so a
  // row whose `provider` value is not in the set surfaces as a
  // structured 500 at the `safeParse` below rather than leaking
  // garbage onto the dashboard. Typing the literal via the response
  // type (and casting row.provider to narrow it) would shortcut the
  // boundary we want Zod to enforce — so we leave the types open
  // until the parse step.
  const responseCandidate: unknown = {
    projectId,
    totalCents: grandTotalCents,
    byProvider: rows.map((row) => ({
      provider: row.provider,
      totalCents: row.totalCents,
    })),
  };

  const parsed = ProjectCostsResponseSchema.safeParse(responseCandidate);
  if (!parsed.success) {
    // Structured error at the server boundary so the failure surfaces
    // as a debuggable 500 with a named field path rather than a
    // confusing client-side crash.
    const formatted = parsed.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    console.error(
      `[project-cost-routes] response schema validation failed for project ${projectId}: ${formatted}`
    );
    return c.json(
      {
        error:
          'Internal server error: cost aggregation response did not match expected shape',
        code: 'cost_response_schema_mismatch',
      },
      500
    );
  }

  return c.json(parsed.data);
});

export default projectCostRoutes;
