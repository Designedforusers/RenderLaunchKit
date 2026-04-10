import { z } from 'zod';

/**
 * Structured shapes for LLM-generated written asset content.
 *
 * Background: the writer agent in `@launchkit/asset-generators` used
 * to ask Claude for a single markdown blob per asset type and then
 * regex the blob apart after the fact. That blob rendered in the
 * dashboard as raw markdown — `**Tagline:**`, `---`, em dashes,
 * asterisks — because the dashboard treats `assets.content` as
 * opaque text and drops it into a `<pre>` tag. The schemas in this
 * file are the move to structured outputs: the writer agent now
 * calls `llm.generateJSON(ContentSchema, prompt)` for every type
 * that has a schema here, and the dashboard reads the structured
 * fields off `asset.metadata` via `parseJsonbColumn` and renders
 * them with a purpose-built component per type.
 *
 * Rollout is per-type. PR 1 ships the infra plus Product Hunt as a
 * proof; remaining written asset types follow in subsequent PRs and
 * fall through to the existing markdown-blob path in the meantime.
 *
 * TODO: Upgrade `generateJSON` to use Anthropic's native structured
 * outputs API (`output_config.format`) once the SDK version in the
 * worker + workflows copies of `anthropic-claude-client.ts` support
 * it. Current implementation is prompt-and-parse with Zod, which
 * gives us the same schema guarantees at the boundary but slightly
 * higher latency variance than a grammar-constrained decoder.
 */

// =====================================================================
// Blog post
// =====================================================================

/**
 * A titled section inside a blog post body.
 *
 * A section is a heading plus one or more paragraphs. Paragraphs
 * are stored as an array of strings so the dashboard renderer can
 * put visible spacing between them without relying on `\n\n` in
 * the text itself — `\n\n` in a rendered `<p>` tag is collapsed by
 * the browser and reads as a single paragraph.
 */
export const BlogPostSectionSchema = z.object({
  heading: z
    .string()
    .describe(
      'Section heading, 2-8 words, plain text, no markdown, no em dashes, no asterisks, no trailing punctuation.'
    ),
  paragraphs: z
    .array(z.string())
    .min(1)
    .describe(
      'Array of paragraphs under this section. Each paragraph is plain prose, no markdown, no em dashes, no asterisks.'
    ),
});
export type BlogPostSection = z.infer<typeof BlogPostSectionSchema>;

/**
 * Full structured body of a blog post.
 *
 * Fields map to a canonical tech blog layout: a title, an optional
 * subtitle, an intro paragraph that hooks the reader, 3-6 body
 * sections each with their own heading and paragraphs, and a
 * closing paragraph. `suggestedSlug` is a URL-safe slug the
 * dashboard can surface if the user wants to publish.
 */
export const BlogPostContentSchema = z.object({
  title: z
    .string()
    .describe(
      'Article title, 4-12 words, plain text, no markdown, no em dashes, no asterisks. Title case or sentence case, no trailing punctuation unless a question mark.'
    ),
  subtitle: z
    .string()
    .describe(
      'One-line subtitle, 6-16 words, plain prose, no markdown, no em dashes, no asterisks. Clarifies the hook in the title.'
    ),
  intro: z
    .string()
    .describe(
      'Opening paragraph, 2-4 sentences, plain prose. Identifies the pain point or hook. No markdown, no em dashes, no asterisks.'
    ),
  sections: z
    .array(BlogPostSectionSchema)
    .describe(
      'Body sections, 3-6 total. Each section has a heading and an array of paragraphs.'
    ),
  closing: z
    .string()
    .describe(
      'Closing paragraph, 2-4 sentences, plain prose. Calls out the action you want the reader to take. No markdown, no em dashes, no asterisks.'
    ),
  suggestedSlug: z
    .string()
    .describe(
      'URL-safe slug for this post. Lowercase letters, digits, and hyphens only. No spaces, no punctuation.'
    ),
});
export type BlogPostContent = z.infer<typeof BlogPostContentSchema>;

// =====================================================================
// Twitter / X thread
// =====================================================================

