import {
  BlogPostContentSchema,
  ChangelogEntryContentSchema,
  FaqContentSchema,
  HackerNewsPostContentSchema,
  LinkedInPostContentSchema,
  NO_MARKDOWN_PROMPT_RULES,
  PodcastScriptContentSchema,
  ProductHuntContentSchema,
  TipsContentSchema,
  TwitterThreadContentSchema,
  VoiceCommercialContentSchema,
  blogPostToPlainText,
  changelogEntryToPlainText,
  faqToPlainText,
  hackerNewsPostToPlainText,
  linkedInPostToPlainText,
  parseVoiceoverScript,
  podcastScriptToPlainText,
  productHuntToPlainText,
  tipsToPlainText,
  twitterThreadToPlainText,
  voiceCommercialToPlainText,
} from '@launchkit/shared';
import type {
  AssetType,
  RepoAnalysis,
  ResearchResult,
  StrategyBrief,
  StrategyInsight,
} from '@launchkit/shared';
import type { LLMClient } from '../types.js';

export interface WriterInput {
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  pastInsights: StrategyInsight[];
  assetType: AssetType;
  generationInstructions: string;
  revisionInstructions?: string;
}

export interface WriterResult {
  /**
   * Plain-text rendering of the structured content. Stored in the
   * `assets.content` column so existing text consumers (search,
   * download-as-text, fallback rendering) keep working. Contains no
   * markdown syntax, no em dashes, no asterisks — the structured
   * generators produce clean fields and the plain-text serializers
   * never inject artifacts.
   */
  content: string;
  /**
   * Structured metadata attached to the asset row. For structured
   * asset types the full parsed content object lives at
   * `metadata.structured`, the tagged `contentShape` discriminator
   * lets consumers narrow the object, and convenience fields
   * (title, wordCount, etc) stay at the top level for existing
   * code paths that read them directly. For the single structural-
   * format type still on the legacy parser (`voiceover_script`),
   * `structured` and `contentShape` are omitted and the parser's
   * own fields are stored at the top level exactly as before.
   */
  metadata: Record<string, unknown>;
}

export interface WriterAgentDeps {
  llm: LLMClient;
}

// =====================================================================
// Shared prompt pieces
// =====================================================================

/**
 * Base system prompt every structured writer prepends to its
 * type-specific instructions. Carries the formatting guarantees
 * (no markdown, no em dashes, no asterisks) that keep the output
 * clean at the field level. Schema validation is the second line
 * of defense; this prompt is the first.
 */
const STRUCTURED_OUTPUT_PREAMBLE = `You are an expert developer-marketing content writer.

Your output must be VALID JSON that matches the provided schema exactly. Do not include explanations, preamble, or any text outside the JSON object.

${NO_MARKDOWN_PROMPT_RULES}`;

/**
 * Build the context block that accompanies every writer system
 * prompt. Pulled out of the old inline definition so every
 * per-type generator can call the same function rather than
 * maintaining its own copy.
 */
function buildContext(input: WriterInput): string {
  const revisionBlock =
    input.revisionInstructions !== undefined &&
    input.revisionInstructions.length > 0
      ? `\n\n## Revision Instructions\n${input.revisionInstructions}`
      : '';

  const insightsBlock =
    input.pastInsights.length > 0
      ? `\n\n## Insights from Similar Projects\n${input.pastInsights
          .map((i) => `- ${i.insight}`)
          .join('\n')}`
      : '';

  return `## Product Context

**Repository:** ${input.repoAnalysis.description || input.research.targetAudience}
**Language:** ${input.repoAnalysis.language}
**Tech Stack:** ${input.repoAnalysis.techStack.join(', ')}
**Stars:** ${input.repoAnalysis.stars.toString()}

## Strategic Direction
**Positioning:** ${input.strategy.positioning}
**Tone:** ${input.strategy.tone}
**Key Messages:**
${input.strategy.keyMessages.map((m) => `- ${m}`).join('\n')}

## Research Context
**Target Audience:** ${input.research.targetAudience}
**Market Context:** ${input.research.marketContext}
**Unique Angles:** ${input.research.uniqueAngles.join('; ')}
**Competitors:** ${input.research.competitors
    .map((c) => `${c.name}: ${c.differentiator}`)
    .join('; ')}

## Asset Generation Instructions
${input.generationInstructions}${revisionBlock}${insightsBlock}`;
}

