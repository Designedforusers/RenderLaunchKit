import { generateJSON } from '../lib/anthropic-claude-client.js';
import {
  STRATEGY_ASSET_TYPES,
  applyLaunchStrategyAssetCapabilities,
} from '../lib/launch-strategy-asset-capabilities.js';
import {
  getInsightsForCategory,
  getEditPatternsForCategory,
} from '../tools/project-insight-memory.js';
import { StrategyBriefSchema } from '@launchkit/shared';
import type {
  RepoAnalysis,
  ResearchResult,
  StrategyBrief,
  StrategyInsight,
} from '@launchkit/shared';
import type { LaunchStrategyAssetCapabilities } from '../lib/launch-strategy-asset-capabilities.js';

const STRATEGY_ASSET_TYPE_LIST = STRATEGY_ASSET_TYPES.join('|');

const SYSTEM_PROMPT = `You are a developer marketing strategist. Given research about a product, decide the optimal go-to-market strategy.

You MUST output valid JSON matching this schema:
{
  "positioning": "one-sentence positioning statement",
  "tone": "technical|casual|enthusiastic|authoritative",
  "keyMessages": ["message1", "message2", "message3"],
  "selectedChannels": [
    {
      "channel": "hacker_news|twitter|linkedin|product_hunt|reddit|dev_to",
      "priority": 1-5,
      "reasoning": "why this channel fits"
    }
  ],
  "assetsToGenerate": [
    {
      "type": "${STRATEGY_ASSET_TYPE_LIST}",
      "generationInstructions": "specific instructions for generating this asset",
      "priority": 1-5
    }
  ],
  "skipAssets": [
    {
      "type": "asset type to skip",
      "reasoning": "why this doesn't fit"
    }
  ]
}

Key strategic principles:
- NOT every product needs every asset type. A CLI tool doesn't need Instagram content.
- Channel selection should match where the target audience actually spends time.
- Be opinionated. Weak strategies try everything. Strong strategies focus.
- Reference the research findings in your reasoning.
- Choose ONLY from the "Available asset types in this deployment" block in the user prompt.
- If an unavailable asset would otherwise fit, put it in skipAssets with the provided reason instead of assetsToGenerate.
- Developer tools → prioritize HN, Twitter, technical blog
- Full-stack apps → broader distribution, include Product Hunt
- Libraries → focus on README, Twitter thread, HN
- Always generate at least: blog_post, one social channel, and og_image when og_image is available in this deployment
- Video is high-impact but expensive. Only recommend for visually interesting products.
- Always include "tips" — it's cheap to generate, high utility, and every developer appreciates a concrete "what to do next" list.
- Recommend "voice_commercial" when the product has a clear single value prop and a developer audience that listens to podcasts or screencasts (DevOps, ML, infra tools).
- Recommend "podcast_script" when the product has technical depth worth discussing — the multi-host format excels at frameworks, libraries, and complex tooling where back-and-forth dialogue surfaces nuance.
- Recommend "world_scene" when the product benefits from being *seen in context* — an interactive 3D walk-through of the natural setting where developers actually use it. Good examples: a home office for a local developer tool, a data center aisle for infrastructure, a lab bench for research software, a busy conference floor for SaaS, a terminal setup for a CLI. World Labs (Marble) generates a shareable 3D scene the user can walk around in, which makes abstract software feel tactile. Especially strong for libraries and invisible tooling where there's nothing physical to show — the scene gives reviewers something to remember. Skip for products that are already visually self-explanatory in a 2D video (those should get product_video instead).

If past insights from similar projects are provided, factor them into your decisions.
For example, if insights say "CLI tools: users delete LinkedIn posts 60%", skip LinkedIn for CLI tools.

If "Common Edits Reviewers Made" patterns are provided, those are real revisions human users applied to past assets in this category. Treat each pattern as evidence about what the previous generation got wrong:
- A repeated "removed emoji from intro" pattern → omit emoji from the intro of every asset you recommend.
- A repeated "shortened CTA" pattern → tighten the CTA wording in your generationInstructions.
- A repeated "added code example" pattern → include "must contain a runnable code example" in the generationInstructions for blog_post and faq.
Bake the pattern into the assetsToGenerate[].generationInstructions strings, not into the positioning — the writer agent reads those instructions verbatim.`;

export async function createLaunchStrategy(
  repoAnalysis: RepoAnalysis,
  research: ResearchResult,
  options: {
    capabilities: LaunchStrategyAssetCapabilities;
    pastInsights?: StrategyInsight[];
    editPatterns?: StrategyInsight[];
  }
): Promise<StrategyBrief> {
  // Fetch insights and edit patterns if not provided. The two
  // accessors return disjoint sets — `getInsightsForCategory`
  // excludes `edit_pattern` rows so the strategic block stays
  // focused on stat-based findings, while
  // `getEditPatternsForCategory` returns ONLY the Layer 3 cluster
  // rows. Both fall back to empty arrays on DB failure.
  const insights =
    options.pastInsights ?? (await getInsightsForCategory(repoAnalysis.category));
  const edits =
    options.editPatterns ?? (await getEditPatternsForCategory(repoAnalysis.category));
  const availableAssetsBlock = `## Available asset types in this deployment\n${options.capabilities.availableAssetTypes
    .map((type) => `- ${type}`)
    .join('\n')}`;
  const unavailableAssetsBlock =
    options.capabilities.unavailableAssets.length > 0
      ? `\n\n## Asset types unavailable in this deployment\n${options.capabilities.unavailableAssets
          .map((asset) => `- ${asset.type}: ${asset.reasoning}`)
          .join('\n')}`
      : '';

  const insightsBlock =
    insights.length > 0
      ? `## Past Insights from Similar Projects\n${insights
          .map(
            (i) =>
              `- [${i.category}] ${i.insight} (confidence: ${String(i.confidence)}, based on ${String(i.sampleSize)} projects)`
          )
          .join('\n')}`
      : '';

  const editsBlock =
    edits.length > 0
      ? `## Common Edits Reviewers Made to Past ${repoAnalysis.category} Assets\n${edits
          .map(
            (i) =>
              `- ${i.insight} (confidence: ${String(i.confidence)}, ${String(i.sampleSize)} similar edits)`
          )
          .join('\n')}\n\nUse these patterns to refine the assetsToGenerate[].generationInstructions strings — do not just acknowledge them in your reasoning.`
      : '';

  const userPrompt = `Create a go-to-market strategy for this product:

## Repository Analysis
${JSON.stringify(repoAnalysis, null, 2)}

## Market Research
${JSON.stringify(research, null, 2)}

${availableAssetsBlock}
${unavailableAssetsBlock}

${insightsBlock}

${editsBlock}

Based on this information, create a focused, opinionated strategy. Don't try to be everywhere — pick the channels and assets that will have the highest impact for this specific product.`;

  // Schema validation replaces the previous hand-rolled
  // `if (!strategy.positioning || ...)` check. Any missing or
  // wrongly-typed field on the model output now throws a structured
  // Zod error from `generateJSON` itself, with the failing field
  // path in the message.
  const strategy: StrategyBrief = await generateJSON(
    StrategyBriefSchema,
    SYSTEM_PROMPT,
    userPrompt,
    { maxTokens: 4096 }
  );

  return applyLaunchStrategyAssetCapabilities(strategy, options.capabilities);
}
