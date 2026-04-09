// Smoke tests for the structured written-asset serializers.
//
// The serializers in `@launchkit/shared/written-asset-serializers`
// convert the per-type structured content objects into two forms:
// (1) clean plain text stored in `assets.content`, and (2) markdown
// emitted by the dashboard's "Copy as markdown" button. The
// plain-text form is the load-bearing one: it is what the user
// sees in the dashboard when an asset card is rendered, and the
// entire reason this refactor exists is to eliminate markdown
// token leakage from that surface.
//
// Every test in this file asserts TWO things:
//   1. The serializer round-trips the canonical fields — the
//      output contains the strings you would expect a reader to
//      be able to find.
//   2. The plain-text form contains NONE of the markdown artifacts
//      the refactor is meant to eliminate. The FORBIDDEN_MARKERS
//      list below is the full set of things we promise to never
//      emit: asterisks (bold/italic), backticks, pound-sign
//      headers, horizontal rules, em dashes, en dashes, curly
//      quotes.
//
// The markdown form is allowed to contain markdown — that is its
// entire purpose — so it only gets the round-trip check.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

// Characters that should never appear in a plain-text serializer's
// output. These are the exact artifacts the user saw on their
// Product Hunt card in the screenshot that kicked off this PR.
const FORBIDDEN_MARKERS = [
  '**',  // bold
  '__',  // italic underscore
  '##',  // header
  '---', // horizontal rule
  '—',   // em dash
  '–',   // en dash
  '“',   // curly opening double quote
  '”',   // curly closing double quote
  '‘',   // curly opening single quote
  '’',   // curly closing single quote
];

function assertNoMarkdownArtifacts(output, label) {
  for (const marker of FORBIDDEN_MARKERS) {
    assert.equal(
      output.includes(marker),
      false,
      `${label} plain-text output contains forbidden marker "${marker}": ${output.slice(0, 200)}`
    );
  }
}

// Lazy dynamic import helper so the dist layout only has to be
// resolved once per suite.
async function loadSerializers() {
  return import('../packages/shared/dist/written-asset-serializers.js');
}

// =====================================================================
// Blog post
// =====================================================================

const BLOG_POST_FIXTURE = {
  title: 'Shipping a Zero Config Queue',
  subtitle: 'A one line setup that just works',
  intro: 'Every background job system starts simple and ends complicated. Here is the one we built to stay simple.',
  sections: [
    {
      heading: 'The Problem',
      paragraphs: [
        'Every other queue library ships with config sprawl.',
        'We wanted one that does not.',
      ],
    },
    {
      heading: 'The Solution',
      paragraphs: [
        'Our queue library picks sensible defaults and lets you override them later.',
      ],
    },
    {
      heading: 'How It Works',
      paragraphs: [
        'A single factory call wires Redis, retries, and DLQs in one line.',
      ],
    },
  ],
  closing: 'Star the repo and try it on your next side project.',
  suggestedSlug: 'shipping-a-zero-config-queue',
};

test('blogPostToPlainText round-trips canonical fields with no markdown artifacts', async () => {
  const { blogPostToPlainText } = await loadSerializers();
  const output = blogPostToPlainText(BLOG_POST_FIXTURE);
  assert.match(output, /Shipping a Zero Config Queue/);
  assert.match(output, /one line setup/);
  assert.match(output, /The Problem/);
  assert.match(output, /sensible defaults/);
  assert.match(output, /Star the repo/);
  assertNoMarkdownArtifacts(output, 'blogPost');
});

