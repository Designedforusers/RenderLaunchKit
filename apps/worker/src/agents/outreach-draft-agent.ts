import { z } from 'zod';
import {
  OutreachChannelSchema,
  type AssetType,
  type InfluencerCandidate,
  type OutreachChannel,
  type RepoAnalysis,
  type StrategyBrief,
} from '@launchkit/shared';
import { generateJSON } from '../lib/anthropic-claude-client.js';

/**
 * Phase 5 — Outreach draft agent.
 *
 * Takes a single matched influencer + a single asset (typically the
 * blog post or product hunt description) + the launch strategy and
 * produces one or more `PendingOutreachDraft` records the caller
 * (Phase 6's `process-commit-marketing-run` processor) will turn into
 * `outreach_drafts` rows.
 *
 * NOT an agentic-loop tool. The outreach draft is a constrained text
 * generation task — one Claude call producing structured JSON via
 * `generateJSON()`. Same shape as `launch-strategy-agent.ts:74-79`.
 *
 * The return type is intentionally NARROWER than `OutreachDraftInsert`:
 * the agent only decides `{ channel, draftText, assetId }`. The caller
 * stamps `commitMarketingRunId` and `influencerId` at insert time. We
 * deliberately do NOT bake placeholder UUIDs into the agent output
 * because a nil-UUID `influencer_id` would silently FK-violate the
 * `outreach_drafts.influencer_id REFERENCES dev_influencers.id`
 * constraint the first time a caller forgot to rewrite it. The
 * narrower type makes it impossible for Phase 6 to forget the
 * lookup — TypeScript flags the missing fields at the call site.
 *
 * Pure function. Returns generated drafts; does NOT touch the
 * database. Phase 6 owns the inserts because the
 * `outreach_drafts.commit_marketing_run_id` FK is `NOT NULL` and only
 * Phase 6's processor creates the parent `commit_marketing_runs` row.
 *
 * Sparse platforms are the norm
 * ------------------------------
 *
 * Most influencers in the curated seed only have 1-2 of the 7 possible
 * platform handles. The agent never assumes any specific platform is
 * present — channel selection is opportunistic, not required:
 *
 *   - `twitter_dm` when `platforms.twitter` is set
 *   - `email`      when `platforms.website` is set (the website usually
 *     has a contact form or surfaces an email address)
 *   - `comment`    is a public-reply channel that works on whichever
 *     conversational platform the influencer is most active on:
 *     HN reply, dev.to comment, GitHub discussion, Reddit thread, etc.
 *     Any influencer with at least one of `hackernews`, `devto`,
 *     `github`, or `reddit` set is eligible.
 *
 * Callers (Phase 6) MUST pre-filter via `hasContactableChannel()` so
 * the agent is never invoked for an influencer with zero viable
 * channels. The schema requires `≥1` draft per call — that contract
 * holds because the caller has already checked.
 *
 * Per-channel character limits
 * ----------------------------
 *
 *   - `twitter_dm` ≤ 280 chars (matches the X DM limit)
 *   - `email`      ≤ 1500 chars (a polite cold email is short)
 *   - `comment`    ≤ 500 chars (a public comment is even shorter)
 *
 * Enforced by the system prompt AND by a post-call validation step
 * that drops any draft over the limit. Better to ship 2 drafts than
 * 4 with two too long.
 */

const SYSTEM_PROMPT = `You are a developer outreach copywriter. Given an influencer profile, a launch asset (blog post, product hunt listing, etc.), and the launch strategy, write personalised outreach drafts the user will copy and send manually.

Voice
-----

- Direct, specific, never generic. A draft that could apply to any product is a bad draft.
- Reference the influencer's recent topics or bio CONCRETELY — "I saw your post on X" or "Your work on Y inspired ...". Never claim to have used a product you have not used or to know the influencer personally.
- Open with WHY this influencer specifically (one sentence). Middle: one specific feature of the product they would care about. Close with a clear ask (read the post / try the tool / share an opinion).
- Match the launch strategy tone (technical / casual / enthusiastic / authoritative).

Channel selection (sparse platforms are normal)
-----------------------------------------------

Most influencers only have 1-2 of the 7 possible platform handles. Pick channels based on what you SEE in the influencer's platforms map — never assume a platform that isn't listed.

- \`twitter_dm\` — ONLY when \`platforms.twitter\` is set. The draft is the full DM body. ≤ 280 chars.
- \`email\` — ONLY when \`platforms.website\` is set (the website usually surfaces a contact form or email). The draft includes a subject line on the first line then a blank line then the body. ≤ 1500 chars total.
- \`comment\` — a public reply on whatever conversational platform the influencer is most active on. Use this when ANY of \`platforms.hackernews\`, \`platforms.devto\`, \`platforms.github\`, or \`platforms.reddit\` is set. The draft should feel like a thoughtful comment that adds value to a thread, not just self-promotion. Pick the platform that fits the asset type best (HN for technical deep-dives, dev.to for tutorials, GitHub for libraries/CLIs, Reddit for discussion-y posts). ≤ 500 chars.

Do NOT produce a draft for a channel whose required platforms are absent. If the influencer only has \`hackernews\` set, you ONLY emit a \`comment\` draft — do not invent a twitter_dm. If the influencer has \`twitter\` AND \`website\` AND \`github\`, you may emit up to all three corresponding drafts.

Output format
-------------

You MUST output valid JSON with this exact shape:

{
  "drafts": [
    {
      "channel": "twitter_dm" | "email" | "comment",
      "draftText": "the full draft text (subject + body for email, just the message for the others)"
    }
  ]
}

One to three drafts total — pick the channels that genuinely fit, do not produce a draft for every possible channel. Quality over quantity.`;

