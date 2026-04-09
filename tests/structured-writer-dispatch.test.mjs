// Smoke tests for the structured writer dispatch table in
// `packages/asset-generators/src/agents/written.ts`.
//
// These tests inject a fake `LLMClient` whose `generateJSON` does
// NOT call Anthropic. Instead it looks at the schema it was handed
// and returns a canonical fixture matching that schema. Then we
// assert:
//
//   1. The writer's return shape for every asset type sets the
//      correct `metadata.contentShape` discriminator, so the
//      dashboard renderer (`parseStructuredAssetContent`) can
//      route the result to the right per-type body component.
//
//   2. The writer stores the structured content at
//      `metadata.structured` verbatim, so the dashboard can pull
//      it back out via `parseJsonbColumn` with the matching
//      schema.
//
//   3. The writer stores a clean plain-text rendering in `content`
//      that contains no markdown artifacts. This is the string the
//      old `<pre>` fallback renderer would drop into the DOM, and
//      it is the surface the user saw the markdown leakage on in
//      the screenshot that motivated this refactor.
//
//   4. Unknown asset types fall through to the blog-post generator
//      so the previous behavior is preserved.
//
// The test does NOT hit Anthropic, a database, or Redis. It is a
// pure unit test of the dispatch table and the per-type result
// shape. The live end-to-end path is covered by the normal
// generation flow on a real project.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';

// Characters that should never appear in a writer's plain-text
// output. Mirrors the list in `written-asset-serializers.test.mjs`
// — kept duplicated so each file is self-contained.
const FORBIDDEN_MARKERS = [
  '**',
  '__',
  '##',
  '---',
  '—',
  '–',
  '“',
  '”',
  '‘',
  '’',
];

function assertNoMarkdownArtifacts(output, label) {
  for (const marker of FORBIDDEN_MARKERS) {
    assert.equal(
      output.includes(marker),
      false,
      `${label} writer content contains forbidden marker "${marker}": ${output.slice(0, 200)}`
    );
  }
}

// Canonical fixtures keyed by the Zod schema's `.description` on
// the root object. The fake LLM client matches incoming schemas
// to one of these fixtures by walking the schema shape. We keep
// this lookup pragmatic rather than clever — each fixture is a
// minimal valid instance of the corresponding schema.
const STRUCTURED_FIXTURES = {
  blog_post: {
    title: 'A Better Way to Ship',
    subtitle: 'One command, zero config',
    intro: 'Shipping software is hard, and most of the hard parts are self inflicted.',
    sections: [
      { heading: 'The Problem', paragraphs: ['Every pipeline starts simple and ends scary.'] },
      { heading: 'The Fix', paragraphs: ['Pick defaults worth shipping and let people override later.'] },
      { heading: 'The Result', paragraphs: ['One command deploys, one command rolls back.'] },
    ],
    closing: 'Try it on your next side project.',
    suggestedSlug: 'a-better-way-to-ship',
  },
  twitter_thread: {
    hookTweet: 'I spent three years fighting Webpack and this is what I learned.',
    tweets: [
      { number: 2, text: 'Configuration files should not be Turing complete.' },
      { number: 3, text: 'Plugin APIs are the hidden cost of flexibility.' },
      { number: 4, text: 'The happy path should be the only path for 90 percent of users.' },
      { number: 5, text: 'Opinionated tools beat configurable ones for most teams.' },
    ],
    cta: 'Star the repo and let me know what you ship.',
    hashtags: ['#webdev', '#javascript'],
  },
  linkedin_post: {
    hook: 'Three years ago I deleted 40 percent of our codebase in a single PR.',
    body: [
      'Every line I removed was dead code nobody had touched since 2021.',
      'The hardest part was convincing the team it was safe to delete.',
    ],
    closingQuestion: 'What is the biggest delete PR you ever shipped?',
  },
  product_hunt_description: {
    tagline: 'The open source API gateway',
    description: 'A self hosted API gateway with rate limiting, auth, and observability baked in. Drop it in front of any HTTP service.',
    keyFeatures: [
      { name: 'Rate limits', description: 'Token bucket rate limiting per route.' },
      { name: 'Auth', description: 'JWT and API key auth out of the box.' },
      { name: 'Traces', description: 'OpenTelemetry traces emitted for every request.' },
    ],
    techStack: 'Built with Go, Redis, and Postgres.',
    firstComment: 'Hey PH. We built this because every gateway we tried either did too little or cost too much.',
  },
  hacker_news_post: {
    title: 'Show HN: A zero dependency job queue for Postgres',
    motivation: 'I wanted a job queue that did not require Redis, Kafka, or a new service.',
    body: 'This tool uses Postgres SELECT FOR UPDATE SKIP LOCKED as the transport. No new services, no new ops surface.',
    technicalDecisions: [
      'Uses advisory locks for the dequeue step.',
      'Stores job state in a single append only table.',
      'Leans on Postgres NOTIFY for worker wakeups.',
    ],
    limitations: 'Throughput caps at around 2000 jobs per second on a modest Postgres instance.',
  },
  faq: {
    groups: [
      {
        category: 'Getting Started',
        entries: [
          { question: 'How do I install it?', answer: 'One npm command installs everything.' },
        ],
      },
      {
        category: 'Pricing',
        entries: [
          { question: 'Is there a free tier?', answer: 'Yes, up to 1000 events per month.' },
        ],
      },
    ],
  },
  changelog_entry: {
    version: '1.0.0',
    date: '2026-04-09',
    summary: 'First stable release.',
    added: ['Core queue runner.', 'CLI for job inspection.'],
    changed: [],
    fixed: [],
    removed: [],
  },
  tips: {
    tips: [
      'Launch on a Tuesday morning.',
      'Pre warm your inbox with testimonials.',
      'Pin your best three comments on day one.',
      'Never argue with trolls in the first 24 hours.',
      'Email your waitlist at 9 AM local.',
    ],
  },
  voice_commercial: {
    hook: 'Your background jobs are lying to you.',
    body: 'The average queue library loses jobs in silence. Our runner emits a receipt for every attempt, so when something disappears you get paged instead of ghosted. Sixty percent fewer incidents in the first month.',
    callToAction: 'Stop losing jobs at jobwatch dot dev.',
  },
  podcast_script: {
    lines: [
      { speaker: 'Alex', text: 'So why did you build yet another queue library?' },
      { speaker: 'Sam', text: 'Every existing option wanted to be a platform instead of a library.' },
      { speaker: 'Alex', text: 'What is the smallest thing it does?' },
      { speaker: 'Sam', text: 'It runs a single job with exactly one retry. That is it.' },
      { speaker: 'Alex', text: 'And the biggest?' },
      { speaker: 'Sam', text: 'Full durable workflows with saga semantics.' },
      { speaker: 'Alex', text: 'Nice. Where should listeners start?' },
      { speaker: 'Sam', text: 'The getting started guide on the repo takes about five minutes.' },
      { speaker: 'Alex', text: 'One more question. What would you do differently?' },
      { speaker: 'Sam', text: 'I would ship the workflow API on day one.' },
      { speaker: 'Alex', text: 'Fair. What is next?' },
      { speaker: 'Sam', text: 'A managed hosted version for teams that do not want to self host.' },
      { speaker: 'Alex', text: 'Thanks for coming on.' },
      { speaker: 'Sam', text: 'Thanks for having me.' },
      { speaker: 'Alex', text: 'Listeners, go check out the repo.' },
      { speaker: 'Sam', text: 'And open an issue if something breaks.' },
      { speaker: 'Alex', text: 'Catch you next week.' },
      { speaker: 'Sam', text: 'See you then.' },
    ],
  },
};

