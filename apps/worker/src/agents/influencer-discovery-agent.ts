import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import {
  InfluencerCandidateSchema,
  type InfluencerCandidate,
  type InfluencerPlatforms,
} from '@launchkit/shared';
import { asAgentSdkTools, runAgent } from '../lib/agent-sdk-runner.js';
import { database as db } from '../lib/database.js';
import { enrichGitHubUser } from '../tools/enrich-github-user.js';
import { enrichDevtoUser } from '../tools/enrich-devto-user.js';
import { enrichHnUser } from '../tools/enrich-hn-user.js';
import { enrichXUser } from '../tools/enrich-x-user.js';
import type { InfluencerProfile } from '../tools/influencer-enrichment-types.js';

/**
 * Phase 5 — Influencer discovery agent.
 *
 * Mirrors the structure of `apps/worker/src/agents/trending-signals-agent.ts`
 * exactly: declares an in-process tool surface, runs through the Agent SDK
 * via `runAgent()`, captures structured output via a closure-bound terminal
 * tool. The agent walks from a project category + commit topics back to
 * a ranked list of `InfluencerCandidate` rows ready for the outreach-draft
 * agent (or for persistence to `dev_influencers` if the cron is the caller).
 *
 * Tool surface
 * ------------
 *
 *   - `harvest_candidate_handles` (in-process) — reads the existing
 *     `trend_signals` rows from the last 7 days for the given category,
 *     dedupes by `(source, author)`, returns 30–50 candidate handles.
 *     Phase 3 already harvested these from every source via the trending
 *     signals agent; Phase 5 reuses that work instead of re-fetching.
 *
 *   - `enrich_github_user`, `enrich_devto_user`, `enrich_hn_user`,
 *     `enrich_x_user` (in-process) — single-handle profile lookups via
 *     the Phase 5 enrichment tools. The X tool returns `null` when its
 *     env var is unset, so the agent's tool surface stays the same
 *     regardless of whether the paid X path is enabled.
 *
 *   - `lookup_existing_influencer` (in-process) — `SELECT FROM dev_influencers
 *     WHERE handle = $1` so the agent can refresh an existing row instead
 *     of producing a duplicate candidate.
 *
 *   - `discovery_complete` (in-process, terminal) — captures the final
 *     `InfluencerCandidate[]` via closure and ends the run. Same pattern
 *     as `trends_complete` in `trending-signals-agent.ts:375-391`.
 *
 * Pure function — no DB inserts, no side effects beyond the upstream API
 * calls the enrichment tools make. Phase 6's `process-commit-marketing-run`
 * calls this and either passes the candidates straight to the
 * `outreach-draft-agent` (transient candidates) or upserts them into
 * `dev_influencers` first (persistent enrichment).
 */

const SYSTEM_PROMPT = `You are a developer influencer discovery analyst. Given a project category and a list of commit topics, your job is to identify the 5–10 dev influencers most likely to amplify a launch in that space.

Workflow:

1. Call \`harvest_candidate_handles\` exactly once with the project category. The tool returns up to 50 distinct handles already mentioned in trending dev posts within the last 7 days, scoped to the category. These are the seed candidates.

2. For each candidate, decide which enrichment tools to call based on which platforms the handle plausibly belongs to. GitHub usernames go through \`enrich_github_user\`; dev.to usernames through \`enrich_devto_user\`; Hacker News usernames through \`enrich_hn_user\`; if you have reason to believe the same handle is on X (similar string, public dev presence), call \`enrich_x_user\`. Each enrichment tool returns a structured profile or \`null\` — \`null\` means "not on this platform" and you should NOT retry.

3. Optionally call \`lookup_existing_influencer\` for any handle to see if it's already in the database. If it is, prefer the persisted row's bio + categories over the freshly-enriched ones (the cron has already done the work).

4. For each candidate that has at least ONE successful enrichment, decide whether they fit the commit's category and topics:
   - Their bio mentions related work
   - Their public_repos / post_count / karma indicates active engagement in this space
   - Their audience size is non-trivial (>100 followers/karma is a soft floor)

5. Drop candidates that don't fit. Aim for 5–10 high-quality matches over 30 weak matches.

6. For each surviving candidate, write a one-sentence \`matchReasoning\` explaining WHY they fit this commit (reference the bio, the platforms, the topics — be specific). Assign a \`matchScore\` in [0, 1] based on how strongly the fit holds.

7. Call \`discovery_complete\` with the final candidate list. IMMEDIATELY after calling this tool you must stop — do not call any further tools.

Be efficient. 8–20 enrichment calls + 1 terminal call is typical. Do not enrich every handle on every platform — pick the 1–2 most likely platforms per handle based on the handle pattern and the trending source it came from.`;

// ── Tool input schemas ────────────────────────────────────────────

const HARVEST_INPUT_SCHEMA = {
  // No input — the category is closed over from the runInfluencerDiscoveryAgent input.
};