const DraftSchema = z.object({
  channel: OutreachChannelSchema,
  draftText: z.string().min(1),
});
const DraftBatchSchema = z.object({
  drafts: z.array(DraftSchema).min(1).max(3),
});

const CHANNEL_CHAR_LIMITS: Record<z.infer<typeof OutreachChannelSchema>, number> = {
  twitter_dm: 280,
  email: 1500,
  comment: 500,
};

export interface OutreachDraftInput {
  influencer: InfluencerCandidate;
  asset: {
    id: string;
    type: AssetType;
    content: string;
    metadata: unknown;
  };
  repoAnalysis: RepoAnalysis;
  strategy: StrategyBrief;
}

/**
 * The narrowed shape the agent returns. Phase 6's processor adds
 * `commitMarketingRunId` (from the run row it just created) and
 * `influencerId` (from a `dev_influencers` lookup by handle) to
 * produce a full `OutreachDraftInsert` ready for `db.insert`.
 *
 * Carrying `influencerHandle` instead of a baked UUID makes it
 * impossible for the caller to skip the lookup — TypeScript will
 * flag the missing `influencerId` field at the `db.insert` call site
 * if Phase 6 tries to use this shape directly.
 */
export interface PendingOutreachDraft {
  influencerHandle: string;
  assetId: string;
  channel: OutreachChannel;
  draftText: string;
}

/**
 * Returns true when the influencer has at least one platform handle
 * that maps to a viable outreach channel. Phase 6's processor calls
 * this BEFORE invoking `generateOutreachDrafts` so the agent never
 * runs against an influencer with zero contactable surfaces (the
 * agent's schema requires `≥1` draft per call, so a zero-draft
 * response would throw — pre-filtering is the right place to handle
 * the no-platform case).
 *
 * Sparse platforms are the norm. Most curated seed entries only have
 * 1-2 platform handles set; this helper just checks "at least one
 * channel maps cleanly."
 */
export function hasContactableChannel(
  influencer: Pick<InfluencerCandidate, 'platforms'>
): boolean {
  const p = influencer.platforms;
  return Boolean(
    p.twitter ??
      p.website ??
      p.hackernews ??
      p.devto ??
      p.github ??
      p.reddit
  );
}

/**
 * Generate one to three outreach drafts for a single (influencer × asset)
 * pair. Returns `PendingOutreachDraft[]` — Phase 6's processor adds
 * `commitMarketingRunId` and `influencerId` (via a dev_influencers
 * lookup by handle) before persistence.
 */
export async function generateOutreachDrafts(
  input: OutreachDraftInput
): Promise<PendingOutreachDraft[]> {
  const userPrompt = buildUserPrompt(input);

  const result = await generateJSON(DraftBatchSchema, SYSTEM_PROMPT, userPrompt, {
    maxTokens: 2048,
  });

  // Drop any draft that violates the per-channel character limit. The
  // prompt asks for compliance and the schema enforces shape, but the
  // length check is a defensive guard against a model that over-talks.
  const compliant = result.drafts.filter((draft) => {
    const limit = CHANNEL_CHAR_LIMITS[draft.channel];
    if (draft.draftText.length > limit) {
      console.warn(
        `[outreach-draft] dropping ${draft.channel} draft over limit (${String(draft.draftText.length)} > ${String(limit)})`
      );
      return false;
    }
    return true;
  });

  if (compliant.length === 0) {
    throw new Error(
      'outreach-draft-agent: every generated draft exceeded its channel character limit'
    );
  }

  return compliant.map((draft): PendingOutreachDraft => ({
    influencerHandle: input.influencer.handle,
    assetId: input.asset.id,
    channel: draft.channel,
    draftText: draft.draftText,
  }));
}

function buildUserPrompt(input: OutreachDraftInput): string {
  const platforms = Object.entries(input.influencer.platforms)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(', ');

  const recentTopicLine =
    input.influencer.recentTopics.length > 0
      ? input.influencer.recentTopics.slice(0, 5).join(', ')
      : '(none on file)';

  return `## Influencer

Handle: ${input.influencer.handle}
Platforms: ${platforms || '(none)'}
Categories: ${input.influencer.categories.join(', ')}
Bio: ${input.influencer.bio ?? '(none)'}
Audience: ${String(input.influencer.audienceSize)}
Recent topics: ${recentTopicLine}
Match reasoning: ${input.influencer.matchReasoning}

## Launch asset

Type: ${input.asset.type}
Content (excerpt):
${input.asset.content.slice(0, 1200)}${input.asset.content.length > 1200 ? '\n...' : ''}

## Launch strategy

Positioning: ${input.strategy.positioning}
Tone: ${input.strategy.tone}
Key messages:
${input.strategy.keyMessages.map((m) => `- ${m}`).join('\n')}

## Product

Repo: ${input.repoAnalysis.description || '(no description)'}
Language: ${input.repoAnalysis.language}
Tech stack: ${input.repoAnalysis.techStack.join(', ')}
Category: ${input.repoAnalysis.category}

Generate 1-3 personalised outreach drafts following the channel rules and character limits in the system prompt.`;
}