// Canonical repo / research / strategy context every writer
// expects. The writers only read a handful of fields so we
// supply a minimal shape rather than pulling in the real Zod
// schemas from `@launchkit/shared`.
const CANONICAL_INPUT = {
  repoAnalysis: {
    description: 'A developer tool that does one thing well.',
    language: 'TypeScript',
    techStack: ['Node 20', 'Postgres', 'Redis'],
    stars: 1234,
  },
  research: {
    targetAudience: 'backend engineers and devops leads',
    marketContext: 'crowded but fragmented',
    uniqueAngles: ['zero ops overhead', 'portable across clouds'],
    competitors: [
      { name: 'CompetitorA', differentiator: 'has a hosted tier' },
      { name: 'CompetitorB', differentiator: 'lower price point' },
    ],
  },
  strategy: {
    positioning: 'The drop in replacement that runs on the Postgres you already have.',
    tone: 'technical',
    keyMessages: [
      'Zero new services to operate.',
      'Portable across every cloud.',
      'Opinionated by default.',
    ],
  },
  pastInsights: [],
  generationInstructions: 'Produce the asset for an initial launch.',
};

/**
 * Build a fake LLMClient that answers every generateJSON call with
 * the canonical fixture matching the asset type the test is
 * exercising. The schema is validated inside the writer via zod,
 * so we pass the fixture through zod's parse to make sure we're
 * returning a shape the writer will accept.
 */
function makeFakeLlm(currentAssetType) {
  return {
    async generateContent() {
      // voiceover_script is the only asset type that still uses
      // generateContent; return a minimal valid voiceover script
      // so the parser at the end of that writer succeeds. The
      // parser regex expects each block to be exactly two lines
      // ([SCREEN: ...] then a quoted line) separated from the
      // next block by a blank line.
      return [
        '[SCREEN: terminal with cursor blinking]',
        '"Ship backend jobs without new services."',
        '',
        '[SCREEN: code editor showing import line]',
        '"One import, zero ops."',
        '',
        '[SCREEN: dashboard with green checkmarks]',
        '"Try it free."',
      ].join('\n');
    },
    async generateJSON(schema) {
      const fixture = STRUCTURED_FIXTURES[currentAssetType];
      if (fixture === undefined) {
        throw new Error(
          `fake llm has no fixture for assetType=${currentAssetType}`
        );
      }
      // Validate via the schema so a drift between the fixture
      // and the schema shape surfaces HERE, inside the test,
      // rather than as a confusing failure downstream.
      return schema.parse(fixture);
    },
  };
}

