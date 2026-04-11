import {
  parseJsonbColumn,
  RepoAnalysisSchema,
  ResearchResultSchema,
  StrategyBriefSchema,
  type AssetType,
} from '@launchkit/shared';

/**
 * Build the per-project system prompt handed to the Pika
 * meeting-bot at invite time.
 *
 * Why per-project instead of a static persona
 * -------------------------------------------
 *
 * The whole point of LaunchKit's AI teammate joining a meet is that
 * the operator can drop a Google Meet URL and the avatar walks into
 * the room already knowing what the project is, who it's for, how
 * the launch is positioned, and which assets already exist. A
 * generic "I am a helpful AI assistant" persona would be a worse
 * experience than not showing up at all.
 *
 * Input surface
 * -------------
 *
 * The builder takes the raw project row from
 * `db.query.projects.findFirst(...)` plus a list of completed
 * assets. It parses the jsonb columns through their Zod schemas so
 * a partially-written project (analyze done, strategize not yet
 * run) still produces a sensible prompt — every parse is guarded
 * and a failing parse degrades gracefully to "section omitted"
 * rather than crashing the invite.
 *
 * Output shape
 * ------------
 *
 * The format is adapted from the SKILL.md at
 * `vendor/pikastream-video-meeting/SKILL.md` — third-person, bullet
 * lists, concrete facts over vague vibes. The builder enforces a
 * 4 KB cap (`MAX_PROMPT_BYTES`) by truncating the lowest-priority
 * sections first (assets → activity → strategy → repo core).
 * Anything short enough to fit is passed verbatim.
 *
 * Invariants
 * ----------
 *
 *   1. The builder is pure — no DB calls, no network. The caller
 *      is responsible for loading the project + assets rows. This
 *      keeps the invite processor's flow obvious and the builder
 *      unit-testable without a fixture DB.
 *
 *   2. The output is always a string (never null). A project with
 *      nothing more than a repo URL still gets a minimal prompt.
 *
 *   3. The `avatarRef` / `botName` fields are NOT included in the
 *      prompt. The subprocess passes them as CLI flags instead,
 *      and the prompt text is purely about what the bot should
 *      know, not what it is.
 */

const MAX_PROMPT_BYTES = 4 * 1024;

export interface PikaSystemPromptProject {
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  repoAnalysis: unknown;
  research: unknown;
  strategy: unknown;
}

export interface PikaSystemPromptAsset {
  type: AssetType;
  metadata: unknown;
  content: string | null;
}

export interface BuildPikaSystemPromptInput {
  project: PikaSystemPromptProject;
  assets: readonly PikaSystemPromptAsset[];
  botName: string;
}