function buildBaseMetadata(input: WriterInput): Record<string, unknown> {
  return {
    assetType: input.assetType,
    tone: input.strategy.tone,
  };
}

/**
 * Assemble a per-type system prompt by prepending the shared
 * structured-output preamble. Keeps every per-type string focused
 * on its own "what to generate" instructions.
 */
function withStructuredPreamble(typeSpecific: string): string {
  return `${STRUCTURED_OUTPUT_PREAMBLE}\n\n${typeSpecific}`;
}

// =====================================================================
// Per-type generators
// =====================================================================

/** Shared default for structured writer token budgets. Kept at the
 *  original 4096 so a long blog post or a detailed FAQ has enough
 *  room to land without hitting the ceiling. */
const DEFAULT_MAX_TOKENS = 4096;

async function generateBlogPost(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate a compelling developer blog post.

Guidance:
- Open with a hook that identifies a pain point the reader knows well
- Explain the product clearly with technical depth, not marketing fluff
- Include realistic usage details or technical decisions in the body sections
- Keep a clear arc across sections: problem, solution, how it works, wrap-up
- 3 to 6 body sections, each with its own heading and 1 to 3 paragraphs
- Use the specified tone consistently

Return a JSON object matching the BlogPostContentSchema.`
  );
  const structured = await llm.generateJSON(
    BlogPostContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  const content = blogPostToPlainText(structured);
  return {
    content,
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'blog_post',
      structured,
      title: structured.title,
      subtitle: structured.subtitle,
      wordCount: content.split(/\s+/).filter((w) => w.length > 0).length,
    },
  };
}

async function generateTwitterThread(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate a compelling Twitter / X thread.

Guidance:
- Hook tweet stops the scroll (question, bold claim, surprising stat)
- Each tweet under 280 characters — keep individual tweets tight
- Break the product's value into digestible points
- Closing CTA tweet drives the reader to try, star, or share
- Include 2 to 5 suggested hashtags

Return a JSON object matching the TwitterThreadContentSchema.`
  );
  const structured = await llm.generateJSON(
    TwitterThreadContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  return {
    content: twitterThreadToPlainText(structured),
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'twitter_thread',
      structured,
      tweetCount: structured.tweets.length + 2, // hook + body + cta
    },
  };
}

async function generateLinkedInPost(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate a LinkedIn post for a technical audience.

Guidance:
- Open with a thought-provoking first line (LinkedIn shows the first 1-2 lines)
- Tell a story or share an insight about the problem space
- Introduce the product naturally, never salesy
- Use short paragraphs, 1-3 sentences each
- End with a single question that drives engagement

Return a JSON object matching the LinkedInPostContentSchema.`
  );
  const structured = await llm.generateJSON(
    LinkedInPostContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  return {
    content: linkedInPostToPlainText(structured),
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'linkedin_post',
      structured,
    },
  };
}

/**
 * NOTE: the asset type key is `product_hunt_description` but the
 * stored `metadata.contentShape` tag is `'product_hunt'`. The two
 * strings are intentionally different — `AssetType` is the DB enum
 * value that existed before this file was rewritten, and
 * `contentShape` is the shorter label the dashboard's dispatch
 * switch uses. Do not "fix" the asymmetry by renaming one to match
 * the other; the dashboard's `parseStructuredAssetContent` matches
 * on the short form and would stop rendering Product Hunt cards
 * if the two drifted.
 */
async function generateProductHunt(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate a Product Hunt launch description.

Guidance:
- Tagline is a catchy one-liner under 60 characters
- Description is 2-4 sentences explaining what the product does and why it matters
- Key features: 3-5 items, each with a short name and a one-sentence description
- Tech stack is one sentence naming the main technologies
- First comment is the maker's 2-3 sentence first comment on the thread, conversational

Return a JSON object matching the ProductHuntContentSchema.`
  );
  const structured = await llm.generateJSON(
    ProductHuntContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  return {
    content: productHuntToPlainText(structured),
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'product_hunt',
      structured,
      tagline: structured.tagline,
    },
  };
}

