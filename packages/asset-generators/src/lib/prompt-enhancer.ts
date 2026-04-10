/**
 * Per-model prompt enhancers that transform a raw creative prompt into
 * a prompt optimised for the target model's architecture and training.
 *
 * Each model has fundamentally different prompt-parsing behaviour:
 *
 *   - **FLUX Pro Ultra** uses a T5-XXL text encoder that reads natural
 *     language prose. Keyword spam, weight syntax `(word:1.5)`, and
 *     SD-era quality boosters ("masterpiece", "8k") are noise. Subject
 *     should be front-loaded (earlier tokens get more attention).
 *     Camera/lens specs are the most reliable style lever. No negative
 *     prompt support.
 *
 *   - **Nano Banana Pro** (Gemini 3 Pro Image) has a reasoning layer
 *     that interprets full paragraphs with grammar and intent. Long
 *     detailed prompts outperform short ones. Text-in-image rendering
 *     is best-in-class — quote exact text, specify typography. Add a
 *     prohibitions block at the end. Contextual framing ("for a SaaS
 *     product launch") improves output quality.
 *
 *   - **Kling v3** understands cinematic direction. Structure as
 *     Camera Movement → Subject/Action → Environment/Lighting →
 *     Texture → Style. Supports negative prompts and cfg_scale.
 *     Film vocabulary for camera. Describe motion with physics.
 *
 *   - **Seedance 2.0** follows the 6-part director formula:
 *     Subject → Action → Camera → Scene → Style → Constraints.
 *     Native audio prompting (dialogue in quotes, SFX keywords).
 *     Timeline markers (`[0s]`, `[3s]`) for multi-beat pacing.
 *     Append a ban list ("avoid jitter, avoid identity drift").
 *
 * Sources:
 *   - BFL Prompting Guide (docs.bfl.ml/guides/prompting_guide_flux2)
 *   - Google Gemini Image Best Practices (cloud.google.com)
 *   - fal.ai Kling 3.0 Prompting Guide (blog.fal.ai)
 *   - Seedance 2.0 6-Part Formula (seedance.tv, apiyi.com)
 */

// ── Types ──────────────────────────────────────────────────────────

export interface ImagePromptContext {
  style?: string;
  aspectRatio?: string;
  assetType?: string;
}

export interface VideoPromptContext {
  duration?: number;
  hasImageUrl?: boolean;
}

// ── FLUX Pro Ultra ─────────────────────────────────────────────────

/**
 * Strip SD-era quality boosters and weight syntax that FLUX ignores.
 * These waste tokens and confuse the T5 encoder.
 */
const SD_NOISE_PATTERNS = [
  /\b(masterpiece|best quality|ultra.?quality|high.?quality|4k|8k|uhd)\b/gi,
  /\btrending on (artstation|deviantart|pixiv)\b/gi,
  /\b(highly detailed|extremely detailed|intricate detail)\b/gi,
  /\b(award.?winning|professional photo(graphy)?)\b/gi,
  // Weight syntax: (word:1.5), ((word)), [word]
  /\(([^)]+):[\d.]+\)/g,
  /\(\(([^)]+)\)\)/g,
];

function stripSdNoise(prompt: string): string {
  let cleaned = prompt;
  for (const pattern of SD_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match, group: string | undefined) => {
      // For weight syntax, keep the inner word
      if (group !== undefined) return group;
      return '';
    });
  }
  // Collapse double commas and trim
  return cleaned.replace(/,\s*,/g, ',').replace(/,\s*$/, '').replace(/^\s*,/, '').trim();
}

/**
 * FLUX reads sentence structure — weave style into prose instead of
 * appending "Style: X" as a suffix.
 */
function weaveFluxStyle(prompt: string, style?: string): string {
  if (!style) return prompt;

  // If prompt already mentions the style concept, skip
  const styleLower = style.toLowerCase();
  if (prompt.toLowerCase().includes(styleLower)) return prompt;

  // Weave into the prompt as a natural phrase
  return `${prompt}, rendered in a ${style} aesthetic`;
}

/**
 * Ensure the prompt has a lighting description — the single biggest
 * quality lever for FLUX. If none is detected, append a sensible
 * default based on the intended mood.
 */
