/**
 * LaunchKit seed script.
 * Populates the database with demo projects in various states to showcase the full pipeline.
 *
 * Usage: npm run seed
 */

// Load `.env` from the repo root before reading `process.env.DATABASE_URL`
// below. The script is invoked via `npm run seed` from the repo root, so
// `dotenv/config`'s default `process.cwd()` lookup finds `.env` correctly
// without needing the explicit-path treatment used by the app env modules.
// Without this, the `process.env.DATABASE_URL || <localhost-fallback>`
// line below would silently use the localhost fallback even when the
// operator has a different DATABASE_URL configured in `.env`, which is
// confusing because the seed succeeds against the wrong database.
import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from './packages/shared/src/schema.js';
import { DevInfluencerInsertSchema } from './packages/shared/src/schemas/dev-influencer.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://launchkit:launchkit@localhost:5432/launchkit',
});

const db = drizzle(pool, { schema });

// ── Helper: deterministic embedding for seed data ──
//
// `projects.embedding` is `vector(1024)` because Voyage's
// `voyage-3-large` (the real embed provider in production) outputs
// 1024-dim vectors. The seed uses this cheap deterministic function
// so local dev doesn't need a Voyage API key to have searchable
// demo projects. The dimension MUST match the DB column — any
// mismatch fails the UPDATE with `expected 1024 dimensions, not N`
// and the second seed project onward crashes.
function fakeEmbedding(text: string): number[] {
  const vec = new Array(1024).fill(0);
  for (let i = 0; i < text.length; i++) {
    const idx = (text.charCodeAt(i) * (i + 1) * 31) % 1024;
    vec[idx] += 1 / Math.sqrt(text.length);
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return mag > 0 ? vec.map((v) => v / mag) : vec;
}

async function setEmbedding(projectId: string, text: string) {
  const vector = fakeEmbedding(text);
  const vectorStr = `[${vector.join(',')}]`;
  await db.execute(sql`UPDATE projects SET embedding = ${vectorStr}::vector WHERE id = ${projectId}`);
}

// ── Seed Data ──

const SEED_PROJECTS = [
  {
    repoUrl: 'https://github.com/sindresorhus/nanoid',
    repoOwner: 'sindresorhus',
    repoName: 'nanoid',
    status: 'complete' as const,
    repoAnalysis: {
      readme: '# nanoid\n\nA tiny, secure, URL-friendly, unique string ID generator for JavaScript.',
      description: 'A tiny, secure, URL-friendly, unique string ID generator for JavaScript',
      language: 'JavaScript',
      techStack: ['JavaScript', 'TypeScript'],
      framework: null,
      stars: 24800,
      forks: 760,
      topics: ['uuid', 'guid', 'id', 'unique-id', 'javascript'],
      license: 'MIT',
      hasTests: true,
      hasCi: true,
      recentCommits: [
        { sha: 'a1b2c3d', message: 'Update dependencies', date: '2026-04-01T10:00:00Z', author: 'sindresorhus' },
      ],
      fileTree: ['index.js', 'index.d.ts', 'package.json', 'README.md', 'test.js'],
      packageDeps: {},
      category: 'library',
    },
    research: {
      competitors: [
        { name: 'uuid', url: 'https://github.com/uuidjs/uuid', description: 'RFC4122-compliant UUID generation', stars: 14200, differentiator: 'Industry standard but larger bundle size' },
        { name: 'shortid', url: 'https://github.com/dylang/shortid', description: 'Short non-sequential URL-friendly IDs', stars: 6500, differentiator: 'Deprecated, no longer maintained' },
        { name: 'cuid', url: 'https://github.com/ericelliott/cuid', description: 'Collision-resistant IDs', stars: 6900, differentiator: 'Optimized for horizontal scaling but larger output' },
      ],
      targetAudience: 'JavaScript and TypeScript developers building web applications who need lightweight, URL-safe unique IDs without the bundle size of UUID libraries.',
      marketContext: 'The ID generation space is dominated by uuid for traditional use cases. Modern bundle-conscious frameworks (Vite, Next.js, Astro) have created demand for tiny, tree-shakable utilities like nanoid.',
      uniqueAngles: [
        'Smallest bundle size (130 bytes) of any ID generator',
        '60% faster than UUID',
        'Cryptographically strong randomness',
        'Custom alphabet support for human-friendly IDs',
      ],
      recommendedChannels: ['hacker_news', 'twitter', 'dev_to'],
      hnMentions: [
        { title: 'Show HN: Nanoid - a tiny ID generator', url: 'https://news.ycombinator.com/item?id=12345', points: 412, commentCount: 87 },
      ],
    },
    strategy: {
      positioning: 'The smallest, fastest, and most secure URL-safe unique ID generator for modern JavaScript.',
      tone: 'technical',
      keyMessages: [
        '130 bytes — smaller than UUID, with stronger randomness',
        '60% faster than UUID with no dependencies',
        'Tree-shakable and ESM-first for modern bundlers',
      ],
      selectedChannels: [
        { channel: 'hacker_news', priority: 1, reasoning: 'Technical audience appreciates bundle size optimizations and benchmarks' },
        { channel: 'twitter', priority: 2, reasoning: 'Frontend developer community is highly active' },
        { channel: 'dev_to', priority: 3, reasoning: 'Long-form technical content fits the audience' },
      ],
      assetsToGenerate: [
        { type: 'blog_post', generationInstructions: 'Technical deep-dive on the trade-offs of bundle size vs UUID', priority: 1 },
        { type: 'twitter_thread', generationInstructions: 'Benchmark thread comparing nanoid to uuid', priority: 2 },
        { type: 'hacker_news_post', generationInstructions: 'Show HN style post focused on technical details', priority: 3 },
        { type: 'og_image', generationInstructions: 'Minimalist OG image emphasizing the 130 bytes claim', priority: 2 },
      ],
      skipAssets: [
        { type: 'product_video', reasoning: 'A library doesn\'t need a video — code examples are more valuable.' },
        { type: 'linkedin_post', reasoning: 'LinkedIn audience is less interested in low-level library trade-offs.' },
        { type: 'product_hunt_description', reasoning: 'Product Hunt is for products, not libraries.' },
      ],
    },
    reviewScore: 8.4,
    reviewFeedback: { overallScore: 8.4, overallFeedback: 'Strong technical kit with consistent positioning around bundle size and performance.', assetReviews: [], approved: true, revisionPriority: [] },
    revisionCount: 0,
  },
  {
    repoUrl: 'https://github.com/calcom/cal.com',
    repoOwner: 'calcom',
    repoName: 'cal.com',
    status: 'complete' as const,
    repoAnalysis: {
      readme: '# Cal.com\n\nThe open-source Calendly alternative.',
      description: 'Scheduling infrastructure for absolutely everyone.',
      language: 'TypeScript',
      techStack: ['TypeScript', 'Next.js', 'Prisma', 'tRPC', 'Tailwind CSS'],
      framework: 'Next.js',
      stars: 32400,
      forks: 8200,
      topics: ['calendar', 'scheduling', 'open-source', 'nextjs', 'typescript'],
      license: 'AGPL-3.0',
      hasTests: true,
      hasCi: true,
      recentCommits: [
        { sha: 'f9e8d7c', message: 'feat: add round-robin scheduling', date: '2026-04-05T14:00:00Z', author: 'peer' },
      ],
      fileTree: ['apps/web/', 'packages/ui/', 'packages/lib/', 'package.json'],
      packageDeps: { next: '^15.0.0', '@prisma/client': '^5.0.0', '@trpc/server': '^11.0.0' },
      category: 'web_app',
    },
    research: {
      competitors: [
        { name: 'Calendly', url: 'https://calendly.com', description: 'The market leader in scheduling', stars: 0, differentiator: 'Closed source, expensive enterprise pricing' },
        { name: 'Savvycal', url: 'https://savvycal.com', description: 'Premium scheduling alternative', stars: 0, differentiator: 'Better UX but proprietary' },
      ],
      targetAudience: 'Privacy-conscious teams, developers, and businesses who want scheduling that they can self-host, customize, and integrate deeply with their existing tools.',
      marketContext: 'Scheduling is a $500M+ market dominated by Calendly. Open-source alternatives are gaining traction as data privacy concerns rise and teams want more control over customer data.',
      uniqueAngles: [
        'Self-hostable, AGPL-licensed open-source',
        'Built on modern stack (Next.js, tRPC, Prisma)',
        'Extensible via apps marketplace',
        'White-labelable for agencies',
      ],
      recommendedChannels: ['product_hunt', 'twitter', 'hacker_news', 'linkedin'],
      hnMentions: [],
    },
    strategy: {
      positioning: 'The open-source scheduling infrastructure that respects your customers and your data.',
      tone: 'enthusiastic',
      keyMessages: [
        'Self-host or use our cloud — your choice',
        'Built by a passionate community of 600+ contributors',
        'Integrates with everything you already use',
      ],
      selectedChannels: [
        { channel: 'product_hunt', priority: 1, reasoning: 'Product Hunt audience values open-source SaaS alternatives' },
        { channel: 'twitter', priority: 2, reasoning: 'Build-in-public community drives organic growth' },
        { channel: 'hacker_news', priority: 3, reasoning: 'Open-source angle resonates strongly' },
        { channel: 'linkedin', priority: 4, reasoning: 'Reaches business decision-makers comparing to Calendly' },
      ],
      assetsToGenerate: [
        { type: 'blog_post', generationInstructions: 'Why we built an open-source Calendly alternative', priority: 1 },
        { type: 'twitter_thread', generationInstructions: 'Product launch thread with screenshots', priority: 2 },
        { type: 'product_hunt_description', generationInstructions: 'Compelling PH listing with feature highlights', priority: 1 },
        { type: 'linkedin_post', generationInstructions: 'Business-focused angle on data ownership', priority: 3 },
        { type: 'faq', generationInstructions: 'Address self-hosting, pricing, and migration questions', priority: 2 },
        { type: 'og_image', generationInstructions: 'Premium OG image showing the calendar interface aesthetic', priority: 2 },
        { type: 'product_video', generationInstructions: '10-second hero video showing scheduling flow', priority: 1 },
      ],
      skipAssets: [],
    },
    reviewScore: 9.1,
    reviewFeedback: { overallScore: 9.1, overallFeedback: 'Cohesive, polished kit. Video is a standout. All assets reinforce the open-source positioning.', assetReviews: [], approved: true, revisionPriority: [] },
    revisionCount: 0,
  },
  {
    repoUrl: 'https://github.com/oven-sh/bun',
    repoOwner: 'oven-sh',
    repoName: 'bun',
    status: 'generating' as const,
    repoAnalysis: {
      readme: '# Bun\n\nIncredibly fast JavaScript runtime, bundler, transpiler, and package manager — all in one.',
      description: 'Incredibly fast JavaScript runtime, bundler, transpiler, and package manager — all in one.',
      language: 'Zig',
      techStack: ['Zig', 'JavaScript', 'TypeScript', 'C++'],
      framework: null,
      stars: 75200,
      forks: 2700,
      topics: ['javascript', 'runtime', 'bundler', 'transpiler', 'zig'],
      license: 'MIT',
      hasTests: true,
      hasCi: true,
      recentCommits: [
        { sha: 'b4n5h0t', message: 'feat: SQLite improvements', date: '2026-04-06T08:00:00Z', author: 'jarred' },
      ],
      fileTree: ['src/', 'test/', 'docs/', 'build.zig', 'package.json'],
      packageDeps: {},
      category: 'devtool',
    },
    research: {
      competitors: [
        { name: 'Node.js', url: 'https://nodejs.org', description: 'The dominant JavaScript runtime', stars: 105000, differentiator: 'Mature but slower, larger memory footprint' },
        { name: 'Deno', url: 'https://github.com/denoland/deno', description: 'Secure runtime by Node.js creator', stars: 95000, differentiator: 'Security-first but smaller ecosystem' },
      ],
      targetAudience: 'Performance-obsessed JavaScript developers, teams running Node.js in production who care about cold starts and benchmarks, early adopters of new runtimes.',
      marketContext: 'JavaScript runtime competition is heating up. Bun has captured significant mindshare with performance benchmarks and an all-in-one developer experience.',
      uniqueAngles: [
        'Drop-in Node.js replacement with 3-4x performance',
        'Built-in bundler, test runner, and package manager',
        'Native TypeScript support',
        'Written in Zig for low-level control',
      ],
      recommendedChannels: ['hacker_news', 'twitter', 'dev_to'],
      hnMentions: [
        { title: 'Bun 1.2 released', url: 'https://news.ycombinator.com/item?id=99999', points: 1240, commentCount: 532 },
      ],
    },
    strategy: {
      positioning: 'The all-in-one JavaScript toolchain that makes Node.js feel slow.',
      tone: 'technical',
      keyMessages: [
        '3-4x faster than Node.js in real-world benchmarks',
        'Replace npm, node, jest, and webpack with one binary',
        'Native TypeScript and JSX support out of the box',
      ],
      selectedChannels: [
        { channel: 'hacker_news', priority: 1, reasoning: 'Technical audience appreciates runtime benchmarks' },
        { channel: 'twitter', priority: 2, reasoning: 'Build-in-public community is enthusiastic' },
      ],
      assetsToGenerate: [
        { type: 'blog_post', generationInstructions: 'Technical deep-dive on Bun vs Node.js performance', priority: 1 },
        { type: 'twitter_thread', generationInstructions: 'Benchmark thread with charts', priority: 2 },
        { type: 'hacker_news_post', generationInstructions: 'Show HN: Bun 1.2 - announcement post', priority: 1 },
        { type: 'og_image', generationInstructions: 'Bold OG image with performance numbers', priority: 2 },
        { type: 'product_video', generationInstructions: 'Animated visualization of Bun vs Node.js speed', priority: 3 },
      ],
      skipAssets: [
        { type: 'linkedin_post', reasoning: 'Hardcore technical audience prefers HN/Twitter' },
        { type: 'product_hunt_description', reasoning: 'Runtime tools are not a Product Hunt fit' },
      ],
    },
    reviewScore: null,
    reviewFeedback: null,
    revisionCount: 0,
  },
  {
    repoUrl: 'https://github.com/launchkit/launchkit',
    repoOwner: 'launchkit',
    repoName: 'launchkit',
    status: 'complete' as const,
    repoAnalysis: {
      readme: '# LaunchKit\n\nAI-powered go-to-market teammate. Paste a GitHub repo, get a full launch kit.',
      description: 'AI-powered go-to-market teammate that generates blog posts, social content, OG images, and videos for your repo',
      language: 'TypeScript',
      techStack: ['TypeScript', 'Hono', 'BullMQ', 'Drizzle ORM', 'pgvector', 'React', 'Anthropic Claude', 'fal.ai'],
      framework: 'Hono',
      stars: 142,
      forks: 12,
      topics: ['ai', 'marketing', 'developer-tools', 'anthropic', 'render'],
      license: 'MIT',
      hasTests: true,
      hasCi: true,
      recentCommits: [
        { sha: 'meta001', message: 'feat: self-learning insights', date: '2026-04-06T20:00:00Z', author: 'launchkit' },
      ],
      fileTree: ['apps/web/', 'apps/worker/', 'apps/cron/', 'apps/dashboard/', 'packages/shared/', 'render.yaml'],
      packageDeps: { hono: '^4.6.0', bullmq: '^5.25.0', '@anthropic-ai/sdk': '^0.39.0' },
      category: 'devtool',
    },
    research: {
      competitors: [
        { name: 'Manual marketing', url: '', description: 'The status quo for indie developers', stars: 0, differentiator: 'Time-consuming, requires expertise developers don\'t have' },
        { name: 'ChatGPT prompts', url: '', description: 'DIY marketing content generation', stars: 0, differentiator: 'No context, no strategy, no learning' },
      ],
      targetAudience: 'Indie developers and small teams shipping open-source projects who don\'t have time or expertise to write marketing content.',
      marketContext: 'AI-powered marketing tools exist for SaaS but none specifically understand developer products and GitHub repos.',
      uniqueAngles: [
        'Reads your actual code, not just descriptions',
        'Agentic research — finds real competitors',
        'Self-improving via pgvector similarity search',
        'Multi-agent creative review process',
      ],
      recommendedChannels: ['hacker_news', 'twitter', 'product_hunt'],
      hnMentions: [],
    },
    strategy: {
      positioning: 'The AI marketing teammate that actually reads your code.',
      tone: 'enthusiastic',
      keyMessages: [
        'Paste a repo URL, get a full launch kit in minutes',
        'Multi-agent system: research → strategy → create → review',
        'Learns from every project to get smarter over time',
      ],
      selectedChannels: [
        { channel: 'hacker_news', priority: 1, reasoning: 'Show HN — developers love seeing how it works' },
        { channel: 'twitter', priority: 2, reasoning: 'Visual demo videos perform well' },
        { channel: 'product_hunt', priority: 3, reasoning: 'AI tools are popular on PH' },
      ],
      assetsToGenerate: [
        { type: 'blog_post', generationInstructions: 'How LaunchKit works under the hood', priority: 1 },
        { type: 'twitter_thread', generationInstructions: 'Demo thread with screenshots', priority: 2 },
        { type: 'hacker_news_post', generationInstructions: 'Show HN with technical details', priority: 1 },
        { type: 'product_hunt_description', generationInstructions: 'PH launch listing', priority: 3 },
        { type: 'og_image', generationInstructions: 'OG image with the LaunchKit lightning bolt', priority: 2 },
        { type: 'product_video', generationInstructions: '10s demo showing the full flow', priority: 1 },
        { type: 'faq', generationInstructions: 'Common questions about how it works', priority: 2 },
        // ── Phase 4 asset types ──
        { type: 'tips', generationInstructions: 'Five actionable launch tips a developer can run today', priority: 2 },
        { type: 'voice_commercial', generationInstructions: '30-second ad-style voice script for a developer audience', priority: 3 },
        { type: 'podcast_script', generationInstructions: 'Two-host dev podcast dialogue introducing the project', priority: 3 },
      ],
      skipAssets: [],
    },
    reviewScore: 9.3,
    reviewFeedback: { overallScore: 9.3, overallFeedback: 'The meta launch — excellent self-aware copy.', assetReviews: [], approved: true, revisionPriority: [] },
    revisionCount: 0,
  },
];

// ── Asset templates ──

function makeBlogPost(positioning: string, name: string): { content: string; metadata: any } {
  return {
    content: `# Introducing ${name}\n## ${positioning}\n\nWe built ${name} because the existing solutions felt frustrating. Here's what makes it different.\n\n## The Problem\n\nDevelopers waste hours on marketing tasks that could be automated.\n\n## Our Solution\n\n[Continue with technical depth, code examples, and a clear getting-started guide]\n\n## Get Started\n\n\`\`\`bash\nnpm install ${name}\n\`\`\``,
    metadata: { title: `Introducing ${name}`, subtitle: positioning, wordCount: 850 },
  };
}

function makeTwitterThread(name: string): { content: string; metadata: any } {
  return {
    content: `1/ Introducing ${name} 🚀\n\nThe tool I wish I had when shipping my last project.\n\n2/ Here's what it does in 30 seconds:\n\n[demo gif]\n\n3/ Built with TypeScript, BullMQ, and Claude. Open source.\n\n4/ Try it: launchkit.dev`,
    metadata: { tweetCount: 4 },
  };
}

// ── Run seed ──

async function loadAndInsertDevInfluencers(): Promise<number> {
  // Phase 5: load the curated dev influencer JSON, validate every
  // entry through `DevInfluencerInsertSchema` at the boundary, and
  // insert via Drizzle. `topic_embedding` is intentionally left null —
  // the worker enrichment cron computes it on its first weekly pass.
  //
  // The seed JSON's top-level `_comment` key (and any other key
  // prefixed with underscore) is documentation for human reviewers
  // and is ignored by the loader.
  const seedPath = path.resolve(process.cwd(), 'seed/dev-influencers.json');
  const raw = await readFile(seedPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('influencers' in parsed) ||
    !Array.isArray((parsed as { influencers: unknown }).influencers)
  ) {
    throw new Error(
      'seed/dev-influencers.json must be { "influencers": [...] }'
    );
  }
  const rows = (parsed as { influencers: unknown[] }).influencers;

  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const validated = DevInfluencerInsertSchema.safeParse(row);
    if (!validated.success) {
      console.warn(
        `  Skipping invalid influencer entry: ${validated.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`
      );
      skipped++;
      continue;
    }
    try {
      await db.insert(schema.devInfluencers).values({
        handle: validated.data.handle,
        platforms: validated.data.platforms,
        categories: validated.data.categories,
        bio: validated.data.bio ?? null,
        recentTopics: validated.data.recentTopics ?? null,
        audienceSize: validated.data.audienceSize,
      });
      inserted++;
    } catch (err) {
      // Duplicate handle is the most likely cause — log and continue.
      console.warn(
        `  Failed to insert influencer "${validated.data.handle}":`,
        err instanceof Error ? err.message : String(err)
      );
      skipped++;
    }
  }
  console.log(
    `  Inserted ${String(inserted)} dev influencers (${String(skipped)} skipped)`
  );
  return inserted;
}

