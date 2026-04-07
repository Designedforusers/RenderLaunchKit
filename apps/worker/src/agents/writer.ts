import { generateContent } from '../lib/claude.js';
import type { RepoAnalysis, ResearchResult, StrategyBrief, StrategyInsight, AssetType } from '@launchkit/shared';

interface WriterInput {
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  pastInsights: StrategyInsight[];
  assetType: AssetType;
  brief: string;
  revisionInstructions?: string;
}

const ASSET_PROMPTS: Record<string, string> = {
  blog_post: `You are an expert developer content writer. Write a compelling blog post that:
- Opens with a hook that identifies a pain point the reader knows well
- Explains the product clearly with technical depth (not marketing fluff)
- Includes realistic code examples or usage demonstrations
- Has a clear structure: intro, problem, solution, features, getting started, conclusion
- Uses the specified tone consistently
- Is 800-1500 words
- Includes a suggested title and subtitle

Output format:
# [Title]
## [Subtitle]

[Content in markdown]`,

  twitter_thread: `You are a developer Twitter strategist. Write a compelling Twitter/X thread that:
- Opens with a hook tweet that stops the scroll (question, bold claim, or surprising stat)
- Each tweet is under 280 characters
- Breaks down the product's value into digestible points
- Includes suggested hashtags
- Ends with a CTA (link, try it, star it)
- 5-10 tweets total
- Numbers each tweet (1/, 2/, etc.)

Output each tweet on its own line, separated by blank lines.`,

  linkedin_post: `You are a LinkedIn content strategist for tech audiences. Write a LinkedIn post that:
- Opens with a thought-provoking first line (LinkedIn shows first ~2 lines)
- Tells a story or shares an insight about the problem space
- Introduces the product naturally (not salesy)
- Uses short paragraphs and line breaks for readability
- Includes relevant emojis sparingly
- 200-400 words
- Ends with a question to drive engagement`,

  product_hunt_description: `You are a Product Hunt launch expert. Write a Product Hunt description that:
- Has a catchy tagline (under 60 characters)
- Explains what it does in one clear sentence
- Lists 3-5 key features with brief descriptions
- Mentions the tech stack briefly
- Includes a "Made with" section
- Keeps the tone enthusiastic but genuine

Output format:
**Tagline:** [tagline]

**Description:**
[description]

**Key Features:**
[features]`,

  hacker_news_post: `You are an experienced Hacker News poster. Write a Show HN post that:
- Title follows "Show HN: [Product] – [One-line description]" format
- Is technically honest and specific
- Explains the motivation (why you built it)
- Mentions interesting technical decisions
- Is conversational and humble (HN hates marketing speak)
- Under 300 words
- Acknowledges limitations

Output format:
**Title:** Show HN: [title]

**Post:**
[post body]`,

  faq: `You are a technical documentation writer. Write a comprehensive FAQ that:
- Covers 8-12 common questions developers would ask
- Includes installation/setup questions
- Covers "how is this different from X" comparisons
- Addresses pricing/licensing
- Includes troubleshooting tips
- Uses clear, direct language
- Groups questions logically

Output as markdown with ## for each question.`,

  changelog_entry: `You are a changelog writer. Write a changelog entry that:
- Follows Keep a Changelog format
- Groups changes into Added, Changed, Fixed, Removed
- Is specific about what changed
- Links to relevant issues/PRs when applicable
- Is concise but complete

Output in markdown format.`,

  voiceover_script: `You are a video script writer for developer product demos. Write a voiceover script that:
- Is 30-60 seconds when read aloud
- Opens with the problem statement
- Shows the solution in action (describe what's on screen)
- Highlights 2-3 key features
- Ends with a clear CTA
- Uses a natural, conversational tone
- Includes [SCREEN: ...] cues for what should be shown

Output format:
[SCREEN: description]
"Voiceover text"`,
};

export async function runWriter(input: WriterInput): Promise<{ content: string; metadata: Record<string, unknown> }> {
  const systemPrompt = ASSET_PROMPTS[input.assetType] || ASSET_PROMPTS.blog_post;

  const context = `## Product Context

**Repository:** ${input.repoAnalysis.description || input.research.targetAudience}
**Language:** ${input.repoAnalysis.language}
**Tech Stack:** ${input.repoAnalysis.techStack.join(', ')}
**Stars:** ${input.repoAnalysis.stars}

## Strategic Direction
**Positioning:** ${input.strategy.positioning}
**Tone:** ${input.strategy.tone}
**Key Messages:**
${input.strategy.keyMessages.map((m) => `- ${m}`).join('\n')}

## Research Context
**Target Audience:** ${input.research.targetAudience}
**Market Context:** ${input.research.marketContext}
**Unique Angles:** ${input.research.uniqueAngles.join('; ')}
**Competitors:** ${input.research.competitors.map((c) => `${c.name}: ${c.differentiator}`).join('; ')}

## Specific Brief
${input.brief}

${input.revisionInstructions ? `## Revision Instructions\n${input.revisionInstructions}` : ''}

${input.pastInsights.length > 0 ? `## Insights from Similar Projects\n${input.pastInsights.map((i) => `- ${i.insight}`).join('\n')}` : ''}`;

  const content = await generateContent(systemPrompt, context, {
    maxTokens: 4096,
    temperature: 0.7,
  });

  // Extract metadata based on asset type
  const metadata: Record<string, unknown> = {
    assetType: input.assetType,
    tone: input.strategy.tone,
  };

  if (input.assetType === 'blog_post') {
    const titleMatch = content.match(/^#\s+(.+)/m);
    const subtitleMatch = content.match(/^##\s+(.+)/m);
    metadata.title = titleMatch?.[1] || 'Untitled';
    metadata.subtitle = subtitleMatch?.[1] || '';
    metadata.wordCount = content.split(/\s+/).length;
  } else if (input.assetType === 'twitter_thread') {
    const tweets = content.split(/\n\n+/).filter((t) => t.trim().length > 0);
    metadata.tweetCount = tweets.length;
  } else if (input.assetType === 'product_hunt_description') {
    const taglineMatch = content.match(/\*\*Tagline:\*\*\s*(.+)/);
    metadata.tagline = taglineMatch?.[1]?.trim() || '';
  }

  return { content, metadata };
}
