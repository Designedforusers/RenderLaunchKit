import { generateJSON } from '../lib/anthropic-claude-client.js';
import type { CreativeReview, StrategyBrief } from '@launchkit/shared';

interface AssetForReview {
  id: string;
  type: string;
  content: string | null;
  mediaUrl: string | null;
  metadata: Record<string, unknown> | null;
}

const SYSTEM_PROMPT = `You are a creative director reviewing a complete go-to-market kit for a developer product. You receive all generated assets and must evaluate them as a cohesive package.

Score each asset 1-10 on:
- **Accuracy**: Does it correctly represent the product?
- **Tone consistency**: Does it match the strategic tone?
- **Audience fit**: Would the target audience engage with this?
- **Quality**: Is the writing/visual quality professional?
- **Actionability**: Does it drive the reader to take action?

The overall score is the average, weighted toward lower-scoring assets (a chain is only as strong as its weakest link).

Output JSON:
{
  "overallScore": 7.5,
  "overallFeedback": "summary of the kit's coherence and quality",
  "assetReviews": [
    {
      "assetId": "uuid",
      "score": 8,
      "strengths": ["specific strength 1", "specific strength 2"],
      "issues": ["specific issue 1"],
      "revisionInstructions": "exact instructions for improvement (only if score < 7)"
    }
  ],
  "approved": true,
  "revisionPriority": ["assetId1"]
}

Key evaluation criteria:
- All assets should tell the SAME story (consistent positioning)
- Tone should be uniform across all text assets
- Blog post is the flagship — it must be the strongest
- Social content should be punchy, not watered-down blog content
- FAQ should address real objections, not softballs
- Images should feel like they belong to the same brand
- Video (if present) should be the "hero" content piece

Be critical but constructive. If something is mediocre, say so. The goal is excellence, not participation trophies.`;

export async function reviewLaunchKitAssets(
  strategy: StrategyBrief,
  assets: AssetForReview[]
): Promise<CreativeReview> {
  const userPrompt = `Review this complete go-to-market kit:

## Strategic Brief
- **Positioning:** ${strategy.positioning}
- **Tone:** ${strategy.tone}
- **Key Messages:** ${strategy.keyMessages.join('; ')}
- **Target Channels:** ${strategy.selectedChannels.map((c) => c.channel).join(', ')}

## Generated Assets (${assets.length} total)

${assets
  .map(
    (asset) => `### ${asset.type} (ID: ${asset.id})
${asset.content ? `Content:\n${asset.content.slice(0, 2000)}${asset.content.length > 2000 ? '\n...[truncated]' : ''}` : ''}
${asset.mediaUrl ? `Media URL: ${asset.mediaUrl}` : ''}
${asset.metadata ? `Metadata: ${JSON.stringify(asset.metadata)}` : ''}`
  )
  .join('\n\n---\n\n')}

Review the entire kit as a coherent package. Score each asset and decide whether to approve or request revisions.`;

  const review = await generateJSON<CreativeReview>(SYSTEM_PROMPT, userPrompt, {
    maxTokens: 4096,
  });

  // Validate
  if (typeof review.overallScore !== 'number' || !review.assetReviews) {
    throw new Error('Creative director did not produce valid review');
  }

  return review;
}
