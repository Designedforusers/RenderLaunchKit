import { ImagePromptResultSchema } from '@launchkit/shared';
import type {
  RepoAnalysis,
  ResearchResult,
  StrategyBrief,
  StrategyInsight,
} from '@launchkit/shared';
import type { LLMClient } from '../types.js';
import type { FalMediaClient, FalImageModel } from '../clients/fal.js';

export interface ArtDirectorInput {
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  assetType: 'og_image' | 'social_card';
  generationInstructions: string;
  imageModel?: FalImageModel;
  /**
   * Phase 7 Layer 3 edit patterns — one entry per cluster of
   * semantically-similar user edits the cron has aggregated for
   * this asset's project category. The art director filters the
   * list to entries scoped to the current `assetType` (the cron
   * encodes asset_type in the insight body as `(<asset_type>, ...)`)
   * and renders them as a "Common Edits Reviewers Made" prompt
   * block so Claude pre-empts the patterns when drafting the
   * image generation prompt. Optional and defaults to an empty
   * list — the dispatch site loads them via
   * `getEditPatternsForCategory` and passes them through, but a
   * unit test or a future caller is free to omit them.
   */
  editPatterns?: StrategyInsight[];
}

export interface MarketingImageResult {
  url: string;
  prompt: string;
  style: string;
  metadata: Record<string, unknown>;
}

export interface MarketingVisualAgentDeps {
  llm: LLMClient;
  fal: FalMediaClient;
}

const SYSTEM_PROMPT = `You are an art director specializing in developer tool marketing visuals. Your job is to create image generation prompts for FLUX.2 Pro that will produce stunning, professional images.

Output JSON:
{
  "prompt": "detailed image generation prompt for FLUX.2 Pro",
  "style": "style description (e.g., minimalist dark, gradient abstract, isometric 3D)",
  "reasoning": "why this visual approach fits the product"
}

Key principles for developer tool visuals:
- Dark backgrounds with vibrant accent colors work best
- Abstract/geometric patterns > literal screenshots
- Convey the "feeling" of the product, not a literal representation
- Typography should be minimal if any — the image should work without text
- For OG images: 1200x630 aspect ratio, bold and readable at small sizes
- For social cards: eye-catching at thumbnail size
- Reference the tech stack subtly (e.g., color schemes associated with the language)

Good prompts are specific about:
- Color palette (name exact colors)
- Composition (what goes where)
- Style (photorealistic, 3D render, flat design, etc.)
- Mood (professional, playful, cutting-edge, etc.)
- What NOT to include (text, faces, specific logos)`;

export function makeGenerateMarketingImageAsset(
  deps: MarketingVisualAgentDeps
) {
  return async function generateMarketingImageAsset(
    input: ArtDirectorInput
  ): Promise<MarketingImageResult> {
    // Phase 7 Layer 3 edit patterns. The cron writes the asset_type
    // into the insight text as `(<asset_type>, ...)`, so we filter to
    // entries whose text mentions THIS asset type before rendering —
    // an art director producing a `social_card` should not see edit
    // patterns scoped to `og_image` even though both share the
    // category. The block teaches Claude to apply the patterns
    // proactively, not just acknowledge them.
    const relevantEditPatterns =
      input.editPatterns?.filter((p) =>
        p.insight.includes(`(${input.assetType},`)
      ) ?? [];
    const editPatternsBlock =
      relevantEditPatterns.length > 0
        ? `\n\n**Common Edits Reviewers Made to Past ${input.assetType} Visuals:**\nThese are real edits human reviewers applied to past ${input.assetType} prompts in this category. Pre-empt them — design the image the way reviewers want it, not the way the previous generation drafted it.\n${relevantEditPatterns
            .map((p) => `- ${p.insight}`)
            .join('\n')}`
        : '';

    const userPrompt = `Create an image prompt for a ${input.assetType === 'og_image' ? 'Open Graph image (1200x630)' : 'social media card'} for:

**Product:** ${input.repoAnalysis.description || input.research.targetAudience}
**Language:** ${input.repoAnalysis.language}
**Category:** ${input.repoAnalysis.category}
**Positioning:** ${input.strategy.positioning}
**Tone:** ${input.strategy.tone}

**Asset Generation Instructions:** ${input.generationInstructions}${editPatternsBlock}

Design an image that a developer would stop scrolling for.`;

    // Get Claude to craft the optimal image prompt — validated against
    // ImagePromptResultSchema so a missing `prompt` or `style` field
    // throws here instead of crashing the fal.ai client downstream.
    const promptResult = await deps.llm.generateJSON(
      ImagePromptResultSchema,
      SYSTEM_PROMPT,
      userPrompt
    );

    // Generate the image via fal.ai
    const image = await deps.fal.generateImage(promptResult.prompt, {
      aspectRatio: input.assetType === 'og_image' ? '16:9' : '1:1',
      style: promptResult.style,
      ...(input.imageModel !== undefined ? { model: input.imageModel } : {}),
    });

    return {
      url: image.url,
      prompt: promptResult.prompt,
      style: promptResult.style,
      metadata: {
        reasoning: promptResult.reasoning,
        dimensions: input.assetType === 'og_image' ? '1200x630' : '1080x1080',
        assetType: input.assetType,
      },
    };
  };
}

export type GenerateMarketingImageAsset = ReturnType<
  typeof makeGenerateMarketingImageAsset
>;
