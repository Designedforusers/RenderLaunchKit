import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { runAgentLoop } from '../lib/claude.js';
import { events } from '../lib/publisher.js';
import { searchRepos } from '../tools/github.js';
import { searchWeb, fetchUrl } from '../tools/web-search.js';
import { findSimilarProjects } from '../tools/memory.js';
import type { RepoAnalysis, ResearchResult } from '@launchkit/shared';

const TOOLS: Tool[] = [
  {
    name: 'search_github',
    description: 'Search GitHub for repositories similar to the target. Use this to find competitors and similar tools.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'GitHub search query (e.g. "react state management" or "cli tool generator")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_web',
    description: 'Search the web for information about a topic, product, or market. Use for finding blog posts, comparisons, discussions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch and read content from a specific URL. Use when you find an interesting link from search results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'lookup_similar_projects',
    description: 'Find previously analyzed projects similar to this one using vector similarity. Helps learn from past launch strategies.',
    input_schema: {
      type: 'object' as const,
      properties: {
        description: { type: 'string', description: 'Brief description of the project to find similar ones' },
      },
      required: ['description'],
    },
  },
  {
    name: 'research_complete',
    description: 'Call this when your research is thorough enough to make confident strategic recommendations. Returns the final research summary.',
    input_schema: {
      type: 'object' as const,
      properties: {
        competitors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              url: { type: 'string' },
              description: { type: 'string' },
              stars: { type: 'number' },
              differentiator: { type: 'string' },
            },
            required: ['name', 'description', 'differentiator'],
          },
          description: 'Competing/similar products found',
        },
        targetAudience: { type: 'string', description: 'Who would use this product and why' },
        marketContext: { type: 'string', description: 'Current market landscape and trends' },
        uniqueAngles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Unique positioning angles for this product vs competitors',
        },
        recommendedChannels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Marketing channels that fit this product and audience',
        },
        hnMentions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              points: { type: 'number' },
              commentCount: { type: 'number' },
            },
          },
          description: 'Relevant Hacker News discussions found',
        },
      },
      required: ['competitors', 'targetAudience', 'marketContext', 'uniqueAngles', 'recommendedChannels'],
    },
  },
];

const SYSTEM_PROMPT = `You are a developer marketing researcher. Given a GitHub repository analysis, your job is to deeply research the product's competitive landscape, target audience, and market positioning.

You have access to tools. Use them iteratively — search for competitors, read their pages, search for discussions on Hacker News and Reddit, look for similar products. Make multiple searches until you have a thorough understanding.

Do NOT guess. Use your tools to verify. If you think there's a competitor, search for it. If you think there's a community discussing this type of tool, find it.

When you have enough information to make confident strategic recommendations, call research_complete with your findings.

Typical research flow:
1. Search GitHub for similar repos (2-3 searches with different queries)
2. Search web for the product category + "alternatives"
3. Check Hacker News/Reddit for discussions about this type of tool
4. Look at how successful similar products launched
5. Identify what makes THIS product different from what exists
6. Determine which developer communities would care most

Be thorough but efficient. 5-10 tool calls is typical. Stop when additional research would not meaningfully change your recommendations.

If a tool returns an error or empty results, try a different query. Don't give up after one failed search.`;

/**
 * Run the research agent — the core agentic loop.
 * Claude autonomously decides what to research and when to stop.
 */
export async function runResearchAgent(
  projectId: string,
  repoAnalysis: RepoAnalysis
): Promise<ResearchResult> {
  const toolExecutor = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case 'search_github':
        return searchRepos(input.query as string);
      case 'search_web':
        return searchWeb(input.query as string);
      case 'fetch_url':
        return fetchUrl(input.url as string);
      case 'lookup_similar_projects':
        return findSimilarProjects(input.description as string);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  const result = await runAgentLoop({
    systemPrompt: SYSTEM_PROMPT,
    initialMessage: `Research this product for go-to-market planning:\n\n${JSON.stringify(repoAnalysis, null, 2)}`,
    tools: TOOLS,
    toolExecutor,
    terminalTool: 'research_complete',
    maxSteps: 15,
    onToolCall: (name, input) => {
      events.toolCall(projectId, 'research', name, input);
      console.log(`[Research] Tool call: ${name}(${JSON.stringify(input).slice(0, 100)})`);
    },
  });

  // Ensure we have a valid research result
  const research = result as ResearchResult;
  if (!research.competitors || !research.targetAudience) {
    throw new Error('Research agent did not produce valid results');
  }

  return {
    ...research,
    hnMentions: research.hnMentions || [],
  };
}
