import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { RepoAnalysis, ResearchResult } from '@launchkit/shared';
import { runAgent } from '../lib/agent-sdk-runner.js';
import { searchRepos } from '../tools/github-repository-tools.js';
import { findSimilarProjects } from '../tools/project-insight-memory.js';

/**
 * Research agent for the launch pipeline.
 *
 * Given a repo analysis, this agent autonomously researches the
 * competitive landscape, target audience, and market positioning,
 * then emits a structured `ResearchResult`.
 *
 * Tool surface
 * ------------
 *
 *   - `WebSearch` (built-in, server-side) — replaces the old DuckDuckGo
 *     scraper. Anthropic runs the search on their infrastructure with
 *     dynamic filtering on Opus 4.6, so results are pre-filtered for
 *     relevance before they hit the model's context window.
 *
 *   - `WebFetch` (built-in, server-side) — replaces the old fetchUrl
 *     helper. Anthropic fetches the page, sanitizes the content, and
 *     returns clean text. No SSRF risk because nothing leaves the
 *     Anthropic boundary; no prompt-injection sanitization burden on
 *     us because Anthropic handles it.
 *
 *   - `mcp__launchkit__search_github` (in-process MCP tool) — wraps
 *     `searchRepos` for finding similar GitHub projects. Kept as a
 *     custom tool because the GitHub API gives richer metadata than
 *     a generic web search would.
 *
 *   - `mcp__launchkit__lookup_similar_projects` (in-process MCP tool)
 *     — wraps `findSimilarProjects` for pgvector-backed similarity
 *     against past projects in the LaunchKit database. The whole point
 *     of the self-learning system; cannot be replaced by web search.
 *
 *   - `mcp__launchkit__research_complete` (in-process MCP tool) — the
 *     terminal tool. The agent calls this when its research is done
 *     and the input contains the structured `ResearchResult` payload.
 *     We capture the input via a closure and end the run.
 *
 * The agent receives no `fetchUrl` or DuckDuckGo equivalent — by design.
 * Both are now Anthropic-hosted server tools.
 */

const SYSTEM_PROMPT = `You are a developer marketing researcher. Given a GitHub repository analysis, your job is to deeply research the product's competitive landscape, target audience, and market positioning.

You have access to five tools:

1. **WebSearch** — Anthropic's server-side web search. Use this for the bulk of your research: searching for competitors, market discussions, alternatives lists, Hacker News threads, Reddit conversations, blog posts, and developer community sentiment. It returns ranked results with snippets.

2. **WebFetch** — Anthropic's server-side URL fetcher. Use this when WebSearch surfaces a specific page that warrants reading in full (e.g. a competitor's docs, an alternatives blog post, an HN thread).

3. **mcp__launchkit__search_github** — Search the GitHub API for repositories matching a query. Use this when you want richer GitHub-specific metadata (stars, topics, language, full description) than a generic web search would surface.

4. **mcp__launchkit__lookup_similar_projects** — Look up previously analyzed projects in the LaunchKit database via vector similarity. Use this once early in research to see if any past launch strategies are relevant.

5. **mcp__launchkit__research_complete** — Call this when your research is thorough enough to make confident strategic recommendations. The arguments to this tool are your final structured research output. **IMMEDIATELY after calling this tool you must stop. Do not call any further tools. Do not produce any further text. The agent ends as soon as research_complete is called.**

Research workflow:

1. Call \`lookup_similar_projects\` once with a short description of the product to see if past launches inform the strategy.
2. Use \`WebSearch\` 2–4 times with different queries to find competitors, alternatives, and market discussions.
3. Use \`search_github\` 1–2 times for additional GitHub-specific competitor metadata.
4. Use \`WebFetch\` selectively on the most interesting pages WebSearch surfaced.
5. Synthesize what you have learned and call \`research_complete\` with the structured result. Then stop.

Be thorough but efficient. 5–10 tool calls is typical. Stop when additional research would not meaningfully change your recommendations. Do not guess — verify with tools.`;

/**
 * Schema for the structured research result the agent emits via the
 * `research_complete` terminal tool. Stays close to the
 * `ResearchResult` shape in @launchkit/shared.
 */