/**
 * One tweet in a numbered thread.
 *
 * `number` is the 1-indexed position in the thread and `text` is
 * the body of the tweet, capped to Twitter's 280-character limit.
 * Structured-output schemas don't support `maxLength` on strings,
 * so the limit is described for the LLM and the dashboard renderer
 * clamps it at display time.
 */
export const TwitterTweetSchema = z.object({
  number: z
    .number()
    .int()
    .min(1)
    .describe('1-indexed position of the tweet in the thread.'),
  text: z
    .string()
    .describe(
      'Body of the tweet. Under 280 characters. Plain text, no markdown, no em dashes, no asterisks, no leading "1/", "2/" numbering (the number field already carries that).'
    ),
});
export type TwitterTweet = z.infer<typeof TwitterTweetSchema>;

/**
 * Full structured body of a Twitter / X thread.
 */
export const TwitterThreadContentSchema = z.object({
  hookTweet: z
    .string()
    .describe(
      'The first tweet in the thread. Under 280 characters. A scroll-stopping hook, question, claim, or stat. Plain text, no numbering prefix, no markdown, no em dashes, no asterisks.'
    ),
  tweets: z
    .array(TwitterTweetSchema)
    .describe(
      'Body tweets of the thread, 4-9 total (not counting the hook tweet). Numbered starting at 2 since the hook is tweet 1.'
    ),
  cta: z
    .string()
    .describe(
      'Closing call-to-action tweet. Under 280 characters. Asks the reader to try, star, or share. Plain text, no markdown, no em dashes, no asterisks.'
    ),
  hashtags: z
    .array(z.string())
    .describe(
      'Suggested hashtags for the thread, each starting with # and no spaces. Plain text.'
    ),
});
export type TwitterThreadContent = z.infer<typeof TwitterThreadContentSchema>;

// =====================================================================
// LinkedIn post
// =====================================================================

export const LinkedInPostContentSchema = z.object({
  hook: z
    .string()
    .describe(
      'The first 1-2 lines of the post, the part LinkedIn shows before "see more". Thought-provoking, plain text, no markdown, no em dashes, no asterisks.'
    ),
  body: z
    .array(z.string())
    .describe(
      'Body paragraphs. 2-6 short paragraphs, each 1-3 sentences. Plain prose, no markdown, no em dashes, no asterisks.'
    ),
  closingQuestion: z
    .string()
    .describe(
      'A single-sentence question at the end of the post that drives comment engagement. Plain text, no markdown, no em dashes, no asterisks.'
    ),
});
export type LinkedInPostContent = z.infer<typeof LinkedInPostContentSchema>;

// =====================================================================
// Hacker News Show HN post
// =====================================================================

export const HackerNewsPostContentSchema = z.object({
  title: z
    .string()
    .describe(
      'Title of the post. Must start with "Show HN: ". Follow with product name, a colon, and a short description. Plain text, no markdown, no em dashes, no asterisks.'
    ),
  motivation: z
    .string()
    .describe(
      'Why you built it. 1-3 sentences. Conversational and specific. No markdown, no em dashes, no asterisks.'
    ),
  body: z
    .string()
    .describe(
      'Main body of the post. 2-5 sentences explaining what it does and the interesting technical decisions. Conversational, humble, technical. No markdown, no em dashes, no asterisks.'
    ),
  technicalDecisions: z
    .array(z.string())
    .describe(
      'Key technical choices worth calling out, each one sentence. Plain text, no markdown, no em dashes, no asterisks.'
    ),
  limitations: z
    .string()
    .describe(
      'An honest note about current limitations, 1-3 sentences. Plain text, no markdown, no em dashes, no asterisks.'
    ),
});
export type HackerNewsPostContent = z.infer<typeof HackerNewsPostContentSchema>;

// =====================================================================
// FAQ
// =====================================================================

export const FaqEntrySchema = z.object({
  question: z
    .string()
    .describe(
      'A single question a developer would ask, ending with a question mark. Plain text, no markdown, no em dashes, no asterisks.'
    ),
  answer: z
    .string()
    .describe(
      'Answer to the question, 1-4 sentences. Plain prose, no markdown, no em dashes, no asterisks.'
    ),
});
export type FaqEntry = z.infer<typeof FaqEntrySchema>;