async function loadWriter() {
  return import(
    '../packages/asset-generators/dist/agents/written.js'
  );
}

// =====================================================================
// Structured asset types — each should set contentShape and store
// the structured content under metadata.structured.
// =====================================================================

const STRUCTURED_ASSET_TYPES = [
  { assetType: 'blog_post', expectedShape: 'blog_post' },
  { assetType: 'twitter_thread', expectedShape: 'twitter_thread' },
  { assetType: 'linkedin_post', expectedShape: 'linkedin_post' },
  { assetType: 'product_hunt_description', expectedShape: 'product_hunt' },
  { assetType: 'hacker_news_post', expectedShape: 'hacker_news_post' },
  { assetType: 'faq', expectedShape: 'faq' },
  { assetType: 'changelog_entry', expectedShape: 'changelog_entry' },
  { assetType: 'tips', expectedShape: 'tips' },
  { assetType: 'voice_commercial', expectedShape: 'voice_commercial' },
  { assetType: 'podcast_script', expectedShape: 'podcast_script' },
];

for (const { assetType, expectedShape } of STRUCTURED_ASSET_TYPES) {
  test(`writer dispatch: ${assetType} tags metadata.contentShape as "${expectedShape}"`, async () => {
    const { makeGenerateWrittenAsset } = await loadWriter();
    const fakeLlm = makeFakeLlm(assetType);
    const generate = makeGenerateWrittenAsset({ llm: fakeLlm });

    const result = await generate({
      ...CANONICAL_INPUT,
      assetType,
    });

    // 1. contentShape discriminator drives the dashboard dispatcher.
    assert.equal(
      result.metadata.contentShape,
      expectedShape,
      `expected metadata.contentShape === "${expectedShape}"`
    );

    // 2. Structured content survives the round trip.
    assert.deepEqual(
      result.metadata.structured,
      STRUCTURED_FIXTURES[assetType],
      'metadata.structured should equal the fixture verbatim'
    );

    // 3. Common base metadata is set.
    assert.equal(result.metadata.assetType, assetType);
    assert.equal(result.metadata.tone, CANONICAL_INPUT.strategy.tone);

    // 4. Plain-text content exists and has no markdown artifacts.
    assert.ok(
      typeof result.content === 'string' && result.content.length > 0,
      'result.content should be a non-empty string'
    );
    assertNoMarkdownArtifacts(result.content, assetType);
  });
}

// =====================================================================
// voiceover_script — legacy parser path, no contentShape tag
// =====================================================================

test('writer dispatch: voiceover_script keeps the legacy parser path', async () => {
  const { makeGenerateWrittenAsset } = await loadWriter();
  const fakeLlm = makeFakeLlm('voiceover_script');
  const generate = makeGenerateWrittenAsset({ llm: fakeLlm });

  const result = await generate({
    ...CANONICAL_INPUT,
    assetType: 'voiceover_script',
  });

  // voiceover_script does not go through the structured path, so
  // contentShape is intentionally absent. Instead, the parser's
  // `segments` and `segmentCount` fields land at the top level
  // of metadata exactly as the old writer emitted them, which is
  // what the downstream narration pipeline consumes.
  assert.equal(result.metadata.contentShape, undefined);
  assert.ok(Array.isArray(result.metadata.segments));
  assert.equal(typeof result.metadata.segmentCount, 'number');
  assert.equal(result.metadata.assetType, 'voiceover_script');
});

// =====================================================================
// Unknown asset type — fall through to blog post
// =====================================================================

test('writer dispatch: unknown assetType falls through to blog_post generator', async () => {
  const { makeGenerateWrittenAsset } = await loadWriter();
  // The fake LLM has to answer BlogPost schema calls because the
  // fallback routes to the blog_post generator regardless of the
  // incoming assetType label.
  const fakeLlm = makeFakeLlm('blog_post');
  const generate = makeGenerateWrittenAsset({ llm: fakeLlm });

  const result = await generate({
    ...CANONICAL_INPUT,
    assetType: 'definitely_not_a_real_asset_type',
  });

  // Fallback generator tags the shape as blog_post even though
  // the input assetType was unknown — the base metadata records
  // the original assetType label for debugging, and contentShape
  // reflects the actual generator that ran.
  assert.equal(result.metadata.contentShape, 'blog_post');
  assert.equal(result.metadata.assetType, 'definitely_not_a_real_asset_type');
  assertNoMarkdownArtifacts(result.content, 'fallback-blog-post');
});