const researchCompleteSchema = {
  competitors: z
    .array(
      z.object({
        name: z.string().describe('Competitor product name'),
        url: z.string().describe('Project or marketing URL'),
        description: z.string().describe('Short description'),
        stars: z.number().optional().describe('GitHub stars if known'),
        differentiator: z
          .string()
          .describe('How this product differs from the target product'),
      })
    )
    .describe('Competing or similar products found during research'),
  targetAudience: z
    .string()
    .describe('Who would use this product and why, in 1–3 sentences'),
  marketContext: z
    .string()
    .describe('Current market landscape and trends, in 1–3 sentences'),
  uniqueAngles: z
    .array(z.string())
    .describe('Unique positioning angles for this product vs competitors'),
  recommendedChannels: z
    .array(z.string())
    .describe('Marketing channels that fit this product and audience'),
  hnMentions: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        points: z.number(),
        commentCount: z.number(),
      })
    )
    .optional()
    .describe('Relevant Hacker News discussions'),
};

export async function runResearchAgent(
  projectId: string,
  repoAnalysis: RepoAnalysis
): Promise<ResearchResult> {
  // The terminal tool captures the agent's structured output via this
  // closure. The agent calls research_complete with the full payload;
  // the handler stores it and the agent ends its turn naturally.
  let captured: ResearchResult | null = null;

  // Heterogeneous tool array. Each `tool()` call is generic over its
  // input schema, and the resulting union cannot be assigned to an
  // explicitly-typed array because of handler contravariance. Both the
  // Agent SDK's own internals and our runner accept the wider
  // `SdkMcpToolDefinition<any>[]` shape, but TypeScript's strict mode
  // refuses the implicit conversion. Casting through `unknown` once at
  // the array boundary is the documented escape hatch for this exact
  // case — the runtime is fine because every concrete tool already
  // satisfies the structural contract; we are only telling the
  // typechecker to drop the variance check on a known-safe widening.
  const tools = [
    tool(
      'search_github',
      'Search GitHub for repositories similar to the target product. Returns up to 5 results with name, description, stars, language, URL, and topics. Use this when GitHub-specific metadata is more useful than a generic web search result.',
      {
        query: z
          .string()
          .describe(
            "GitHub search query, e.g. 'react state management' or 'cli tool generator'"
          ),
      },
      async ({ query }) => {
        const results = await searchRepos(query);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }
    ),
    tool(
      'lookup_similar_projects',
      'Find previously analyzed projects in the LaunchKit database that are semantically similar to this one. Uses pgvector cosine similarity over project embeddings. Helps reuse past launch strategy insights.',
      {
        description: z
          .string()
          .describe('Brief description of the product to find similar ones'),
      },
      async ({ description }) => {
        const results = await findSimilarProjects(description);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }
    ),
    tool(
      'research_complete',
      "Submit the final structured research result. Call this when your research is thorough enough to make confident strategic recommendations. After this call the agent ends.",
      researchCompleteSchema,
      async (args) => {
        captured = {
          competitors: args.competitors,
          targetAudience: args.targetAudience,
          marketContext: args.marketContext,
          uniqueAngles: args.uniqueAngles,
          recommendedChannels: args.recommendedChannels,
          hnMentions: args.hnMentions ?? [],
        };
        return {
          content: [
            {
              type: 'text',
              text: 'Research recorded. End your turn now.',
            },
          ],
        };
      }
    ),
  ];

  await runAgent({
    systemPrompt: SYSTEM_PROMPT,
    prompt: `Research this product for go-to-market planning. Use your tools, then call research_complete with the structured findings.\n\n${JSON.stringify(repoAnalysis, null, 2)}`,
    // Cast through `unknown` to widen the heterogeneous tool union to
    // the SDK's `Array<SdkMcpToolDefinition<any>>` shape — see the
    // comment above the `tools` declaration for the contravariance
    // explanation.
    tools: tools as unknown as Parameters<typeof runAgent>[0]['tools'],
    builtInTools: ['WebSearch', 'WebFetch'],
    // 15 was the old `runAgentLoop` ceiling and was sufficient for the
    // existing research workload. Going higher invites the model to
    // continue calling tools after `research_complete` (it shouldn't,
    // per the system prompt, but defending against it costs nothing).
    maxTurns: 15,
    effort: 'max',
    projectId,
    phase: 'researching',
    // We rely on the closure-captured result from the
    // `research_complete` terminal tool, not the agent's final text —
    // the system prompt instructs the model to stop immediately after
    // calling that tool, which means the run typically ends with no
    // trailing assistant text. Ignore `finalText` entirely.
    parseResult: () => {
      if (!captured) {
        throw new Error(
          'Research agent finished without calling research_complete'
        );
      }
      return captured;
    },
  });

  // `runAgent` already throws via `parseResult` if `captured` is null,
  // so reaching this point means it is non-null. The non-null assertion
  // is load-bearing only for TypeScript's narrowing — the runtime
  // contract is enforced inside the parser callback above.
  return captured!;
}