const ENRICH_INPUT_SCHEMA = {
  handle: z.string().min(1).describe('Bare handle on the source platform (no @ prefix).'),
};

const LOOKUP_INPUT_SCHEMA = {
  handle: z.string().min(1).describe('Bare handle to look up in the dev_influencers table.'),
};

// The terminal tool's input schema validates the agent's structured
// output before the closure captures it. Mirrors `InfluencerCandidate`
// in `@launchkit/shared` so a model error surfaces here, not later.
const DISCOVERY_COMPLETE_INPUT_SCHEMA = {
  candidates: z
    .array(InfluencerCandidateSchema)
    .min(1)
    .max(15)
    .describe('Final list of 5–10 ranked influencer candidates.'),
};

// ── Public input + output ─────────────────────────────────────────

export interface InfluencerDiscoveryInput {
  /** Project category — must match `dev_influencers.categories` overlap. */
  category: string;
  /** Commit + repo topics — passed to the system prompt for context. */
  topics: string[];
  /**
   * Optional pre-seeded handles to enrich. When set, the agent skips
   * the `harvest_candidate_handles` step and uses these directly.
   * Useful for tests + for callers that already know the candidate
   * pool.
   */
  candidateHandles?: string[];
  /** Max candidates to return. Default 10. */
  limit?: number;
  /**
   * Optional project ID for SSE progress publishing. When set the
   * runner streams tool-call events to the project's channel so the
   * dashboard's live feed can narrate the discovery pass.
   */
  projectId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────

interface CandidateHandleRow {
  source: string;
  author: string;
  topic: string;
  headline: string;
}

/**
 * Read recent `trend_signals` rows for a category and dedupe by
 * `(source, author)`. The author column on `trend_signals` is sourced
 * from `SignalItem.author` which every Phase 3 source tool populates
 * (`trending-signal-types.ts:54`), so this is the inverse of Phase 3's
 * harvest direction: we walk the same rows back to the people who
 * produced them.
 */
async function harvestCandidateHandles(
  category: string,
  limit: number = 50
): Promise<CandidateHandleRow[]> {
  const rows = await db.query.trendSignals.findMany({
    where: eq(schema.trendSignals.category, category),
    orderBy: [desc(schema.trendSignals.ingestedAt)],
    limit: 200,
  });

  const seen = new Set<string>();
  const out: CandidateHandleRow[] = [];
  for (const row of rows) {
    // The `raw_payload` jsonb cell carries `author` per the Phase 3
    // SignalItem shape — read it through bracket notation since it's
    // an open-ended jsonb shape, then coerce to string.
    const payload = row.rawPayload;
    if (!payload || typeof payload !== 'object') continue;
    const payloadObj = payload as Record<string, unknown>;
    const author = payloadObj['author'];
    if (typeof author !== 'string' || author.length === 0) continue;

    const key = `${row.source}:${author}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: row.source,
      author,
      topic: row.topic,
      headline: row.headline,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Map an `InfluencerProfile` from one of the enrichment tools onto a
 * fragment of the `InfluencerCandidate` shape. The agent assembles one
 * candidate from multiple profiles by merging fragments — this helper
 * just normalises the per-source bag.
 */
function profileFragment(profile: InfluencerProfile): {
  bio: string | null;
  followers: number;
  platformKey: keyof InfluencerPlatforms;
} {
  // Each enrichment source maps to one InfluencerPlatforms key.
  // `hackernews` is the platforms key (per InfluencerPlatformsSchema)
  // but `hn_user` is the enrichment source — see the tool's source
  // enum in `influencer-enrichment-types.ts`.
  const platformKey: keyof InfluencerPlatforms =
    profile.source === 'github_user'
      ? 'github'
      : profile.source === 'devto_user'
        ? 'devto'
        : profile.source === 'hn_user'
          ? 'hackernews'
          : 'twitter';

  // For platforms that do not expose follower counts (HN, dev.to) we
  // fall back to the strongest available metric from the per-source
  // bag — karma for HN, post_count × 100 as a rough proxy for dev.to
  // (~100 followers per post is the rough conversion based on the
  // typical dev.to subscriber-to-post ratio).
  const fallbackFollowers =
    profile.followers ??
    profile.additionalMetrics.karma ??
    (profile.additionalMetrics.postCount !== undefined
      ? profile.additionalMetrics.postCount * 100
      : 0);

  return {
    bio: profile.bio,
    followers: fallbackFollowers,
    platformKey,
  };
}

// ── Main entry point ──────────────────────────────────────────────

export async function runInfluencerDiscoveryAgent(
  input: InfluencerDiscoveryInput
): Promise<InfluencerCandidate[]> {
  const limit = Math.min(Math.max(1, input.limit ?? 10), 15);

  // Pre-fetch the candidate pool so the harvest tool returns
  // immediately without re-querying. Same closure-pattern as
  // trending-signals-agent.ts:285-313's `collectRawSignals` pre-call.
  const candidatePool: CandidateHandleRow[] =
    input.candidateHandles && input.candidateHandles.length > 0
      ? input.candidateHandles.map((handle) => ({
          source: 'preseeded',
          author: handle,
          topic: input.topics.join(', '),
          headline: '(pre-seeded by caller)',
        }))
      : await harvestCandidateHandles(input.category, 50);

  // Sentinel pattern from trending-signals-agent.ts:340-341 — a plain
  // array is easier to narrow than a `T | null` after the async runAgent
  // call returns.
  let capturedCandidates: InfluencerCandidate[] = [];
  let capturedReceived = false;

  const tools = [
    tool(
      'harvest_candidate_handles',
      'Return up to 50 distinct influencer handles already mentioned in trending dev posts for this category in the last 7 days. Returns handles + the source they came from. Call this once at the start of every run with no arguments.',
      HARVEST_INPUT_SCHEMA,
      () =>
        Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  category: input.category,
                  topics: input.topics,
                  total: candidatePool.length,
                  candidates: candidatePool,
                },
                null,
                2
              ),
            },
          ],
        })
    ),
    tool(
      'enrich_github_user',
      "Look up a GitHub user's bio, follower count, and public repo count. Returns null when the handle does not exist on GitHub.",
      ENRICH_INPUT_SCHEMA,
      async (args) => {
        const profile = await enrichGitHubUser({ handle: args.handle });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(profile, null, 2),
            },
          ],
        };
      }
    ),
    tool(
      'enrich_devto_user',
      "Look up a dev.to user's bio + post count. Returns null when the handle does not exist on dev.to.",
      ENRICH_INPUT_SCHEMA,
      async (args) => {
        const profile = await enrichDevtoUser({ handle: args.handle });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(profile, null, 2),
            },
          ],
        };
      }
    ),
    tool(
      'enrich_hn_user',
      "Look up a Hacker News user's karma and about text. Returns null when the handle does not exist on HN.",
      ENRICH_INPUT_SCHEMA,
      async (args) => {
        const profile = await enrichHnUser({ handle: args.handle });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(profile, null, 2),
            },
          ],
        };
      }
    ),
    tool(
      'enrich_x_user',
      "Look up an X (Twitter) user's bio, follower count, and recent activity metrics. Returns null when the handle does not exist on X OR when the X API is not configured (gracefully degrades — do not retry on null).",
      ENRICH_INPUT_SCHEMA,
      async (args) => {
        const profile = await enrichXUser({ handle: args.handle });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(profile, null, 2),
            },
          ],
        };
      }
    ),
    tool(
      'lookup_existing_influencer',
      'Look up a handle in the dev_influencers table. Returns the persisted row if it exists, or null if not. Use this to avoid re-deriving categories and bio for influencers the cron has already enriched.',
      LOOKUP_INPUT_SCHEMA,
      async (args) => {
        const row = await db.query.devInfluencers.findFirst({
          where: eq(schema.devInfluencers.handle, args.handle),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: row === undefined ? 'null' : JSON.stringify(row, null, 2),
            },
          ],
        };
      }
    ),
    tool(
      'discovery_complete',
      'Submit the final ranked list of influencer candidates. Call this exactly once when your analysis is complete. After this call the agent ends immediately.',
      DISCOVERY_COMPLETE_INPUT_SCHEMA,
      (args) => {
        capturedCandidates = args.candidates;
        capturedReceived = true;
        return Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: 'Candidates recorded. End your turn now.',
            },
          ],
        });
      }
    ),
  ];

  const userPrompt = `Category: ${input.category}\nCommit topics: ${input.topics.join(', ') || '(none)'}\nLimit: ${String(limit)} candidates max.\n\nCall harvest_candidate_handles first. Then enrich the most promising handles and call discovery_complete with the result.`;

  await runAgent({
    systemPrompt: SYSTEM_PROMPT,
    prompt: userPrompt,
    // SDK contravariance bridge — `asAgentSdkTools` centralises the
    // single `as unknown as` cast that handles the heterogeneous Zod
    // tool union. See the helper's docstring in `agent-sdk-runner.ts`
    // for the rationale; CLAUDE.md inventories this as one cast even
    // though three agents now share the helper.
    tools: asAgentSdkTools(tools),
    builtInTools: ['WebSearch'],
    maxTurns: 25,
    effort: 'high',
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    phase: 'researching',
    parseResult: () => {
      if (!capturedReceived) {
        throw new Error(
          'Influencer-discovery agent finished without calling discovery_complete'
        );
      }
      return capturedCandidates;
    },
  });

  // Truncate to the caller's limit. The model is asked to stay within
  // 5-15 candidates but a defensive slice protects against drift.
  return capturedCandidates.slice(0, limit);
}

// Re-export the helpers so tests can drive them directly without
// spinning up the full agent loop.
export { harvestCandidateHandles, profileFragment };