async function generateHackerNewsPost(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate a Show HN post for Hacker News.

Guidance:
- Title starts with "Show HN: " followed by product name, colon, short description
- Be technically honest and specific
- Motivation: why you built it (1-3 sentences)
- Body: what it does and the interesting technical decisions (2-5 sentences)
- Technical decisions: 2-5 bullet points of the key technical choices
- Limitations: an honest note about what doesn't work yet (1-3 sentences)
- Conversational, humble, technical. HN hates marketing speak.

Return a JSON object matching the HackerNewsPostContentSchema.`
  );
  const structured = await llm.generateJSON(
    HackerNewsPostContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  return {
    content: hackerNewsPostToPlainText(structured),
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'hacker_news_post',
      structured,
      title: structured.title,
    },
  };
}

async function generateFaq(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate a developer FAQ for this product.

Guidance:
- Cover 8-12 total questions across 2-5 category groups
- Include installation, comparison, pricing, and troubleshooting questions
- Use clear, direct language
- Each answer is 1-4 sentences

Return a JSON object matching the FaqContentSchema.`
  );
  const structured = await llm.generateJSON(
    FaqContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  const questionCount = structured.groups.reduce(
    (sum, g) => sum + g.entries.length,
    0
  );
  return {
    content: faqToPlainText(structured),
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'faq',
      structured,
      questionCount,
    },
  };
}

async function generateChangelogEntry(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate a changelog entry.

Guidance:
- Version follows semantic versioning (e.g. "1.2.0")
- Date is an ISO date string (YYYY-MM-DD)
- Group changes into added / changed / fixed / removed buckets
- Be specific about what changed, each bullet one sentence
- Buckets can be empty arrays if nothing fits them

Return a JSON object matching the ChangelogEntryContentSchema.`
  );
  const structured = await llm.generateJSON(
    ChangelogEntryContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  return {
    content: changelogEntryToPlainText(structured),
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'changelog_entry',
      structured,
      version: structured.version,
    },
  };
}

async function generateTips(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate 5-8 actionable launch tips for this product.

Guidance:
- Tips must be specific to this product's positioning, tone, and category
- Speak directly to a developer audience, never generic marketing platitudes
- Action-oriented: tell the reader what to do
- Each tip is one sentence
- Reference concrete details from the strategy and research where it sharpens the advice

Return a JSON object matching the TipsContentSchema.`
  );
  const structured = await llm.generateJSON(
    TipsContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  return {
    content: tipsToPlainText(structured),
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'tips',
      structured,
      tipCount: structured.tips.length,
    },
  };
}