const LIGHTING_KEYWORDS = [
  'light', 'lighting', 'lit', 'glow', 'shadow', 'backlit', 'rimlight',
  'softbox', 'sunlight', 'moonlight', 'neon', 'ambient', 'chiaroscuro',
  'spotlight', 'luminous', 'radiant', 'illuminat',
];

function hasLightingDescription(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return LIGHTING_KEYWORDS.some((kw) => lower.includes(kw));
}

export function enhanceForFlux(
  rawPrompt: string,
  ctx: ImagePromptContext
): string {
  let prompt = stripSdNoise(rawPrompt);
  prompt = weaveFluxStyle(prompt, ctx.style);

  if (!hasLightingDescription(prompt)) {
    prompt += '. Soft, diffused studio lighting with subtle gradient highlights';
  }

  return prompt;
}

// ── Nano Banana Pro (Gemini 3 Pro Image) ───────────────────────────

/**
 * Gemini benefits from contextual framing — telling the model what
 * the image is FOR significantly improves output.
 */
function addGeminiContextFrame(prompt: string, ctx: ImagePromptContext): string {
  const assetType = ctx.assetType;
  if (!assetType) return prompt;

  const contextMap: Record<string, string> = {
    og_image: 'A professional Open Graph preview image for a developer tool product launch.',
    social_card: 'A social media announcement card for a tech product.',
  };

  const frame = contextMap[assetType];
  if (!frame) return prompt;

  // If prompt already starts with context framing, skip
  if (prompt.toLowerCase().startsWith('a professional') || prompt.toLowerCase().startsWith('a social')) {
    return prompt;
  }

  return `${frame}\n\n${prompt}`;
}

/**
 * For Gemini, weave style into a detailed descriptive sentence
 * rather than a suffix.
 */
function weaveGeminiStyle(prompt: string, style?: string): string {
  if (!style) return prompt;
  const styleLower = style.toLowerCase();
  if (prompt.toLowerCase().includes(styleLower)) return prompt;
  return `${prompt}\n\nVisual style: ${style}. Clean, polished execution with professional-grade detail.`;
}

/**
 * Append a prohibitions block — Gemini responds well to explicit
 * exclusions stated separately from the creative description.
 * 94% compliance on prohibitions vs 91% on mandatory inclusions.
 */
function addGeminiProhibitions(prompt: string): string {
  // Don't double-add if already present
  if (prompt.toLowerCase().includes('no watermark') || prompt.toLowerCase().includes('prohibit')) {
    return prompt;
  }

  return `${prompt}\n\nNo watermarks. No stock photo elements. No blurry or low-resolution artifacts. All text must be perfectly legible and correctly spelled.`;
}

export function enhanceForNanoBanana(
  rawPrompt: string,
  ctx: ImagePromptContext
): string {
  let prompt = stripSdNoise(rawPrompt);
  prompt = addGeminiContextFrame(prompt, ctx);
  prompt = weaveGeminiStyle(prompt, ctx.style);

  if (!hasLightingDescription(prompt)) {
    prompt += '\n\nSoft, balanced studio lighting with subtle directional shadows for depth.';
  }

  prompt = addGeminiProhibitions(prompt);

  return prompt;
}

// ── Kling v3 ───────────────────────────────────────────────────────

/**
 * Kling v3 interprets cinematic direction. Restructure the prompt to
 * lead with camera movement, then subject/action, environment,
 * lighting, and texture — the order the model prioritises.
 *
 * Also returns a recommended negative prompt and cfg_scale.
 */
export interface KlingEnhancedPrompt {
  prompt: string;
  negativePrompt: string;
  cfgScale: number;
}

const CAMERA_KEYWORDS = [
  'pan', 'tilt', 'zoom', 'dolly', 'crane', 'orbit', 'tracking',
  'follow', 'static', 'locked', 'steadicam', 'handheld', 'aerial',
  'fpv', 'whip pan', 'rack focus', 'dutch angle', 'arc',
];

function hasCameraDirection(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return CAMERA_KEYWORDS.some((kw) => lower.includes(kw));
}

const TEXTURE_KEYWORDS = [
  'film grain', 'skin pores', 'fabric', 'texture', 'condensation',
  'dust', 'bokeh', 'lens flare', 'chromatic', 'grain', 'matte', 'glossy',
];