export function buildPikaSystemPrompt(
  input: BuildPikaSystemPromptInput
): string {
  const { project, assets, botName } = input;
  const projectHandle = `${project.repoOwner}/${project.repoName}`;

  // ── Repo core ─────────────────────────────────────────────────
  //
  // Parse through the Zod schema — if the column shape has drifted
  // we prefer to omit the section rather than crash the invite.
  // Downstream agents validate strictly; this surface is
  // user-facing prose and a graceful degrade is the right call.
  let description: string | null = null;
  let language: string | null = null;
  let techStack: string[] = [];
  let recentCommits: { message: string; author: string }[] = [];
  try {
    const parsed = parseJsonbColumn(
      RepoAnalysisSchema,
      project.repoAnalysis,
      'project.repo_analysis'
    );
    description = parsed.description || parsed.readme.slice(0, 280);
    language = parsed.language;
    techStack = parsed.techStack.slice(0, 6);
    recentCommits = parsed.recentCommits.slice(0, 5).map((c) => ({
      message: c.message.split('\n')[0]?.slice(0, 120) ?? '',
      author: c.author,
    }));
  } catch {
    // Keep the defaults and let the strategy / assets sections
    // carry the load.
  }

  // ── Strategy ──────────────────────────────────────────────────
  let positioning: string | null = null;
  let tone: string | null = null;
  let keyMessages: string[] = [];
  try {
    const parsed = parseJsonbColumn(
      StrategyBriefSchema,
      project.strategy,
      'project.strategy'
    );
    positioning = parsed.positioning;
    tone = parsed.tone;
    keyMessages = parsed.keyMessages.slice(0, 4);
  } catch {
    // Project hasn't reached the strategize phase yet — section
    // stays empty.
  }

  // ── Research ──────────────────────────────────────────────────
  let competitors: string[] = [];
  let targetAudience: string | null = null;
  try {
    const parsed = parseJsonbColumn(
      ResearchResultSchema,
      project.research,
      'project.research'
    );
    competitors = parsed.competitors
      .slice(0, 3)
      .map((c) => `${c.name} — ${c.description.slice(0, 80)}`);
    // `targetAudience` is the actual field name on ResearchResultSchema;
    // an earlier revision of this builder read a non-existent
    // `targetPersona` field via an `as`-cast, which silently returned
    // `null` for every project because the field did not exist. Read
    // through the schema-parsed value directly so the type system
    // catches a future rename at compile time.
    targetAudience = parsed.targetAudience;
  } catch {
    // Research not done — competitors stay empty.
  }

  // ── Assets ────────────────────────────────────────────────────
  const assetSummaries = assets
    .slice(0, 6)
    .map((asset) => formatAssetSummary(asset))
    .filter((summary): summary is string => summary !== null);

  // ── Compose ───────────────────────────────────────────────────
  //
  // Build from highest-priority section to lowest so the 4 KB
  // trim-from-the-end behaviour drops assets first, then
  // competitors, then commits, then tech stack — never the core
  // "what is this project" section, which is the minimum useful
  // shape.
  const sections: string[] = [];

  sections.push(
    `You are "${botName}", an AI teammate who worked on ${projectHandle}. ` +
      `You are joining this video meeting to talk about the project, its ` +
      `launch, and anything the other participants ask. Stay conversational ` +
      `and concrete — use real details from what you know, do not invent ` +
      `facts, and keep answers short.`
  );

  const coreFacts: string[] = [];
  if (description) coreFacts.push(`Description: ${description}`);
  if (language) coreFacts.push(`Primary language: ${language}`);
  if (techStack.length > 0) {
    coreFacts.push(`Tech stack: ${techStack.join(', ')}`);
  }
  coreFacts.push(`Repo URL: ${project.repoUrl}`);
  sections.push(
    [`**About ${projectHandle}**`, ...coreFacts.map((f) => `- ${f}`)].join('\n')
  );

  if (positioning) {
    const strategyLines: string[] = ['**Launch strategy**'];
    strategyLines.push(`- Positioning: ${positioning}`);
    if (tone) strategyLines.push(`- Tone: ${tone}`);
    for (const message of keyMessages) {
      strategyLines.push(`- Key message: ${message}`);
    }
    sections.push(strategyLines.join('\n'));
  }

  if (targetAudience !== null || competitors.length > 0) {
    const researchLines: string[] = ['**Market context**'];
    if (targetAudience !== null && targetAudience.length > 0) {
      researchLines.push(`- Target: ${targetAudience}`);
    }
    for (const competitor of competitors) {
      researchLines.push(`- Competitor: ${competitor}`);
    }
    sections.push(researchLines.join('\n'));
  }

  if (recentCommits.length > 0) {
    const commitLines: string[] = ['**Recent activity**'];
    for (const commit of recentCommits) {
      commitLines.push(`- ${commit.author}: ${commit.message}`);
    }
    sections.push(commitLines.join('\n'));
  }

  if (assetSummaries.length > 0) {
    const assetLines: string[] = ['**Launch assets already generated**'];
    for (const summary of assetSummaries) {
      assetLines.push(`- ${summary}`);
    }
    sections.push(assetLines.join('\n'));
  }

  // Join, then trim sections off the end until the whole thing
  // fits in MAX_PROMPT_BYTES. Never drop the first two sections
  // (header + core facts) — they're the load-bearing identity.
  let prompt = sections.join('\n\n');
  while (byteLength(prompt) > MAX_PROMPT_BYTES && sections.length > 2) {
    sections.pop();
    prompt = sections.join('\n\n');
  }
  // If even the first two sections overflow (pathological case —
  // a project with a 5 KB description), hard-truncate the final
  // string at the cap so the CLI arg does not balloon.
  if (byteLength(prompt) > MAX_PROMPT_BYTES) {
    prompt = hardTruncate(prompt, MAX_PROMPT_BYTES);
  }
  return prompt;
}

