import { z } from 'zod';

/**
 * Model registry: the canonical list of available AI models for media
 * generation, and the auto-router that selects the best model for a
 * given asset type and content signal.
 *
 * The registry is read by:
 *   - The dashboard's model selector dropdown (labels, badges, cost)
 *   - The auto-router in `dispatch-asset.ts` (capability matching)
 *   - The pricing module (cost display on the dashboard)
 *
 * Adding a new model: add an entry to `IMAGE_MODELS` or `VIDEO_MODELS`,
 * then wire the corresponding fal client endpoint in
 * `packages/asset-generators/src/clients/fal.ts`.
 */

// ── Image model IDs ────────────────────────────────────────────────

export const ImageModelIdSchema = z.enum([
  'auto',
  'flux-pro-ultra',
  'nano-banana-pro',
]);
export type ImageModelId = z.infer<typeof ImageModelIdSchema>;

// ── Video model IDs ────────────────────────────────────────────────

export const VideoModelIdSchema = z.enum([
  'auto',
  'kling-v3',
  'seedance-2',
]);
export type VideoModelId = z.infer<typeof VideoModelIdSchema>;

// ── Model preferences (stored in asset metadata) ───────────────────

export const ModelPreferencesSchema = z.object({
  imageModel: ImageModelIdSchema.optional(),
  videoModel: VideoModelIdSchema.optional(),
});
export type ModelPreferences = z.infer<typeof ModelPreferencesSchema>;

// ── Model metadata (for UI rendering) ──────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  badge: string;
  description: string;
  costLabel: string;
  strengths: readonly string[];
}

export const IMAGE_MODELS: readonly ModelInfo[] = [
  {
    id: 'flux-pro-ultra',
    name: 'FLUX Pro Ultra',
    badge: 'reliable',
    description: 'Fast, consistent images with strong composition',
    costLabel: '$0.06',
    strengths: ['photorealism', 'speed', 'consistency'],
  },
  {
    id: 'nano-banana-pro',
    name: 'Gemini Pro Image',
    badge: 'best text',
    description: 'Superior text rendering and semantic understanding',
    costLabel: '$0.15',
    strengths: ['text-rendering', 'semantic-understanding', 'character-consistency'],
  },
] as const;

export const VIDEO_MODELS: readonly ModelInfo[] = [
  {
    id: 'kling-v3',
    name: 'Kling 3.0',
    badge: 'recommended',
    description: '1080p cinematic video with multi-shot support',
    costLabel: '$0.17/s',
    strengths: ['cinematic', '1080p', 'multi-shot', 'character-consistency'],
  },
  {
    id: 'seedance-2',
    name: 'Seedance 2.0',
    badge: 'native audio',
    description: 'Built-in audio synthesis and strong motion physics',
    costLabel: '$0.24/s',
    strengths: ['native-audio', 'motion', 'physics', 'multi-shot'],
  },
] as const;

// ── Auto-router ────────────────────────────────────────────────────

export interface AutoRouterContext {
  assetType: string;
  generationInstructions: string;
  tone?: string;
}

/**
 * Select the best image model for the given asset context.
 *
 * Routing heuristics:
 *   - Social cards and OG images with text-heavy instructions →
 *     Nano Banana Pro (Gemini's text rendering is best-in-class)
 *   - Everything else → FLUX Pro Ultra (fast, cheap, reliable)
 */
export function autoSelectImageModel(ctx: AutoRouterContext): Exclude<ImageModelId, 'auto'> {
  const instructions = ctx.generationInstructions.toLowerCase();

  // Nano Banana Pro excels at text-in-image rendering. Route there
  // when the instructions suggest the image needs readable text.
  const textSignals = [
    'text', 'typography', 'headline', 'tagline', 'slogan',
    'quote', 'caption', 'label', 'title card', 'announcement',
    'logo', 'wordmark', 'lettering',
  ];
  const hasTextSignal = textSignals.some((s) => instructions.includes(s));

  if (hasTextSignal) {
    return 'nano-banana-pro';
  }

  // FLUX Pro Ultra is the reliable default — fast, cheap, and
  // consistently good for marketing visuals without text.
  return 'flux-pro-ultra';
}

/**
 * Select the best video model for the given asset context.
 *
 * Routing heuristics:
 *   - Assets needing native audio or strong motion physics →
 *     Seedance 2.0 (built-in audio, better motion simulation)
 *   - Everything else → Kling v3 (1080p, cheaper, character refs)
 */
export function autoSelectVideoModel(ctx: AutoRouterContext): Exclude<VideoModelId, 'auto'> {
  const instructions = ctx.generationInstructions.toLowerCase();

  // Seedance 2.0 when the instructions suggest audio-with-video or
  // complex motion/physics are important.
  const seedanceSignals = [
    'audio', 'sound', 'music', 'dialogue', 'speaking',
    'lip sync', 'narration', 'voiceover in video',
    'physics', 'fluid', 'particle', 'explosion', 'dynamic motion',
    'fast motion', 'action sequence',
  ];
  const hasSeedanceSignal = seedanceSignals.some((s) => instructions.includes(s));

  if (hasSeedanceSignal) {
    return 'seedance-2';
  }

  // Kling v3 is the default — 1080p, cheaper, and excellent for
  // cinematic product launch videos.
  return 'kling-v3';
}

/**
 * Resolve a model preference to a concrete model ID. If the
 * preference is `'auto'` or `undefined`, the auto-router picks.
 */
export function resolveImageModel(
  preference: ImageModelId | undefined,
  ctx: AutoRouterContext
): Exclude<ImageModelId, 'auto'> {
  if (preference !== undefined && preference !== 'auto') {
    return preference;
  }
  return autoSelectImageModel(ctx);
}

export function resolveVideoModel(
  preference: VideoModelId | undefined,
  ctx: AutoRouterContext
): Exclude<VideoModelId, 'auto'> {
  if (preference !== undefined && preference !== 'auto') {
    return preference;
  }
  return autoSelectVideoModel(ctx);
}