function hasTextureDetail(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return TEXTURE_KEYWORDS.some((kw) => lower.includes(kw));
}

const KLING_DEFAULT_NEGATIVE =
  'blur, distort, low quality, face distortion, warping, morphing, ' +
  'floating objects, extra limbs, sliding feet, cartoonish, ' +
  'smooth plastic skin, deformed hands, glitches, flicker';

export function enhanceForKlingV3(
  rawPrompt: string,
  ctx: VideoPromptContext
): KlingEnhancedPrompt {
  let prompt = stripSdNoise(rawPrompt);

  // Add camera direction if missing — default to a slow cinematic dolly
  if (!hasCameraDirection(prompt)) {
    prompt = `Slow dolly forward. ${prompt}`;
  }

  // Add lighting if missing
  if (!hasLightingDescription(prompt)) {
    prompt += '. Soft cinematic lighting with natural contrast';
  }

  // Add texture details for realism if missing
  if (!hasTextureDetail(prompt)) {
    prompt += '. Subtle film grain, realistic material textures';
  }

  // Append quality directive — Kling responds well to these
  prompt += '. Cinematic quality, smooth motion';

  // Image-to-video needs higher prompt adherence to preserve the
  // source frame's composition; text-to-video benefits from more
  // creative latitude.
  const cfgScale = ctx.hasImageUrl === true ? 0.7 : 0.6;

  return {
    prompt,
    negativePrompt: KLING_DEFAULT_NEGATIVE,
    cfgScale,
  };
}

// ── Seedance 2.0 ───────────────────────────────────────────────────

/**
 * Seedance follows the 6-part director formula:
 * Subject → Action → Camera → Scene → Style → Constraints
 *
 * Returns the enhanced prompt with an appended constraint block
 * (Seedance has no negative_prompt parameter — constraints go inline).
 */

const SEEDANCE_CONSTRAINTS =
  'Avoid jitter, avoid bent limbs, avoid identity drift, avoid temporal flicker. ' +
  'Smooth, stable output. Text remains sharp.';

export function enhanceForSeedance(
  rawPrompt: string,
  ctx: VideoPromptContext
): string {
  let prompt = stripSdNoise(rawPrompt);

  // Add camera direction if missing
  if (!hasCameraDirection(prompt)) {
    prompt = `${prompt}. Smooth, steady camera with gentle push-in`;
  }

  // Add lighting if missing
  if (!hasLightingDescription(prompt)) {
    prompt += '. Cinematic lighting with controlled contrast';
  }

  // Append quality and constraint block
  const durationNote = ctx.duration !== undefined ? `${ctx.duration} seconds, ` : '';
  prompt += `. ${durationNote}16:9, ${SEEDANCE_CONSTRAINTS}`;

  return prompt;
}

// ── Unified dispatcher ─────────────────────────────────────────────

export type ImageModelId = 'flux-pro-ultra' | 'nano-banana-pro';
export type VideoModelId = 'kling-v3' | 'seedance-2';

/**
 * Enhance an image prompt for the target model. Returns the
 * optimised prompt string ready to send to the fal.ai API.
 */
export function enhanceImagePrompt(
  rawPrompt: string,
  model: ImageModelId,
  ctx: ImagePromptContext
): string {
  switch (model) {
    case 'nano-banana-pro':
      return enhanceForNanoBanana(rawPrompt, ctx);
    case 'flux-pro-ultra':
    default:
      return enhanceForFlux(rawPrompt, ctx);
  }
}

/**
 * Enhance a video prompt for the target model. Returns the
 * optimised prompt (and for Kling, the negative prompt + cfg_scale).
 */
export function enhanceVideoPrompt(
  rawPrompt: string,
  model: VideoModelId,
  ctx: VideoPromptContext
): { prompt: string; negativePrompt?: string; cfgScale?: number } {
  switch (model) {
    case 'seedance-2':
      return { prompt: enhanceForSeedance(rawPrompt, ctx) };
    case 'kling-v3':
    default: {
      const result = enhanceForKlingV3(rawPrompt, ctx);
      return {
        prompt: result.prompt,
        negativePrompt: result.negativePrompt,
        cfgScale: result.cfgScale,
      };
    }
  }
}