test('blogPostToMarkdown renders title + section headers as markdown', async () => {
  const { blogPostToMarkdown } = await loadSerializers();
  const output = blogPostToMarkdown(BLOG_POST_FIXTURE);
  assert.match(output, /^# Shipping a Zero Config Queue/);
  assert.match(output, /## A one line setup that just works/);
  assert.match(output, /## The Problem/);
  assert.match(output, /## How It Works/);
});

// =====================================================================
// Twitter / X thread
// =====================================================================

const TWITTER_FIXTURE = {
  hookTweet: 'What if your Postgres could do vector search without any extensions?',
  tweets: [
    { number: 2, text: 'pgvector is fine but it wants its own install dance.' },
    { number: 3, text: 'We built a pure SQL alternative that works on stock Postgres.' },
    { number: 4, text: 'It is 40 percent slower on HNSW but 100 percent portable.' },
    { number: 5, text: 'For side projects and serverless Postgres, that is a trade worth making.' },
  ],
  cta: 'Star the repo and let us know what you break.',
  hashtags: ['#postgres', '#ai', '#opensource'],
};

test('twitterThreadToPlainText round-trips tweets with clean numbering', async () => {
  const { twitterThreadToPlainText } = await loadSerializers();
  const output = twitterThreadToPlainText(TWITTER_FIXTURE);
  assert.match(output, /What if your Postgres/);
  assert.match(output, /pgvector/);
  assert.match(output, /#postgres/);
  assertNoMarkdownArtifacts(output, 'twitterThread');
});

test('twitterThreadToMarkdown prefixes tweets with N\\/ numbering', async () => {
  const { twitterThreadToMarkdown } = await loadSerializers();
  const output = twitterThreadToMarkdown(TWITTER_FIXTURE);
  assert.match(output, /^1\/ What if/);
  assert.match(output, /\n\n2\/ pgvector/);
});

// =====================================================================
// LinkedIn
// =====================================================================

const LINKEDIN_FIXTURE = {
  hook: 'I spent a decade building payment systems and this is the one thing I kept getting wrong.',
  body: [
    'Idempotency keys are not optional.',
    'They are the reason your double charges disappear on retry.',
    'Skip them and you will find out the hard way.',
  ],
  closingQuestion: 'What is the one thing you wish you had learned earlier in your career?',
};

test('linkedInPostToPlainText renders hook, body paragraphs, and closing question', async () => {
  const { linkedInPostToPlainText } = await loadSerializers();
  const output = linkedInPostToPlainText(LINKEDIN_FIXTURE);
  assert.match(output, /spent a decade/);
  assert.match(output, /Idempotency keys/);
  assert.match(output, /wish you had learned earlier/);
  assertNoMarkdownArtifacts(output, 'linkedInPost');
});

test('linkedInPostToMarkdown is identical to plain text (LinkedIn has no markdown)', async () => {
  const { linkedInPostToMarkdown, linkedInPostToPlainText } = await loadSerializers();
  assert.equal(
    linkedInPostToMarkdown(LINKEDIN_FIXTURE),
    linkedInPostToPlainText(LINKEDIN_FIXTURE)
  );
});

// =====================================================================
// Product Hunt
// =====================================================================

const PRODUCT_HUNT_FIXTURE = {
  tagline: 'The open source Stripe of scheduling',
  description: 'Cal.com is a scheduling infrastructure with extensibility, self hostability, and white label baked in. Every developer-led product will need to solve scheduling eventually.',
  keyFeatures: [
    { name: 'API first', description: 'Every calendar operation maps to a clean REST endpoint.' },
    { name: 'Open core', description: 'Self host the full platform or pay for the hosted tier.' },
    { name: 'Embeddable', description: 'Drop the widget into any React app with three lines of code.' },
  ],
  techStack: 'Built with Next.js, Prisma, and Postgres.',
  firstComment: 'Hey PH. We built Cal.com because Calendly was a black box. Ask us anything about scheduling infrastructure.',
};

test('productHuntToPlainText round-trips tagline, features, and first comment', async () => {
  const { productHuntToPlainText } = await loadSerializers();
  const output = productHuntToPlainText(PRODUCT_HUNT_FIXTURE);
  assert.match(output, /open source Stripe of scheduling/);
  assert.match(output, /API first/);
  assert.match(output, /Built with Next\.js/);
  assert.match(output, /Calendly was a black box/);
  assertNoMarkdownArtifacts(output, 'productHunt');
});

test('productHuntToMarkdown uses bold labels for structured fields', async () => {
  const { productHuntToMarkdown } = await loadSerializers();
  const output = productHuntToMarkdown(PRODUCT_HUNT_FIXTURE);
  assert.match(output, /\*\*Tagline:\*\*/);
  assert.match(output, /\*\*Key Features:\*\*/);
  assert.match(output, /\*\*Built with:\*\*/);
});

// =====================================================================
// Hacker News Show HN
// =====================================================================

const HACKER_NEWS_FIXTURE = {
  title: 'Show HN: A static site generator that compiles to zero JavaScript',
  motivation: 'I was tired of every static site generator shipping 200kb of hydration code by default.',
  body: 'This tool takes a markdown tree and emits pure HTML. No runtime, no hydration, no bundler, no JavaScript unless you opt in.',
  technicalDecisions: [
    'Parses markdown through a Rust binary for speed.',
    'Uses a content-addressed cache for incremental rebuilds.',
    'Ships zero JavaScript by default and lets you opt in per component.',
  ],
  limitations: 'Client side interactivity is not automatic. You have to write the islands yourself.',
};

test('hackerNewsPostToPlainText round-trips title, motivation, and technical decisions', async () => {
  const { hackerNewsPostToPlainText } = await loadSerializers();
  const output = hackerNewsPostToPlainText(HACKER_NEWS_FIXTURE);
  assert.match(output, /Show HN:/);
  assert.match(output, /tired of every static site generator/);
  assert.match(output, /Rust binary/);
  assert.match(output, /client side interactivity/i);
  assertNoMarkdownArtifacts(output, 'hackerNewsPost');
});

test('hackerNewsPostToMarkdown emits title as H1 and decisions as bullet list', async () => {
  const { hackerNewsPostToMarkdown } = await loadSerializers();
  const output = hackerNewsPostToMarkdown(HACKER_NEWS_FIXTURE);
  assert.match(output, /^# Show HN:/);
  assert.match(output, /- Parses markdown/);
});

// =====================================================================
// FAQ
// =====================================================================

const FAQ_FIXTURE = {
  groups: [
    {
      category: 'Getting Started',
      entries: [
        { question: 'How do I install it?', answer: 'Run one command and you are done.' },
        { question: 'What are the requirements?', answer: 'Node 20 or higher and a Postgres database.' },
      ],
    },
    {
      category: 'Pricing',
      entries: [
        { question: 'Is there a free tier?', answer: 'Yes, up to 1000 events per month on the hobby plan.' },
      ],
    },
  ],
};

test('faqToPlainText round-trips categories and Q/A pairs', async () => {
  const { faqToPlainText } = await loadSerializers();
  const output = faqToPlainText(FAQ_FIXTURE);
  assert.match(output, /Getting Started/);
  assert.match(output, /How do I install it/);
  assert.match(output, /up to 1000 events/);
  assertNoMarkdownArtifacts(output, 'faq');
});

test('faqToMarkdown uses H2 for categories and H3 for questions', async () => {
  const { faqToMarkdown } = await loadSerializers();
  const output = faqToMarkdown(FAQ_FIXTURE);
  assert.match(output, /## Getting Started/);
  assert.match(output, /### How do I install it/);
});

// =====================================================================
// Changelog entry
// =====================================================================

const CHANGELOG_FIXTURE = {
  version: '2.1.0',
  date: '2026-04-09',
  summary: 'Performance improvements and a new query cache.',
  added: ['Query result cache with a 60 second TTL.', 'New CLI flag for verbose logging.'],
  changed: ['Upgraded pg driver to version 8.'],
  fixed: ['Race condition in connection pool shutdown.'],
  removed: [],
};

test('changelogEntryToPlainText shows only buckets with content', async () => {
  const { changelogEntryToPlainText } = await loadSerializers();
  const output = changelogEntryToPlainText(CHANGELOG_FIXTURE);
  assert.match(output, /2\.1\.0/);
  assert.match(output, /Added:/);
  assert.match(output, /Changed:/);
  assert.match(output, /Fixed:/);
  // Removed bucket is empty in the fixture, so it should not appear
  // at all — the serializer helper drops empty buckets.
  assert.equal(output.includes('Removed:'), false);
  assertNoMarkdownArtifacts(output, 'changelogEntry');
});

test('changelogEntryToMarkdown uses Keep a Changelog H2/H3 format', async () => {
  const { changelogEntryToMarkdown } = await loadSerializers();
  const output = changelogEntryToMarkdown(CHANGELOG_FIXTURE);
  assert.match(output, /## \[2\.1\.0\] - 2026-04-09/);
  assert.match(output, /### Added/);
});

// =====================================================================
// Tips list
// =====================================================================

const TIPS_FIXTURE = {
  tips: [
    'Launch on a Tuesday morning for the best HN traffic.',
    'Pre warm your inbox so replies go out in the first hour.',
    'Pin your best three testimonials on the launch page.',
    'Never respond to a troll in the first day.',
    'Email your waitlist at 9 AM local time.',
  ],
};

test('tipsToPlainText numbers every tip without leaking ordinals inside the text', async () => {
  const { tipsToPlainText } = await loadSerializers();
  const output = tipsToPlainText(TIPS_FIXTURE);
  // Expect a leading number followed by a period and space,
  // then the tip body. The whole block is exactly 5 lines.
  const lines = output.split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^1\. Launch on a Tuesday/);
  assert.match(lines[4], /^5\. Email your waitlist/);
  assertNoMarkdownArtifacts(output, 'tips');
});

// =====================================================================
// Voice commercial
// =====================================================================

const VOICE_COMMERCIAL_FIXTURE = {
  hook: 'Your background jobs are lying to you.',
  body: 'The average queue library loses one job in a thousand and never tells you. Our job runner emits a receipt for every attempt, so when something disappears you get a page instead of a ghost story. Sixty percent fewer incidents in the first month. Plug it into your existing Postgres in under a minute.',
  callToAction: 'Stop losing jobs at jobwatch dot dev.',
};

test('voiceCommercialToPlainText renders hook, body, and call to action with clean prose', async () => {
  const { voiceCommercialToPlainText } = await loadSerializers();
  const output = voiceCommercialToPlainText(VOICE_COMMERCIAL_FIXTURE);
  assert.match(output, /background jobs are lying/);
  assert.match(output, /Sixty percent fewer/);
  assert.match(output, /Stop losing jobs/);
  assertNoMarkdownArtifacts(output, 'voiceCommercial');
});

// =====================================================================
// Podcast script
// =====================================================================

const PODCAST_FIXTURE = {
  lines: [
    { speaker: 'Alex', text: 'So what got you into building for Postgres in the first place?' },
    { speaker: 'Sam', text: 'Honestly, every database I tried after Postgres felt like a downgrade.' },
    { speaker: 'Alex', text: 'What specifically?' },
    { speaker: 'Sam', text: 'The extension ecosystem. You get JSONB, full text search, and vector search all in one database.' },
  ],
};

test('podcastScriptToPlainText produces alternating Speaker: lines with no markdown', async () => {
  const { podcastScriptToPlainText } = await loadSerializers();
  const output = podcastScriptToPlainText(PODCAST_FIXTURE);
  const lines = output.split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^Alex:/);
  assert.match(lines[1], /^Sam:/);
  assertNoMarkdownArtifacts(output, 'podcastScript');
});

test('podcastScriptToMarkdown emphasizes speaker labels in bold', async () => {
  const { podcastScriptToMarkdown } = await loadSerializers();
  const output = podcastScriptToMarkdown(PODCAST_FIXTURE);
  assert.match(output, /\*\*Alex:\*\*/);
  assert.match(output, /\*\*Sam:\*\*/);
});
