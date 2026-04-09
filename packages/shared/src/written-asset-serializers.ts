/**
 * Serializers for structured written asset content.
 *
 * Every structured content type in `schemas/written-asset-content.ts`
 * has two serializers here:
 *
 *   - `<type>ToPlainText(content)` — clean UTF-8 plain text with no
 *     markdown syntax, no em dashes, no asterisks. Used as the
 *     value stored in `assets.content` so existing text readers
 *     (search, fallback rendering, download-as-text) keep working
 *     without the LLM token leakage the old markdown-blob flow
 *     produced.
 *
 *   - `<type>ToMarkdown(content)` — pretty markdown rendering with
 *     headings, bullet lists, code fences where appropriate. Used
 *     by the dashboard's "Copy as markdown" button so a user can
 *     paste the content straight into a markdown editor, CMS, or
 *     GitHub issue and get a formatted result. Generation does not
 *     flow through this path, so LLM drift cannot reintroduce
 *     markdown artifacts into the stored content.
 *
 * Keep both serializers pure and deterministic: the plain-text form
 * is content-addressable, and tests should be trivially stable.
 *
 * Intentionally colocated at the package root rather than under a
 * `./schemas/` subfolder because these are transform utilities, not
 * schema definitions. Convention in this repo is that `./schemas/`
 * holds only Zod schemas and type inferences.
 */

import type {
  BlogPostContent,
  ChangelogEntryContent,
  FaqContent,
  HackerNewsPostContent,
  LinkedInPostContent,
  PodcastScriptContent,
  ProductHuntContent,
  TipsContent,
  TwitterThreadContent,
  VoiceCommercialContent,
} from './types.js';

// Joiner used by every to-plain-text serializer — exactly one blank
// line between paragraphs, which is how every existing plain-text
// consumer expects to see prose.
const PARAGRAPH_BREAK = '\n\n';

// =====================================================================
// Blog post
// =====================================================================

export function blogPostToPlainText(content: BlogPostContent): string {
  const parts: string[] = [content.title, content.subtitle, content.intro];
  for (const section of content.sections) {
    parts.push(section.heading);
    for (const paragraph of section.paragraphs) {
      parts.push(paragraph);
    }
  }
  parts.push(content.closing);
  return parts.join(PARAGRAPH_BREAK);
}

export function blogPostToMarkdown(content: BlogPostContent): string {
  const parts: string[] = [
    `# ${content.title}`,
    `## ${content.subtitle}`,
    content.intro,
  ];
  for (const section of content.sections) {
    parts.push(`## ${section.heading}`);
    for (const paragraph of section.paragraphs) {
      parts.push(paragraph);
    }
  }
  parts.push(content.closing);
  return parts.join(PARAGRAPH_BREAK);
}

// =====================================================================
// Twitter / X thread
// =====================================================================

export function twitterThreadToPlainText(
  content: TwitterThreadContent
): string {
  const parts: string[] = [content.hookTweet];
  for (const tweet of content.tweets) {
    parts.push(`${tweet.number.toString()}. ${tweet.text}`);
  }
  parts.push(content.cta);
  if (content.hashtags.length > 0) {
    parts.push(content.hashtags.join(' '));
  }
  return parts.join(PARAGRAPH_BREAK);
}

export function twitterThreadToMarkdown(
  content: TwitterThreadContent
): string {
  const parts: string[] = [`1/ ${content.hookTweet}`];
  for (const tweet of content.tweets) {
    parts.push(`${tweet.number.toString()}/ ${tweet.text}`);
  }
  parts.push(`${(content.tweets.length + 2).toString()}/ ${content.cta}`);
  if (content.hashtags.length > 0) {
    parts.push(content.hashtags.join(' '));
  }
  return parts.join(PARAGRAPH_BREAK);
}

// =====================================================================
// LinkedIn post
// =====================================================================

export function linkedInPostToPlainText(
  content: LinkedInPostContent
): string {
  const parts: string[] = [content.hook, ...content.body, content.closingQuestion];
  return parts.join(PARAGRAPH_BREAK);
}

export function linkedInPostToMarkdown(
  content: LinkedInPostContent
): string {
  // LinkedIn doesn't use markdown so the "markdown" form is just
  // the plain-text form with the same paragraph breaks.
  return linkedInPostToPlainText(content);
}

// =====================================================================
// Hacker News Show HN post
// =====================================================================

export function hackerNewsPostToPlainText(
  content: HackerNewsPostContent
): string {
  const parts: string[] = [content.title, content.motivation, content.body];
  if (content.technicalDecisions.length > 0) {
    parts.push('Technical decisions:');
    for (const decision of content.technicalDecisions) {
      parts.push(`- ${decision}`);
    }
  }
  parts.push(`Limitations: ${content.limitations}`);
  return parts.join(PARAGRAPH_BREAK);
}

