import { generateJSON } from '../lib/anthropic-claude-client.js';
import { getInsightsForCategory } from '../tools/project-insight-memory.js';
import { StrategyBriefSchema } from '@launchkit/shared';
import type { RepoAnalysis, ResearchResult, StrategyBrief, StrategyInsight } from '@launchkit/shared';

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
      "type": "blog_post|twitter_thread|linkedin_post|product_hunt_description|hacker_news_post|faq|changelog_entry|og_image|social_card|product_video|voiceover_script|video_storyboard|tips|voice_commercial|podcast_script|world_scene",
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
- Developer tools → prioritize HN, Twitter, technical blog
- Full-stack apps → broader distribution, include Product Hunt
- Libraries → focus on README, Twitter thread, HN
- Always generate at least: blog_post, og_image, and one social channel
- Video is high-impact but expensive. Only recommend for visually interesting products.
- Always include "tips" — it's cheap to generate, high utility, and every developer appreciates a concrete "what to do next" list.
- Recommend "voice_commercial" when the product has a clear single value prop and a developer audience that listens to podcasts or screencasts (DevOps, ML, infra tools).
- Recommend "podcast_script" when the product has technical depth worth discussing — the multi-host format excels at frameworks, libraries, and complex tooling where back-and-forth dialogue surfaces nuance.
- Recommend "world_scene" when the product benefits from being *seen in context* — an interactive 3D walk-through of the natural setting where developers actually use it. Good examples: a home office for a local developer tool, a data center aisle for infrastructure, a lab bench for research software, a busy conference floor for SaaS, a terminal setup for a CLI. World Labs (Marble) generates a shareable 3D scene the user can walk around in, which makes abstract software feel tactile. Especially strong for libraries and invisible tooling where there's nothing physical to show — the scene gives reviewers something to remember. Skip for products that are already visually self-explanatory in a 2D video (those should get product_video instead).

If past insights from similar projects are provided, factor them into your decisions.
For example, if insights say "CLI tools: users delete LinkedIn posts 60%", skip LinkedIn for CLI tools.`;

export async function createLaunchStrategy(
  repoAnalysis: RepoAnalysis,
  research: ResearchResult,
  pastInsights?: StrategyInsight[]
): Promise<StrategyBrief> {
  // Fetch insights if not provided
  const insights = pastInsights ?? await getInsightsForCategory(repoAnalysis.category);

  const userPrompt = `Create a go-to-market strategy for this product:

## Repository Analysis
${JSON.stringify(repoAnalysis, null, 2)}

## Market Research
${JSON.stringify(research, null, 2)}

${insights.length > 0 ? `## Past Insights from Similar Projects\n${insights.map((i) => `- [${i.category}] ${i.insight} (confidence: ${i.confidence}, based on ${i.sampleSize} projects)`).join('\n')}` : ''}

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

  // Ensure at minimum we have blog + og_image
  const assetTypes = strategy.assetsToGenerate.map((a) => a.type);
  if (!assetTypes.includes('blog_post')) {
    strategy.assetsToGenerate.push({
      type: 'blog_post',
      generationInstructions:
        'Write a technical blog post introducing the product, its key features, and why developers should care.',
      priority: 1,
    });
  }
  if (!assetTypes.includes('og_image')) {
    strategy.assetsToGenerate.push({
      type: 'og_image',
      generationInstructions:
        'Create an OG image that communicates the product value at a glance.',
      priority: 2,
    });
  }

  return strategy;
}