export const FaqGroupSchema = z.object({
  category: z
    .string()
    .describe(
      'Category label for a group of related questions, 1-3 words. Plain text, no markdown, no em dashes, no trailing punctuation.'
    ),
  entries: z
    .array(FaqEntrySchema)
    .min(1)
    .describe('Questions and answers in this category.'),
});
export type FaqGroup = z.infer<typeof FaqGroupSchema>;

export const FaqContentSchema = z.object({
  groups: z
    .array(FaqGroupSchema)
    .describe(
      'Question groups, 2-5 total. Each group bundles related questions under a short category label.'
    ),
});
export type FaqContent = z.infer<typeof FaqContentSchema>;

// =====================================================================
// Changelog entry
// =====================================================================

export const ChangelogEntryContentSchema = z.object({
  version: z
    .string()
    .describe(
      'Semantic version string, e.g. "1.2.0". No markdown, no em dashes.'
    ),
  date: z
    .string()
    .describe('ISO date string, YYYY-MM-DD format.'),
  summary: z
    .string()
    .describe(
      'One-line summary of the release. Plain text, no markdown, no em dashes, no asterisks.'
    ),
  added: z
    .array(z.string())
    .describe(
      'New features added in this release. Each item one sentence. Plain text, no markdown, no em dashes, no asterisks. Empty array if nothing added.'
    ),
  changed: z
    .array(z.string())
    .describe(
      'Behavior changes to existing features. Same formatting rules as added.'
    ),
  fixed: z
    .array(z.string())
    .describe(
      'Bugs fixed. Same formatting rules as added.'
    ),
  removed: z
    .array(z.string())
    .describe(
      'Features or APIs removed. Same formatting rules as added.'
    ),
});
export type ChangelogEntryContent = z.infer<typeof ChangelogEntryContentSchema>;

// =====================================================================
// Tips list
// =====================================================================

export const TipsContentSchema = z.object({
  tips: z
    .array(z.string())
    .describe(
      '5-8 actionable launch tips, each one sentence. Plain prose, no markdown, no em dashes, no asterisks, no leading numbering (the renderer adds numbers).'
    ),
});
export type TipsContent = z.infer<typeof TipsContentSchema>;

// =====================================================================
// Voice commercial (30-second ad script)
// =====================================================================

export const VoiceCommercialContentSchema = z.object({
  hook: z
    .string()
    .describe(
      'Opening line that names the pain. One sentence. Plain prose, no markdown, no em dashes, no asterisks.'
    ),
  body: z
    .string()
    .describe(
      'Main body of the commercial, 60-90 words. Flowing prose, no stage directions, no speaker labels, no markdown, no em dashes, no asterisks, no quotation marks around the whole body.'
    ),
  callToAction: z
    .string()
    .describe(
      'Closing call to action as the final spoken line. Plain prose, one sentence, no markdown, no em dashes, no asterisks.'
    ),
});
export type VoiceCommercialContent = z.infer<typeof VoiceCommercialContentSchema>;

// =====================================================================
// Podcast script (two-host dialog)
// =====================================================================

export const PodcastLineSchema = z.object({
  speaker: z
    .enum(['Alex', 'Sam'])
    .describe('Speaker of this line. Alex or Sam only.'),
  text: z
    .string()
    .describe(
      'Spoken text for this line. Plain prose, no stage directions, no parenthetical asides, no markdown, no em dashes, no asterisks.'
    ),
});
export type PodcastLine = z.infer<typeof PodcastLineSchema>;

export const PodcastScriptContentSchema = z.object({
  lines: z
    .array(PodcastLineSchema)
    .describe(
      '18-30 alternating dialog lines between Alex and Sam. Alex asks the questions a curious developer would ask; Sam adds technical depth and specifics.'
    ),
});
export type PodcastScriptContent = z.infer<typeof PodcastScriptContentSchema>;

// =====================================================================
// Product Hunt (already defined below)
// =====================================================================

