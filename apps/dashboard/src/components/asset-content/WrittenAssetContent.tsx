import { useMemo, type ReactNode } from 'react';
import {
  BlogPostContentSchema,
  ChangelogEntryContentSchema,
  FaqContentSchema,
  HackerNewsPostContentSchema,
  LinkedInPostContentSchema,
  PodcastScriptContentSchema,
  ProductHuntContentSchema,
  TipsContentSchema,
  TwitterThreadContentSchema,
  VoiceCommercialContentSchema,
  parseJsonbColumn,
} from '@launchkit/shared';
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
} from '@launchkit/shared';
import type { Asset } from '../../lib/api.js';

/**
 * Renders the body of a written asset using the structured content
 * stored in `asset.metadata.structured`. Each asset type gets its
 * own dedicated body component with purpose-built typography and
 * layout — blog posts look like articles, twitter threads look like
 * stacks of tweets, product hunt descriptions look like launch
 * pages, etc. All rendering happens from typed fields only, so no
 * markdown artifacts (asterisks, em dashes, `---`) can leak into
 * the visible output.
 *
 * The dispatcher reads `metadata.contentShape` as a discriminator
 * and routes to the matching renderer. If the shape is missing or
 * the parse fails (legacy pre-structured-output assets), falls
 * back to the existing plain-text rendering of `asset.content`.
 *
 * Every renderer validates the `metadata.structured` field via
 * `parseJsonbColumn` at render time. Validation failure is a
 * non-blocking event: we log and degrade to the fallback text
 * renderer so a single malformed row never takes down the detail
 * page.
 */
export interface WrittenAssetContentProps {
  asset: Asset;
}

/**
 * Tagged union of every structured content type the dashboard
 * knows how to render. Each variant carries the parsed, typed
 * content object so downstream consumers (the renderer, the
 * copy-as-markdown button) can switch on `kind` and use the
 * narrowed content without re-validating.
 */
export type StructuredAssetContent =
  | { kind: 'blog_post'; content: BlogPostContent }
  | { kind: 'twitter_thread'; content: TwitterThreadContent }
  | { kind: 'linkedin_post'; content: LinkedInPostContent }
  | { kind: 'product_hunt'; content: ProductHuntContent }
  | { kind: 'hacker_news_post'; content: HackerNewsPostContent }
  | { kind: 'faq'; content: FaqContent }
  | { kind: 'changelog_entry'; content: ChangelogEntryContent }
  | { kind: 'tips'; content: TipsContent }
  | { kind: 'voice_commercial'; content: VoiceCommercialContent }
  | { kind: 'podcast_script'; content: PodcastScriptContent };

/**
 * Parse the structured content off an asset's metadata. Returns
 * null when the asset is a legacy pre-migration asset (no
 * `contentShape` discriminator) OR when the schema parse fails
 * for any reason — callers fall back to the plain-text renderer
 * in both cases.
 *
 * Exposed so non-rendering consumers (the copy-as-markdown button,
 * future export features) can share the same dispatch table as
 * the body renderer without duplicating the switch.
 */