async function generateVoiceCommercial(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate a 30-second voice commercial script for this product.

Guidance:
- Hook names the pain point in one sentence
- Body is 60-90 words of flowing prose, a single punch followed by one differentiator
- Call to action is the closing spoken line
- Conversational but tight — every word earns its place
- No stage directions, speaker labels, or production notes

Return a JSON object matching the VoiceCommercialContentSchema.`
  );
  const structured = await llm.generateJSON(
    VoiceCommercialContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  const wordCount = structured.body
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  return {
    content: voiceCommercialToPlainText(structured),
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'voice_commercial',
      structured,
      wordCount,
      estimatedDurationSeconds: Math.round(wordCount / 2.5),
    },
  };
}

async function generatePodcastScript(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const systemPrompt = withStructuredPreamble(
    `Generate a 2-3 minute podcast dialog between two hosts named Alex and Sam discussing this product.

Guidance:
- 18-30 alternating dialog lines
- Alex asks the questions a curious developer would ask
- Sam adds technical depth, counterpoints, and specifics
- The product is the subject throughout
- Natural rhythm; short reactions are fine
- End on a clear "where to go next" line

Return a JSON object matching the PodcastScriptContentSchema.`
  );
  const structured = await llm.generateJSON(
    PodcastScriptContentSchema,
    systemPrompt,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS }
  );
  // Compute speaker turn and duration estimates the same way the
  // old regex-based path did, so existing review and display code
  // that reads these fields off metadata keeps working.
  let speakerTurns = 0;
  let lastSpeaker: string | null = null;
  let totalWords = 0;
  for (const line of structured.lines) {
    if (line.speaker !== lastSpeaker) {
      speakerTurns += 1;
      lastSpeaker = line.speaker;
    }
    totalWords += line.text.split(/\s+/).filter((w) => w.length > 0).length;
  }
  const estimatedDurationSeconds = Math.round(totalWords / 2.3 + speakerTurns * 0.4);

  return {
    content: podcastScriptToPlainText(structured),
    metadata: {
      ...buildBaseMetadata(input),
      contentShape: 'podcast_script',
      structured,
      lineCount: structured.lines.length,
      speakerTurns,
      estimatedDurationSeconds,
    },
  };
}

// =====================================================================
// Voiceover script — legacy parser path
// =====================================================================

/**
 * Voiceover script uses a bespoke `[SCREEN: ...] "line"` format
 * that predates this file's structured-output migration. The
 * existing parser (`parseVoiceoverScript`) is already structured
 * and consumed downstream by the narration pipeline, so the
 * rewrite keeps its prompt-and-parse flow unchanged. Content
 * field stores the raw script (minus any markdown drift the
 * NO_MARKDOWN rules suppress); `metadata.segments` is the parser's
 * typed output.
 */
const VOICEOVER_SCRIPT_PROMPT = `${NO_MARKDOWN_PROMPT_RULES}

You are a video script writer for developer product demos. Write a voiceover script that:
- Is 30-60 seconds when read aloud
- Opens with the problem statement
- Shows the solution in action (describe what's on screen)
- Highlights 2-3 key features
- Ends with a clear CTA
- Uses a natural, conversational tone
- Must use only repeated blocks in this exact format:
  [SCREEN: short visual cue]
  "One spoken line."
- Each spoken line must be exactly one quoted line
- Include no markdown fences, headings, bullets, or explanation outside the blocks
- Use 3-5 blocks total

Output format:
[SCREEN: description]
"Voiceover text"`;

async function generateVoiceoverScript(
  llm: LLMClient,
  input: WriterInput
): Promise<WriterResult> {
  const content = await llm.generateContent(
    VOICEOVER_SCRIPT_PROMPT,
    buildContext(input),
    { maxTokens: DEFAULT_MAX_TOKENS, temperature: 0.7 }
  );
  const parsed = parseVoiceoverScript(content);
  return {
    content,
    metadata: {
      ...buildBaseMetadata(input),
      segments: parsed.segments,
      plainText: parsed.plainText,
      segmentCount: parsed.segmentCount,
    },
  };
}

// =====================================================================
// Dispatch
// =====================================================================

/**
 * Map from the asset-type literal to the generator function. Keys
 * must exactly match the entries in the `assetTypeEnum` pgEnum so
 * an unknown asset type falls through to the blog-post default
 * (preserves the behavior of the previous implementation).
 */
const GENERATOR_BY_TYPE: Partial<
  Record<
    AssetType,
    (llm: LLMClient, input: WriterInput) => Promise<WriterResult>
  >
> = {
  blog_post: generateBlogPost,
  twitter_thread: generateTwitterThread,
  linkedin_post: generateLinkedInPost,
  product_hunt_description: generateProductHunt,
  hacker_news_post: generateHackerNewsPost,
  faq: generateFaq,
  changelog_entry: generateChangelogEntry,
  tips: generateTips,
  voice_commercial: generateVoiceCommercial,
  podcast_script: generatePodcastScript,
  voiceover_script: generateVoiceoverScript,
};

/**
 * Type of the function returned by `makeGenerateWrittenAsset`.
 * Re-exported so other agents in this package (podcast-script,
 * voice-commercial) can depend on the generator's shape without
 * importing the factory.
 */
export type GenerateWrittenAsset = (
  input: WriterInput
) => Promise<WriterResult>;

export function makeGenerateWrittenAsset(
  deps: WriterAgentDeps
): GenerateWrittenAsset {
  return async function generateWrittenAsset(
    input: WriterInput
  ): Promise<WriterResult> {
    const generator = GENERATOR_BY_TYPE[input.assetType] ?? generateBlogPost;
    return generator(deps.llm, input);
  };
}