// ── Helpers ─────────────────────────────────────────────────────────

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf-8');
}

function hardTruncate(s: string, maxBytes: number): string {
  // Walk backwards from the byte cap to find a safe UTF-8 boundary
  // so we don't split a multi-byte character. The Buffer API makes
  // this easy: slice, decode, and trim the trailing replacement
  // character if any.
  const buf = Buffer.from(s, 'utf-8').subarray(0, maxBytes);
  return buf.toString('utf-8').replace(/\uFFFD+$/u, '');
}

function formatAssetSummary(asset: PikaSystemPromptAsset): string | null {
  // Each asset type carries a different shape in its metadata blob.
  // Rather than parse every shape through its schema, pull the
  // fields we actually want for the prompt via safe lookups and
  // skip anything unparseable. The prompt is user-facing prose, not
  // a contract — a missing asset line is better than an invite
  // failure.
  const metadata =
    typeof asset.metadata === 'object' && asset.metadata !== null
      ? (asset.metadata as Record<string, unknown>)
      : {};

  // Each asset type carries a different shape in its metadata blob.
  // Pull whichever field is most useful for the prompt and fall
  // through to a minimal label for the rest. The `AssetType` union
  // covers every value in the drizzle pgEnum; adding a new type is
  // a one-line addition here.
  switch (asset.type) {
    case 'blog_post': {
      const title =
        typeof metadata['title'] === 'string' ? metadata['title'] : null;
      if (title) return `Blog post: "${title}"`;
      if (asset.content) {
        return `Blog post: ${asset.content.slice(0, 80)}`;
      }
      return 'Blog post';
    }
    case 'twitter_thread': {
      const excerpt = asset.content?.split('\n')[0]?.slice(0, 100);
      return excerpt ? `Twitter thread: "${excerpt}"` : 'Twitter thread';
    }
    case 'linkedin_post': {
      const excerpt = asset.content?.split('\n')[0]?.slice(0, 100);
      return excerpt ? `LinkedIn post: "${excerpt}"` : 'LinkedIn post';
    }
    case 'hacker_news_post': {
      const excerpt = asset.content?.split('\n')[0]?.slice(0, 100);
      return excerpt ? `Hacker News post: "${excerpt}"` : 'Hacker News post';
    }
    case 'product_hunt_description':
      return 'Product Hunt description';
    case 'faq':
      return 'FAQ';
    case 'changelog_entry':
      return 'Changelog entry';
    case 'tips':
      return 'Launch tips';
    case 'og_image': {
      const prompt =
        typeof metadata['imagePrompt'] === 'string'
          ? metadata['imagePrompt']
          : null;
      return prompt ? `OG image: ${prompt.slice(0, 100)}` : 'OG image';
    }
    case 'social_card': {
      const prompt =
        typeof metadata['imagePrompt'] === 'string'
          ? metadata['imagePrompt']
          : null;
      return prompt
        ? `Social card: ${prompt.slice(0, 100)}`
        : 'Social card';
    }
    case 'product_video': {
      const prompt =
        typeof metadata['videoPrompt'] === 'string'
          ? metadata['videoPrompt']
          : null;
      return prompt
        ? `Product video: ${prompt.slice(0, 100)}`
        : 'Product video';
    }
    case 'video_storyboard':
      return 'Video storyboard';
    case 'voiceover_script':
      return 'Voiceover script';
    case 'voice_commercial':
      return 'Voice commercial';
    case 'podcast_script':
      return 'Podcast script';
    case 'per_commit_teaser':
      return 'Commit teaser video';
    case 'world_scene': {
      const worldLabsBlob =
        typeof metadata['worldLabs'] === 'object' &&
        metadata['worldLabs'] !== null
          ? (metadata['worldLabs'] as Record<string, unknown>)
          : null;
      const caption =
        typeof worldLabsBlob?.['caption'] === 'string'
          ? worldLabsBlob['caption']
          : null;
      return caption
        ? `3D world scene: ${caption.slice(0, 100)}`
        : '3D world scene';
    }
  }
}