export function parseStructuredAssetContent(
  asset: Asset
): StructuredAssetContent | null {
  const meta = asset.metadata;
  if (meta === null) return null;
  const shape = meta['contentShape'];
  const structured = meta['structured'];
  if (typeof shape !== 'string' || structured === undefined) return null;

  try {
    switch (shape) {
      case 'blog_post':
        return {
          kind: 'blog_post',
          content: parseJsonbColumn(
            BlogPostContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      case 'twitter_thread':
        return {
          kind: 'twitter_thread',
          content: parseJsonbColumn(
            TwitterThreadContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      case 'linkedin_post':
        return {
          kind: 'linkedin_post',
          content: parseJsonbColumn(
            LinkedInPostContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      case 'product_hunt':
        return {
          kind: 'product_hunt',
          content: parseJsonbColumn(
            ProductHuntContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      case 'hacker_news_post':
        return {
          kind: 'hacker_news_post',
          content: parseJsonbColumn(
            HackerNewsPostContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      case 'faq':
        return {
          kind: 'faq',
          content: parseJsonbColumn(
            FaqContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      case 'changelog_entry':
        return {
          kind: 'changelog_entry',
          content: parseJsonbColumn(
            ChangelogEntryContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      case 'tips':
        return {
          kind: 'tips',
          content: parseJsonbColumn(
            TipsContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      case 'voice_commercial':
        return {
          kind: 'voice_commercial',
          content: parseJsonbColumn(
            VoiceCommercialContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      case 'podcast_script':
        return {
          kind: 'podcast_script',
          content: parseJsonbColumn(
            PodcastScriptContentSchema,
            structured,
            'asset.metadata.structured'
          ),
        };
      default:
        return null;
    }
  } catch (err) {
    // Degradation to the fallback renderer is the intentional
    // behavior here, but the error itself should still be
    // observable so a malformed structured row surfaces in the
    // browser devtools instead of disappearing silently. Per
    // CLAUDE.md's "Never swallow errors silently" rule, log the
    // provenance (asset id + the parse error) and then return
    // null so the component falls through to FallbackTextBody.
    console.error(
      `parseStructuredAssetContent failed for asset ${asset.id}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function renderStructured(
  structured: StructuredAssetContent
): ReactNode {
  switch (structured.kind) {
    case 'blog_post':
      return <BlogPostBody content={structured.content} />;
    case 'twitter_thread':
      return <TwitterThreadBody content={structured.content} />;
    case 'linkedin_post':
      return <LinkedInPostBody content={structured.content} />;
    case 'product_hunt':
      return <ProductHuntBody content={structured.content} />;
    case 'hacker_news_post':
      return <HackerNewsPostBody content={structured.content} />;
    case 'faq':
      return <FaqBody content={structured.content} />;
    case 'changelog_entry':
      return <ChangelogEntryBody content={structured.content} />;
    case 'tips':
      return <TipsBody content={structured.content} />;
    case 'voice_commercial':
      return <VoiceCommercialBody content={structured.content} />;
    case 'podcast_script':
      return <PodcastScriptBody content={structured.content} />;
  }
}

export function WrittenAssetContent({ asset }: WrittenAssetContentProps) {
  const structured = useMemo(() => parseStructuredAssetContent(asset), [asset]);

  if (structured !== null) {
    return <>{renderStructured(structured)}</>;
  }

  // Fallback — render the plain-text `content` field. For
  // structured assets the plain-text form is already clean
  // (no markdown), and for legacy pre-migration assets we keep
  // the previous `<pre>` renderer so nothing in the archive
  // disappears.
  return <FallbackTextBody content={asset.content} />;
}

// =====================================================================
// Fallback
// =====================================================================

function FallbackTextBody({ content }: { content: string | null }) {
  if (content === null || content.length === 0) {
    return (
      <p className="text-body-sm text-text-muted">No content available.</p>
    );
  }
  return (
    <pre className="whitespace-pre-wrap font-sans text-body-sm leading-relaxed text-surface-300">
      {content}
    </pre>
  );
}

// =====================================================================
// Blog post
// =====================================================================

function BlogPostBody({ content }: { content: BlogPostContent }) {
  return (
    <article className="space-y-6 text-surface-200">
      <header className="space-y-2">
        <h1 className="font-display text-display-md text-text-primary">
          {content.title}
        </h1>
        <p className="text-body-lg text-text-secondary">{content.subtitle}</p>
      </header>
      <p className="text-body-md leading-relaxed text-text-secondary">
        {content.intro}
      </p>
      {content.sections.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h3 className="text-heading-md text-text-primary">
            {section.heading}
          </h3>
          {section.paragraphs.map((paragraph, idx) => (
            <p
              key={`${section.heading}-${idx.toString()}`}
              className="text-body-md leading-relaxed text-text-secondary"
            >
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      <p className="text-body-md leading-relaxed text-text-secondary">
        {content.closing}
      </p>
      <p className="font-mono text-body-xs text-text-muted">
        slug: {content.suggestedSlug}
      </p>
    </article>
  );
}

// =====================================================================
// Twitter thread
// =====================================================================

function TwitterThreadBody({ content }: { content: TwitterThreadContent }) {
  return (
    <div className="space-y-3">
      <TweetCard number={1} text={content.hookTweet} isHook />
      {content.tweets.map((tweet) => (
        <TweetCard key={tweet.number} number={tweet.number} text={tweet.text} />
      ))}
      <TweetCard
        number={content.tweets.length + 2}
        text={content.cta}
        isCta
      />
      {content.hashtags.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {content.hashtags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-accent-500/30 bg-accent-500/10 px-3 py-1 font-mono text-body-xs text-accent-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TweetCard({
  number,
  text,
  isHook = false,
  isCta = false,
}: {
  number: number;
  text: string;
  isHook?: boolean;
  isCta?: boolean;
}) {
  const borderClass = isHook
    ? 'border-accent-500/40 bg-accent-500/[0.06]'
    : isCta
      ? 'border-accent-500/30 bg-surface-900'
      : 'border-surface-800 bg-surface-900/70';
  return (
    <div className={`rounded-xl border px-4 py-3 ${borderClass}`}>
      <div className="mb-1 font-mono text-body-xs text-text-muted">
        {number.toString()} / {isHook ? 'hook' : isCta ? 'cta' : 'body'}
      </div>
      <p className="text-body-md leading-relaxed text-text-primary">{text}</p>
    </div>
  );
}

// =====================================================================
// LinkedIn post
// =====================================================================

function LinkedInPostBody({ content }: { content: LinkedInPostContent }) {
  return (
    <div className="space-y-4 text-surface-200">
      <p className="text-heading-md text-text-primary">{content.hook}</p>
      <div className="space-y-3">
        {content.body.map((paragraph, idx) => (
          <p
            key={idx.toString()}
            className="text-body-md leading-relaxed text-text-secondary"
          >
            {paragraph}
          </p>
        ))}
      </div>
      <p className="text-body-md italic text-accent-300">
        {content.closingQuestion}
      </p>
    </div>
  );
}

// =====================================================================
// Product Hunt
// =====================================================================

function ProductHuntBody({ content }: { content: ProductHuntContent }) {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="label">Tagline</p>
        <h2 className="font-display text-display-md text-text-primary">
          {content.tagline}
        </h2>
      </header>
      <p className="text-body-md leading-relaxed text-text-secondary">
        {content.description}
      </p>
      <div className="space-y-3">
        <p className="label">Key features</p>
        <ul className="space-y-3">
          {content.keyFeatures.map((feature) => (
            <li
              key={feature.name}
              className="flex items-start gap-3 rounded-lg border border-surface-800 bg-surface-900/60 p-3"
            >
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent-400" />
              <div>
                <p className="text-heading-sm text-text-primary">
                  {feature.name}
                </p>
                <p className="mt-0.5 text-body-sm text-text-secondary">
                  {feature.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="label mb-1">Built with</p>
        <p className="text-body-sm text-text-secondary">{content.techStack}</p>
      </div>
      <div>
        <p className="label mb-2">Maker&apos;s first comment</p>
        <blockquote className="rounded-lg border-l-2 border-accent-500/50 bg-surface-900/40 px-4 py-3 text-body-sm italic text-text-secondary">
          {content.firstComment}
        </blockquote>
      </div>
    </div>
  );
}

// =====================================================================
// Hacker News Show HN
// =====================================================================

function HackerNewsPostBody({ content }: { content: HackerNewsPostContent }) {
  return (
    <div className="space-y-5">
      <h2 className="font-mono text-heading-md text-accent-200">
        {content.title}
      </h2>
      <section>
        <p className="label mb-1">Motivation</p>
        <p className="text-body-md leading-relaxed text-text-secondary">
          {content.motivation}
        </p>
      </section>
      <p className="text-body-md leading-relaxed text-text-secondary">
        {content.body}
      </p>
      <section>
        <p className="label mb-2">Technical decisions</p>
        <ul className="space-y-1.5">
          {content.technicalDecisions.map((decision, idx) => (
            <li
              key={idx.toString()}
              className="flex items-start gap-2 text-body-sm text-text-secondary"
            >
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-muted" />
              <span>{decision}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <p className="label mb-1">Limitations</p>
        <p className="text-body-sm text-text-tertiary">{content.limitations}</p>
      </section>
    </div>
  );
}

// =====================================================================
// FAQ
// =====================================================================

function FaqBody({ content }: { content: FaqContent }) {
  return (
    <div className="space-y-6">
      {content.groups.map((group) => (
        <section key={group.category} className="space-y-3">
          <p className="label">{group.category}</p>
          <div className="space-y-3">
            {group.entries.map((entry) => (
              <div
                key={entry.question}
                className="rounded-lg border border-surface-800 bg-surface-900/60 p-4"
              >
                <p className="text-heading-sm text-text-primary">
                  {entry.question}
                </p>
                <p className="mt-2 text-body-sm leading-relaxed text-text-secondary">
                  {entry.answer}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// =====================================================================
// Changelog entry
// =====================================================================

function ChangelogEntryBody({
  content,
}: {
  content: ChangelogEntryContent;
}) {
  return (
    <div className="space-y-5">
      <header className="flex items-baseline gap-3">
        <h2 className="font-mono text-heading-md text-text-primary">
          v{content.version}
        </h2>
        <span className="font-mono text-body-xs text-text-muted">
          {content.date}
        </span>
      </header>
      <p className="text-body-md text-text-secondary">{content.summary}</p>
      <ChangelogBucket label="Added" items={content.added} tone="accent" />
      <ChangelogBucket label="Changed" items={content.changed} tone="neutral" />
      <ChangelogBucket label="Fixed" items={content.fixed} tone="neutral" />
      <ChangelogBucket
        label="Removed"
        items={content.removed}
        tone="warning"
      />
    </div>
  );
}

function ChangelogBucket({
  label,
  items,
  tone,
}: {
  label: string;
  items: readonly string[];
  tone: 'accent' | 'neutral' | 'warning';
}) {
  if (items.length === 0) return null;
  const dotClass =
    tone === 'accent'
      ? 'bg-accent-400'
      : tone === 'warning'
        ? 'bg-yellow-500'
        : 'bg-text-muted';
  return (
    <section>
      <p className="label mb-2">{label}</p>
      <ul className="space-y-1.5">
        {items.map((item, idx) => (
          <li
            key={idx.toString()}
            className="flex items-start gap-2 text-body-sm text-text-secondary"
          >
            <span
              className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${dotClass}`}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// =====================================================================
// Tips
// =====================================================================

function TipsBody({ content }: { content: TipsContent }) {
  return (
    <ol className="space-y-3">
      {content.tips.map((tip, idx) => (
        <li
          key={idx.toString()}
          className="flex items-start gap-3 rounded-lg border border-surface-800 bg-surface-900/60 p-3"
        >
          <span className="font-mono text-body-xs text-accent-300">
            {(idx + 1).toString().padStart(2, '0')}
          </span>
          <p className="text-body-sm text-text-secondary">{tip}</p>
        </li>
      ))}
    </ol>
  );
}

// =====================================================================
// Voice commercial
// =====================================================================

function VoiceCommercialBody({
  content,
}: {
  content: VoiceCommercialContent;
}) {
  return (
    <div className="space-y-4">
      <p className="text-heading-md italic text-text-primary">{content.hook}</p>
      <p className="text-body-md leading-relaxed text-text-secondary">
        {content.body}
      </p>
      <p className="text-heading-sm text-accent-300">{content.callToAction}</p>
    </div>
  );
}

// =====================================================================
// Podcast script
// =====================================================================

function PodcastScriptBody({ content }: { content: PodcastScriptContent }) {
  return (
    <div className="space-y-3">
      {content.lines.map((line, idx) => {
        const isAlex = line.speaker === 'Alex';
        return (
          <div
            key={idx.toString()}
            className={`flex gap-3 ${isAlex ? '' : 'flex-row-reverse'}`}
          >
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-body-xs ${
                isAlex
                  ? 'bg-accent-500/15 text-accent-300'
                  : 'bg-surface-800 text-text-tertiary'
              }`}
            >
              {line.speaker}
            </span>
            <p
              className={`text-body-sm text-text-secondary ${
                isAlex ? 'text-left' : 'text-right'
              }`}
            >
              {line.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