export function hackerNewsPostToMarkdown(
  content: HackerNewsPostContent
): string {
  const parts: string[] = [
    `# ${content.title}`,
    content.motivation,
    content.body,
  ];
  if (content.technicalDecisions.length > 0) {
    parts.push('**Technical decisions:**');
    parts.push(content.technicalDecisions.map((d) => `- ${d}`).join('\n'));
  }
  parts.push(`**Limitations:** ${content.limitations}`);
  return parts.join(PARAGRAPH_BREAK);
}

// =====================================================================
// FAQ
// =====================================================================

export function faqToPlainText(content: FaqContent): string {
  const parts: string[] = [];
  for (const group of content.groups) {
    parts.push(group.category);
    for (const entry of group.entries) {
      parts.push(`Q: ${entry.question}`);
      parts.push(`A: ${entry.answer}`);
    }
  }
  return parts.join(PARAGRAPH_BREAK);
}

export function faqToMarkdown(content: FaqContent): string {
  const parts: string[] = [];
  for (const group of content.groups) {
    parts.push(`## ${group.category}`);
    for (const entry of group.entries) {
      parts.push(`### ${entry.question}`);
      parts.push(entry.answer);
    }
  }
  return parts.join(PARAGRAPH_BREAK);
}

// =====================================================================
// Changelog entry
// =====================================================================

function changelogBucket(label: string, items: readonly string[]): string[] {
  if (items.length === 0) return [];
  return [label, items.map((item) => `- ${item}`).join('\n')];
}

export function changelogEntryToPlainText(
  content: ChangelogEntryContent
): string {
  const parts: string[] = [
    `${content.version} (${content.date})`,
    content.summary,
    ...changelogBucket('Added:', content.added),
    ...changelogBucket('Changed:', content.changed),
    ...changelogBucket('Fixed:', content.fixed),
    ...changelogBucket('Removed:', content.removed),
  ];
  return parts.join(PARAGRAPH_BREAK);
}

export function changelogEntryToMarkdown(
  content: ChangelogEntryContent
): string {
  const parts: string[] = [
    `## [${content.version}] - ${content.date}`,
    content.summary,
    ...changelogBucket('### Added', content.added),
    ...changelogBucket('### Changed', content.changed),
    ...changelogBucket('### Fixed', content.fixed),
    ...changelogBucket('### Removed', content.removed),
  ];
  return parts.join(PARAGRAPH_BREAK);
}

// =====================================================================
// Tips list
// =====================================================================

export function tipsToPlainText(content: TipsContent): string {
  return content.tips
    .map((tip, idx) => `${(idx + 1).toString()}. ${tip}`)
    .join('\n');
}

/**
 * The markdown form of a tips list is identical to the plain-text
 * form. Numbered lists of one-sentence tips do not benefit from
 * additional markdown decoration — no emphasis, no nesting, no
 * code fences. The identity is intentional so the "Copy markdown"
 * button produces a clean numbered list that pastes into any
 * markdown editor without artifacts.
 */
export function tipsToMarkdown(content: TipsContent): string {
  return tipsToPlainText(content);
}

// =====================================================================
// Voice commercial
// =====================================================================

export function voiceCommercialToPlainText(
  content: VoiceCommercialContent
): string {
  return [content.hook, content.body, content.callToAction].join(
    PARAGRAPH_BREAK
  );
}

export function voiceCommercialToMarkdown(
  content: VoiceCommercialContent
): string {
  return voiceCommercialToPlainText(content);
}

// =====================================================================
// Podcast script
// =====================================================================

export function podcastScriptToPlainText(
  content: PodcastScriptContent
): string {
  return content.lines.map((line) => `${line.speaker}: ${line.text}`).join('\n');
}

export function podcastScriptToMarkdown(
  content: PodcastScriptContent
): string {
  return content.lines
    .map((line) => `**${line.speaker}:** ${line.text}`)
    .join('\n\n');
}

// =====================================================================
// Product Hunt
// =====================================================================

export function productHuntToPlainText(content: ProductHuntContent): string {
  const parts: string[] = [
    content.tagline,
    content.description,
    'Key features:',
    content.keyFeatures
      .map((f) => `- ${f.name}: ${f.description}`)
      .join('\n'),
    `Built with: ${content.techStack}`,
    `First comment: ${content.firstComment}`,
  ];
  return parts.join(PARAGRAPH_BREAK);
}

export function productHuntToMarkdown(content: ProductHuntContent): string {
  const parts: string[] = [
    `**Tagline:** ${content.tagline}`,
    `**Description:**\n${content.description}`,
    `**Key Features:**\n${content.keyFeatures
      .map((f) => `- **${f.name}:** ${f.description}`)
      .join('\n')}`,
    `**Built with:** ${content.techStack}`,
    `**First comment:**\n${content.firstComment}`,
  ];
  return parts.join(PARAGRAPH_BREAK);
}