/**
 * A single bullet in the Product Hunt "Key Features" list.
 *
 * Intentionally flat — a nested object per feature keeps the
 * dashboard renderer typed without forcing it to parse inline
 * markdown within a feature description. If a feature needs more
 * structure in the future, add siblings here rather than nesting.
 */
export const ProductHuntFeatureSchema = z.object({
  name: z
    .string()
    .describe('Short name of the feature, 1-4 words. No trailing punctuation.'),
  description: z
    .string()
    .describe(
      'One sentence describing what the feature does. Plain prose, no markdown, no em dashes, no asterisks. Use a comma or period instead of a dash for clause separation.'
    ),
});
export type ProductHuntFeature = z.infer<typeof ProductHuntFeatureSchema>;

/**
 * Full structured body of a Product Hunt description.
 *
 * Field notes for prompt writers and dashboard renderers:
 *
 *   - `tagline` is the one-line hook shown next to the product name
 *     on Product Hunt. Hard character limit of 60 to match the real
 *     Product Hunt constraint.
 *   - `description` is the longer elevator pitch, 2-4 sentences,
 *     rendered as body copy.
 *   - `keyFeatures` is 3-5 bullets, rendered as a typed list.
 *   - `techStack` is a short sentence naming the tech the product is
 *     built with. Rendered as a single line below the features.
 *   - `firstComment` is the maker's first comment on the launch
 *     thread — expected to be conversational and not more than 3
 *     sentences. Rendered as its own block.
 */
export const ProductHuntContentSchema = z.object({
  tagline: z
    .string()
    .min(1)
    .max(60)
    .describe(
      'One-line hook for Product Hunt, under 60 characters. Plain text. No markdown, no em dashes, no asterisks, no quotation marks, no trailing punctuation unless it is a question mark.'
    ),
  description: z
    .string()
    .describe(
      '2-4 sentences explaining what the product does and why it matters. Plain prose. No markdown headers, no asterisks, no em dashes, no bullet characters. Separate clauses with commas or periods.'
    ),
  keyFeatures: z
    .array(ProductHuntFeatureSchema)
    .describe('3 to 5 key features, each as a name plus a one-sentence description.'),
  techStack: z
    .string()
    .describe(
      'One sentence naming the main tech the product is built with. Plain prose, no bullet list, no markdown, no em dashes.'
    ),
  firstComment: z
    .string()
    .describe(
      "The maker's first comment on the Product Hunt launch thread. Conversational, 2-3 sentences, plain text, no markdown, no em dashes, no asterisks."
    ),
});
export type ProductHuntContent = z.infer<typeof ProductHuntContentSchema>;

/**
 * Prompt fragment shared by every structured-output writer call and
 * every prose-format writer call. Applied to the CONTENT of each
 * prose field, not the surrounding structural format — asset types
 * with strict structural formats (voiceover_script's [SCREEN: ...]
 * blocks, podcast_script's "Alex:" speaker labels) keep those
 * format markers intact and apply these rules only inside the
 * prose they contain.
 *
 * Zod validation is the second line of defense. The prompt rule is
 * the first, and it keeps field contents clean of punctuation
 * artifacts like em dashes and asterisks inside the prose itself.
 */
export const NO_MARKDOWN_PROMPT_RULES = `PROSE FORMATTING RULES (apply to the content of every prose field or line):
- No markdown emphasis: no **bold**, no _italics_, no \`code\` backticks.
- No markdown headers: no # or ## anywhere in prose.
- No horizontal rules: no --- separator lines.
- No em dashes (—) or en dashes (–) anywhere in prose. Use a comma, a period, a colon, or the word "to" instead.
- No curly quotes (" " ' '). Use straight ASCII quotes if a quote is needed.
- No bullet characters like • or ◦. If a list is required by the format, use a plain dash or a numbered list.
- No arrows (→, ⟶) or other typographic symbols — use the word "then" or "to".
- Write prose as flat sentences. Commas, periods, and colons are the only clause separators.
These rules apply to the CONTENT of prose fields only. Structural delimiters defined by the asset format (for example [SCREEN: ...] blocks or "Alex:" speaker labels) are not considered markdown and must be preserved exactly as specified.
`;
