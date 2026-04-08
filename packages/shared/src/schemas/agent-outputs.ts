import { z } from 'zod';
import { AssetTypeSchema } from '../enums.js';

/**
 * Schemas for the structured outputs of the simple (non-agentic)
 * Claude calls in `apps/worker/src/agents/`. Each schema is paired
 * with one `generateJSON(schema, system, user)` call site.
 *
 * The research agent does NOT use these — it goes through the Claude
 * Agent SDK and captures its result via a closure-backed terminal
 * MCP tool. These schemas are for the prompted agents that emit a
 * single JSON response and stop.
 *
 * Why these live in `@launchkit/shared` and not in
 * `apps/worker/src/lib/schemas/`
 * -------------------------------------------------------------------
 *
 * The decision shape some of these produce (e.g. `WebhookFilterDecision`)
 * is persisted to the database and read back by the dashboard. The
 * dashboard then needs to validate the same shape. Putting the schema
 * in `@launchkit/shared` gives both the worker (writer) and the
 * dashboard (reader) a single source of truth — exactly the same
 * pattern as `RepoAnalysisSchema` and the rest of the domain types.
 *
 * For the agent outputs that are purely intermediate (e.g.
 * `ImagePromptResult`, which is consumed once and discarded), the
 * shared location is still preferable because it keeps every "what
 * Claude returned" schema in one discoverable place.
 */

// ── Webhook relevance agent ─────────────────────────────────────────
//
// Decides whether a GitHub webhook event is "marketable" enough to
// trigger asset regeneration. Persisted to `webhook_events.is_marketable`
// + `filter_reasoning` + the queued generation jobs.

export const WebhookFilterDecisionSchema = z.object({
  isMarketable: z.boolean(),
  reasoning: z.string(),
  assetTypes: z.array(AssetTypeSchema),
});
export type WebhookFilterDecision = z.infer<typeof WebhookFilterDecisionSchema>;

// ── Marketing visual agent (art director) ───────────────────────────
//
// Generates an image prompt for FLUX.2 Pro. The prompt + style + the
// reasoning are returned to the caller, which then calls the fal.ai
// client. Intermediate output — not persisted as-is.

export const ImagePromptResultSchema = z.object({
  prompt: z.string(),
  style: z.string(),
  reasoning: z.string(),
});
export type ImagePromptResult = z.infer<typeof ImagePromptResultSchema>;

// ── Product video agent (video director) ────────────────────────────
//
// Plans a short product video as a sequence of shots. The shots are
// then individually rendered as still images via fal.ai and stitched
// into a Remotion `LaunchKitVideoProps`. The raw storyboard is also
// stored on the asset metadata so the dashboard can show the writer's
// outline alongside the rendered video.

export const StoryboardShotSchema = z.object({
  headline: z.string(),
  caption: z.string(),
  visualPrompt: z.string(),
  duration: z.number().positive(),
  accent: z.string().optional(),
});
export type StoryboardShot = z.infer<typeof StoryboardShotSchema>;

export const StoryboardResultSchema = z.object({
  concept: z.string(),
  shots: z.array(StoryboardShotSchema),
  voiceoverNotes: z.string(),
});
export type StoryboardResult = z.infer<typeof StoryboardResultSchema>;

// ── World Labs scene agent ──────────────────────────────────────────
//
// Plans a real-world 3D scene that showcases the product being used.
// The `worldPrompt` is fed verbatim to the World Labs Marble API; the
// `displayName` is the human-readable label surfaced in the dashboard
// and on the Marble viewer page; the `reasoning` is captured on asset
// metadata so the user understands why this particular setting was
// chosen for their product.
//
// `model` is the Marble model the worker will request. `marble-1.1` is
// the default; `marble-1.1-plus` consumes more credits but produces a
// larger world, which the agent should pick when the scene calls for
// an outdoor environment or a sprawling indoor space (open-plan
// office, warehouse, conference floor, etc.).

export const WorldLabsModelSchema = z.enum(['marble-1.1', 'marble-1.1-plus']);
export type WorldLabsModel = z.infer<typeof WorldLabsModelSchema>;

export const WorldScenePromptResultSchema = z.object({
  displayName: z.string().min(1),
  worldPrompt: z.string().min(1),
  model: WorldLabsModelSchema,
  reasoning: z.string(),
});
export type WorldScenePromptResult = z.infer<typeof WorldScenePromptResultSchema>;
