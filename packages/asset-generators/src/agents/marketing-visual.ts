import { ImagePromptResultSchema } from '@launchkit/shared';
import type {
  RepoAnalysis,
  ResearchResult,
  StrategyBrief,
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
    const userPrompt = `Create an image prompt for a ${input.assetType === 'og_image' ? 'Open Graph image (1200x630)' : 'social media card'} for:

**Product:** ${input.repoAnalysis.description || input.research.targetAudience}
**Language:** ${input.repoAnalysis.language}
**Category:** ${input.repoAnalysis.category}
**Positioning:** ${input.strategy.positioning}
**Tone:** ${input.strategy.tone}

**Asset Generation Instructions:** ${input.generationInstructions}

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