async function seed() {
  console.log('🌱 Seeding LaunchKit database...\n');

  // Clear existing data
  console.log('  Clearing existing data...');
  await db.delete(schema.assets);
  await db.delete(schema.jobs);
  await db.delete(schema.webhookEvents);
  await db.delete(schema.strategyInsights);
  await db.delete(schema.devInfluencers);
  await db.delete(schema.projects);

  // Insert dev influencers (Phase 5). Loaded from the curated JSON
  // file at `seed/dev-influencers.json`. The enrichment cron will
  // refresh bios + audience metrics + topic embeddings on its first
  // run after deploy.
  console.log('  Loading curated dev influencers from seed/dev-influencers.json...');
  await loadAndInsertDevInfluencers();

  // Insert projects
  console.log(`  Inserting ${SEED_PROJECTS.length} projects...`);
  for (const seedProject of SEED_PROJECTS) {
    const [project] = await db
      .insert(schema.projects)
      .values({
        repoUrl: seedProject.repoUrl,
        repoOwner: seedProject.repoOwner,
        repoName: seedProject.repoName,
        status: seedProject.status,
        repoAnalysis: seedProject.repoAnalysis as any,
        research: seedProject.research as any,
        strategy: seedProject.strategy as any,
        reviewScore: seedProject.reviewScore,
        reviewFeedback: seedProject.reviewFeedback as any,
        revisionCount: seedProject.revisionCount,
      })
      .returning();

    // Set embedding
    await setEmbedding(
      project.id,
      `${seedProject.repoName} ${seedProject.repoAnalysis.description} ${seedProject.repoAnalysis.category}`
    );

    // Create assets for each strategy item
    for (const assetSpec of seedProject.strategy.assetsToGenerate) {
      let content: string | null = null;
      let mediaUrl: string | null = null;
      let metadata: any = { generationInstructions: assetSpec.generationInstructions, priority: assetSpec.priority };
      let status: any = seedProject.status === 'complete' ? 'complete' : 'queued';

      // For the "generating" project (bun), make some assets in-progress
      if (seedProject.status === 'generating') {
        if (assetSpec.type === 'blog_post' || assetSpec.type === 'twitter_thread' || assetSpec.type === 'hacker_news_post') {
          status = 'complete';
        } else if (assetSpec.type === 'og_image') {
          status = 'generating';
        } else {
          status = 'queued';
        }
      }

      if (status === 'complete') {
        if (assetSpec.type === 'blog_post') {
          const post = makeBlogPost(seedProject.strategy.positioning, seedProject.repoName);
          content = post.content;
          metadata = { ...metadata, ...post.metadata };
        } else if (assetSpec.type === 'twitter_thread') {
          const thread = makeTwitterThread(seedProject.repoName);
          content = thread.content;
          metadata = { ...metadata, ...thread.metadata };
        } else if (assetSpec.type === 'hacker_news_post') {
          content = `**Title:** Show HN: ${seedProject.repoName} – ${seedProject.strategy.positioning}\n\n**Post:**\n\nHi HN! I built ${seedProject.repoName} to solve a problem I kept running into. Happy to answer questions about the implementation.`;
        } else if (assetSpec.type === 'faq') {
          content = `## How does it work?\n\nIt analyzes your repo and generates marketing content.\n\n## How is this different from ChatGPT?\n\nIt has agentic research and self-learning.\n\n## Is it open source?\n\nYes, MIT licensed.`;
        } else if (assetSpec.type === 'linkedin_post') {
          content = `Most developers I know struggle with marketing.\n\nThat's why I built ${seedProject.repoName}.\n\n${seedProject.strategy.positioning}\n\nWhat's your biggest marketing challenge as a developer?`;
        } else if (assetSpec.type === 'product_hunt_description') {
          content = `**Tagline:** ${seedProject.strategy.positioning}\n\n**Description:**\n${seedProject.repoAnalysis.description}\n\n**Key Features:**\n- Feature 1\n- Feature 2\n- Feature 3`;
        } else if (assetSpec.type === 'og_image' || assetSpec.type === 'social_card') {
          mediaUrl = `https://placehold.co/1200x630/0f172a/10b981?text=${encodeURIComponent(seedProject.repoName)}`;
          metadata = { ...metadata, prompt: 'Minimalist dark gradient', style: 'dark gradient', dimensions: '1200x630' };
        } else if (assetSpec.type === 'product_video') {
          mediaUrl = '';
          metadata = { ...metadata, thumbnailUrl: `https://placehold.co/1280x720/0f172a/10b981?text=${encodeURIComponent('Video')}`, duration: 8 };
        } else if (assetSpec.type === 'tips') {
          // Phase 4: actionable launch tips. Pure-text asset, no audio
          // or video render — the writer agent emits a numbered list.
          content = `1. Push your most marketable commit on Tuesday morning UTC; that's when the dev Twitter feed is sharpest.\n2. Open the Show HN thread before you tweet — early HN momentum drags Twitter, not the other way around.\n3. Write the README hero line as a single sentence a tired engineer can scan in 4 seconds.\n4. Reply to the first three comments on every post yourself, even on LinkedIn — it doubles second-day reach.\n5. Pin the launch tweet for 72 hours, then replace it with the most-quoted reply screenshot.`;
          metadata = { ...metadata, tipCount: 5 };
        } else if (assetSpec.type === 'voice_commercial') {
          // Phase 4: 30-second voice commercial. The seed ships the
          // script and metadata only — the worker performs the real
          // ElevenLabs render at generation time and writes the MP3
          // to `.cache/elevenlabs-rendered/${audioCacheKey}.mp3`.
          //
          // The cache key uses an all-zero 16-char hex stub on
          // purpose: the audio streaming route validates against
          // `^[a-f0-9]{16}$` and a non-hex string would fail the
          // schema with a 422 ("metadata shape wrong") instead of
          // the 404 we actually want ("file missing"). Hex stub →
          // route 404 → dashboard error card with the right copy.
          //
          // `mediaUrl` is intentionally null in the seed; the
          // dashboard derives the streaming URL from `asset.id`
          // post-insert via `useProjectData`, so embedding a literal
          // here would only ever be wrong for one row.
          content = `Stop wrestling with launch checklists. ${seedProject.repoName} reads your repo, drafts the marketing kit, renders the video, and lines up the dev voices who'd actually amplify it. One push, one launch, one teammate that ships while you sleep. ${seedProject.repoName} dot dev — go build something worth shipping.`;
          metadata = {
            ...metadata,
            audioCacheKey: '0000000000000000',
            audioDurationSeconds: 30,
            wordCount: 60,
            estimatedDurationSeconds: 24,
          };
        } else if (assetSpec.type === 'podcast_script') {
          // Phase 4: multi-speaker podcast script. Same seeding model
          // as `voice_commercial` above — content + metadata stub
          // with a hex-format placeholder cache key so the streaming
          // route 404s on the missing file rather than 422-ing on
          // the schema mismatch. No bundled audio file.
          content = `Alex: Welcome back to the launch loop. Today we're digging into ${seedProject.repoName}.\nSam: I've been waiting for this one. The pitch is 'AI go-to-market for developers shipping on Render', right?\nAlex: That's the headline. The reality is more interesting — it reads your repo, picks the marketing angle, and fans out fourteen artifacts in parallel.\nSam: Fourteen? What's actually in the kit?\nAlex: Blog post, twitter thread, LinkedIn post, Show HN draft, FAQ, OG image, social card, product video with voiceover, voice commercial, this podcast, launch tips, and personalized outreach drafts to dev influencers.\nSam: That's the whole launch checklist in one push.\nAlex: And every user edit feeds a self-learning loop that refines the next push. The cron clusters edits and writes the patterns back to strategy insights.\nSam: So the next launch is sharper than the last one.\nAlex: Without anyone tuning a prompt by hand. That's the whole point.\nSam: Where do people start?\nAlex: Paste a GitHub URL on the dashboard, install the webhook, push a commit. The first launch kit lands in about ninety seconds.`;
          metadata = {
            ...metadata,
            audioCacheKey: '0000000000000001',
            audioDurationSeconds: 165,
            lineCount: 11,
            speakerTurns: 11,
            estimatedDurationSeconds: 175,
            dialogueLineCount: 11,
          };
        }
      }

      // Random user feedback for some completed assets
      const userApproved =
        status === 'complete' && Math.random() > 0.3
          ? Math.random() > 0.2
          : null;

      await db.insert(schema.assets).values({
        projectId: project.id,
        type: assetSpec.type as any,
        status,
        content,
        mediaUrl,
        metadata,
        qualityScore: status === 'complete' ? 6.5 + Math.random() * 3 : null,
        reviewNotes: status === 'complete' ? 'Strong execution. Tone is consistent with strategy.' : null,
        userApproved,
        userEdited: false,
      });
    }

    console.log(`    ✓ ${seedProject.repoOwner}/${seedProject.repoName} (${seedProject.status})`);
  }

  // Insert strategy insights (the learning system has data)
  console.log('  Inserting strategy insights...');
  await db.insert(schema.strategyInsights).values([
    {
      category: 'library',
      insight: 'For library projects, technical tone in blog posts scores 35% higher than casual tone. Users consistently approve benchmark-driven content.',
      confidence: 0.85,
      sampleSize: 12,
    },
    {
      category: 'devtool',
      insight: 'Developer tool launches perform best on Hacker News when including code examples and benchmarks. Skip Instagram/LinkedIn for this category.',
      confidence: 0.92,
      sampleSize: 18,
    },
    {
      category: 'web_app',
      insight: 'Full-stack web apps benefit from Product Hunt launches with video demos. Average score is 8.7/10 vs 6.2/10 without video.',
      confidence: 0.78,
      sampleSize: 9,
    },
  ]);

  // Insert sample webhook events
  console.log('  Inserting webhook events...');
  const [completeProject] = await db.select().from(schema.projects).limit(1);
  if (completeProject) {
    await db.insert(schema.webhookEvents).values([
      {
        projectId: completeProject.id,
        eventType: 'push',
        payload: { commit: { message: 'feat: add real-time collaboration' } },
        commitSha: 'abc1234',
        commitMessage: 'feat: add real-time collaboration',
        isMarketable: true,
        filterReasoning: 'Major new feature worth marketing',
        triggeredGeneration: true,
      },
      {
        projectId: completeProject.id,
        eventType: 'push',
        payload: { commit: { message: 'fix: typo in README' } },
        commitSha: 'def5678',
        commitMessage: 'fix: typo in README',
        isMarketable: false,
        filterReasoning: 'Typo fix — not worth generating marketing content',
        triggeredGeneration: false,
      },
    ]);
  }

  console.log('\n✨ Seed complete!\n');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
