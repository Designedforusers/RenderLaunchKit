import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { TrendSourceSchema, type TrendSource } from '@launchkit/shared';
import {
  createExaMcpServerConfig,
  EXA_MCP_TOOL_NAMES,
  runAgent,
} from '../lib/agent-sdk-runner.js';
import { grokXSearch } from '../tools/grok-x-search.js';
import { searchDevto } from '../tools/search-devto.js';
import { searchHnAlgolia } from '../tools/search-hn-algolia.js';
import { searchReddit } from '../tools/search-reddit.js';
import { searchProductHunt } from '../tools/search-producthunt.js';
import { searchGitHubInfluencers } from '../tools/search-github-influencers.js';
import type { SignalItem } from '../tools/trending-signal-types.js';

/**
 * Trending-signals agent.
 *
 * Given a project category (e.g. "web-frameworks", "developer-tools",
 * "ai-apps"), this agent fans out across the seven trending-signal
 * sources — Grok live X search, Exa semantic web search, HN Algolia,
 * dev.to, Reddit, Product Hunt, GitHub — collects raw `SignalItem[]`
 * from each, and asks Claude to cluster the raw output into 3–5
 * coherent "trend signals." Each cluster carries:
 *
 *   - A short topic keyword
 *   - A headline summarizing what's being discussed
 *   - A representative URL from one of the signals
 *   - A normalized velocity score (0–1)
 *   - The list of raw `SignalItem` rows that fed the cluster
 *
 * The caller (the ingest-trending-signals cron) persists each cluster
 * as one `trend_signals` row and computes Voyage embeddings for the
 * topic+headline so the pgvector trend matcher can find the right
 * clusters for each commit later.
 *
 * Tool surface
 * ------------
 *
 *   - `collect_raw_signals` (in-process) — single composite tool that
 *     fans out across Grok + the five free APIs in parallel. Returns
 *     a `SignalItem[]` per source. The agent calls this once at the
 *     start of every run; from there the agentic loop is analysis
 *     only, not more data collection. Keeping data collection in one
 *     deterministic tool call avoids the model re-planning the
 *     parallel fan-out on every turn.
 *
 *   - `mcp__exa__web_search_exa` (external MCP) — Exa semantic web
 *     search, only enabled when `EXA_API_KEY` is set. Used for
 *     niche dev content the built-in Anthropic WebSearch misses
 *     (small-audience blog posts, niche newsletters, etc.).
 *
 *   - `WebSearch` / `WebFetch` (built-in) — fall-backs for when
 *     Exa is unavailable and the agent needs supplementary context.
 *
 *   - `trends_complete` (in-process, terminal) — the agent calls
 *     this when its clusters are ready. The handler captures the
 *     structured payload via a closure and ends the run.
 */

const SYSTEM_PROMPT = `You are a trending-signal analyst for a developer marketing tool. Given a project category, your job is to identify the 3–5 most important trending topics in the dev community for that category right now.

Workflow:

1. Call \`collect_raw_signals\` exactly once with the project category. The tool fans out across X (via Grok), Hacker News, dev.to, Reddit, Product Hunt, and GitHub in parallel and returns a normalized list of signals from each source.

2. Optionally call \`mcp__exa__web_search_exa\` once or twice to fill gaps — niche dev content (small newsletters, individual engineer blogs) that the mainstream sources will not surface. Do NOT use Exa for the same queries the free APIs already cover; only use it for the long tail.

3. Cluster the raw signals into 3–5 coherent trends. A "trend" is a topic multiple posts, from multiple sources, are discussing this week. Reject one-off posts — they are not trends. Each cluster must cite at least 2 signals from at least 2 different sources; otherwise drop it.

4. For each cluster, compute a velocity score between 0 and 1:
   - Total mention count across sources
   - Cross-source diversity (a trend on X + HN + Reddit scores higher than one on a single source)
   - Engagement weight (upvotes, reactions, stars)
   The score is a heuristic — the caller will normalize it later, so just be consistent within a single run.

5. Call \`trends_complete\` with the final cluster list. IMMEDIATELY after calling this tool you must stop — do not call any further tools, do not produce any further text.

Be efficient. 3–7 total tool calls is typical. Do not re-collect data; the collect_raw_signals call is deterministic and caches for 10 minutes.`;

/**
 * Result shape the agent emits via the `trends_complete` terminal
 * tool. Mirrors the fields the `trend_signals` table expects plus
 * the raw signals the caller needs for the `raw_payload` column and
 * for later audit.
 */
export interface TrendingSignalCluster {
  /** Short topic keyword — used as `trend_signals.topic`. */
  topic: string;
  /** One-line summary of what the trend is about. */
  headline: string;
  /** Representative URL for the cluster — points at one raw signal. */
  url: string | null;
  /** Primary source that owns the representative URL. */
  source: TrendSource;
  /** Heuristic velocity score in [0, 1]. */
  velocityScore: number;
  /** Raw signals that fed this cluster. Persisted verbatim. */
  rawSignals: SignalItem[];
}

/**
 * Zod shape for each cluster the agent emits. Extracted so we can
 * reuse the same schema for the tool input, the captured-result
 * type, and the post-processing pipeline without duplicating field
 * definitions.
 */
const AgentClusterSchema = z.object({
  topic: z
    .string()
    .min(1)
    .describe('Short keyword phrase for the trend (3–5 words max).'),
  headline: z
    .string()
    .min(1)
    .describe(
      'One-line summary of what is being discussed — ≤120 chars.'
    ),
  representativeUrl: z
    .string()
    .nullable()
    .describe(
      'URL of the single most representative post for this cluster, or null if none.'
    ),
  representativeSource: TrendSourceSchema.describe(
    'Source of the representativeUrl (hn, devto, grok, ...).'
  ),
  velocityScore: z
    .number()
    .min(0)
    .max(1)
    .describe('Heuristic velocity score in [0, 1].'),
  supportingSignalIndexes: z
    .array(z.number().int().nonnegative())
    .min(2)
    .describe(
      'Indexes into the raw signal list that support this cluster. Must reference at least 2 signals from at least 2 different sources.'
    ),
});

type AgentCluster = z.infer<typeof AgentClusterSchema>;

const TRENDS_COMPLETE_INPUT_SCHEMA = {
  clusters: z
    .array(AgentClusterSchema)
    .min(1)
    .max(6)
    .describe('Final list of 3–5 trend clusters.'),
};

export interface TrendingSignalsInput {
  /**
   * Project category the agent is analyzing — e.g. `web-frameworks`,
   * `developer-tools`, `ai-apps`. The agent maps this to
   * source-specific queries (GitHub topic, Reddit subreddit, etc.)
   * automatically via `collect_raw_signals`.
   */
  category: string;
  /**
   * Optional free-form seed keywords to bias the collection toward a
   * particular subset of the category. Passed through to every
   * upstream query alongside the category default.
   */
  seedKeywords?: string[];
  /**
   * Optional project ID for SSE progress publishing. When set the
   * runner streams tool-call events to the project's channel so the
   * dashboard's live feed can narrate the ingest pass.
   */
  projectId?: string;
}

/**
 * Map a `ProjectCategory` to the source-specific query shape each
 * free API needs. Keys match the `ProjectCategorySchema` enum values
 * in `packages/shared/src/schemas/repo-analysis.ts` so a category
 * rename flows through the typechecker, not a runtime string match.
 *
 * When a category has no good mapping for a source, that source
 * returns `null` and the raw-signal fan-out skips it for that
 * category rather than guessing.
 *
 * Exported so the cron job can log which sources are being queried
 * for each category as part of its structured ingest summary.
 */
export function resolveCategoryQueries(
  category: string,
  seedKeywords: string[] = []
): CategoryQueryMap {
  const base = category.trim().toLowerCase();
  const keywordString = [base.replace(/_/g, ' '), ...seedKeywords]
    .filter(Boolean)
    .join(' ');

  // All keyed by the ProjectCategory enum: cli_tool, web_app,
  // mobile_app, library, api, framework, devtool, infrastructure,
  // data, other.
  const subredditByCategory: Record<string, string> = {
    cli_tool: 'commandline',
    web_app: 'webdev',
    // Neutral choice — `mobiledev` covers iOS + Android + React
    // Native + Flutter rather than overfitting to one platform.
    mobile_app: 'mobiledev',
    library: 'programming',
    api: 'webdev',
    framework: 'webdev',
    devtool: 'programming',
    infrastructure: 'devops',
    data: 'dataengineering',
    // `other` is an explicit fallback category — skip Reddit so the
    // agent does not query `r/other` (which would return garbage).
    other: '',
  };

  const githubTopicByCategory: Record<string, string> = {
    cli_tool: 'cli',
    web_app: 'web',
    mobile_app: 'mobile',
    library: 'library',
    api: 'api',
    framework: 'framework',
    devtool: 'developer-tools',
    infrastructure: 'infrastructure',
    data: 'data',
    // Same fallback story — `topic:other` returns ~400 arbitrary
    // repos and is not a useful signal. Fall back to the broad
    // `programming` topic instead.
    other: 'programming',
  };

  const producthuntTopicByCategory: Record<string, string> = {
    cli_tool: 'developer-tools',
    web_app: 'developer-tools',
    mobile_app: 'developer-tools',
    library: 'developer-tools',
    api: 'developer-tools',
    framework: 'developer-tools',
    devtool: 'developer-tools',
    infrastructure: 'developer-tools',
    data: 'artificial-intelligence',
  };

  const devtoTagByCategory: Record<string, string> = {
    cli_tool: 'cli',
    web_app: 'webdev',
    mobile_app: 'mobile',
    library: 'javascript',
    api: 'api',
    framework: 'webdev',
    devtool: 'devtools',
    infrastructure: 'devops',
    data: 'dataengineering',
  };

  const subreddit = subredditByCategory[base] ?? null;
  return {
    grokTopic: keywordString,
    hnQuery: keywordString,
    devtoTag: devtoTagByCategory[base] ?? base,
    // An explicit empty-string mapping means "skip this source for
    // this category" — used by the `other` fallback to avoid hitting
    // non-existent subreddits.
    subreddit: subreddit === null || subreddit.length === 0 ? null : subreddit,
    producthuntTopic: producthuntTopicByCategory[base] ?? null,
    githubTopic: githubTopicByCategory[base] ?? base,
  };
}

export interface CategoryQueryMap {
  grokTopic: string;
  hnQuery: string;
  devtoTag: string;
  subreddit: string | null;
  producthuntTopic: string | null;
  githubTopic: string;
}

/**
 * Run every source in parallel and concatenate the results. Exposed
 * as a tool handler so the agent can trigger the whole fan-out with
 * one call, but also callable directly from tests and from the cron
 * when we want to bypass the agent for a deterministic ingest pass.
 */
export async function collectRawSignals(
  queries: CategoryQueryMap
): Promise<SignalItem[]> {
  const runs = await Promise.allSettled([
    grokXSearch({ topic: queries.grokTopic }),
    searchHnAlgolia({ query: queries.hnQuery }),
    searchDevto({ tag: queries.devtoTag }),
    queries.subreddit !== null
      ? searchReddit({ subreddit: queries.subreddit })
      : Promise.resolve<SignalItem[]>([]),
    queries.producthuntTopic !== null
      ? searchProductHunt({ topic: queries.producthuntTopic })
      : Promise.resolve<SignalItem[]>([]),
    searchGitHubInfluencers({ topic: queries.githubTopic }),
  ]);

  const out: SignalItem[] = [];
  for (const run of runs) {
    if (run.status === 'fulfilled') {
      out.push(...run.value);
    } else {
      console.warn(
        '[trending-signals] source fan-out rejected:',
        run.reason instanceof Error ? run.reason.message : String(run.reason)
      );
    }
  }
  return out;
}

/**
 * Main entry point. Returns the final cluster list the cron will
 * persist to `trend_signals`.
 */
export async function runTrendingSignalsAgent(
  input: TrendingSignalsInput
): Promise<TrendingSignalCluster[]> {
  const queries = resolveCategoryQueries(
    input.category,
    input.seedKeywords ?? []
  );
  const rawSignals = await collectRawSignals(queries);

  if (rawSignals.length === 0) {
    console.warn(
      `[trending-signals] no raw signals returned for category "${input.category}" — skipping agent call`
    );
    return [];
  }

  // Use a sentinel rather than a nullable union so TypeScript does
  // not give up narrowing after the async `runAgent` call returns —
  // closure mutations confuse control-flow analysis on `let x: T |
  // null = null`. A plain array starts empty and we assert
  // non-empty after the agent finishes.
  let capturedClusters: AgentCluster[] = [];
  let capturedReceived = false;

  const tools = [
    tool(
      'collect_raw_signals',
      'Fan out across every free trending-signal source (X via Grok, Hacker News, dev.to, Reddit, Product Hunt, GitHub) and return a flat list of normalized SignalItem rows. Call this once at the start of every run with no arguments.',
      {},
      () =>
        Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  queries,
                  totalSignals: rawSignals.length,
                  signals: rawSignals.map((s, i) => ({
                    index: i,
                    source: s.source,
                    topic: s.topic,
                    headline: s.headline,
                    url: s.url,
                    author: s.author,
                    engagement: s.engagement,
                    publishedAt: s.publishedAt,
                  })),
                },
                null,
                2
              ),
            },
          ],
        })
    ),
    tool(
      'trends_complete',
      'Submit the final clustered trend list. Call this once when your analysis is complete. After this call the agent ends immediately.',
      TRENDS_COMPLETE_INPUT_SCHEMA,
      (args) => {
        capturedClusters = args.clusters;
        capturedReceived = true;
        return Promise.resolve({
          content: [
            {
              type: 'text' as const,
              text: 'Trends recorded. End your turn now.',
            },
          ],
        });
      }
    ),
  ];

  // Exa is optional — the agent should tolerate its absence. We
  // whitelist a single Exa tool so the model cannot accidentally
  // call deep-researcher (which would blow the budget on a single
  // ingest pass).
  const exaConfig = createExaMcpServerConfig();
  const externalMcpServers = exaConfig ? { exa: exaConfig } : undefined;
  const allowedExternalMcpTools = exaConfig
    ? [EXA_MCP_TOOL_NAMES.webSearch]
    : [];

  const userPrompt = `Category: ${input.category}\nSeed keywords: ${(input.seedKeywords ?? []).join(', ') || '(none)'}\n\nCall collect_raw_signals first. Then cluster the signals into 3–5 trends and call trends_complete with the result.`;

  await runAgent({
    systemPrompt: SYSTEM_PROMPT,
    prompt: userPrompt,
    tools: tools as unknown as Parameters<typeof runAgent>[0]['tools'],
    ...(externalMcpServers ? { externalMcpServers } : {}),
    allowedExternalMcpTools,
    // Keep WebSearch available as a fallback when Exa is unavailable
    // but disable WebFetch — the agent should stay inside structured
    // search and not go crawl random pages on its own.
    builtInTools: ['WebSearch'],
    maxTurns: 12,
    effort: 'high',
    ...(input.projectId ? { projectId: input.projectId } : {}),
    phase: 'researching',
    parseResult: () => {
      if (!capturedReceived) {
        throw new Error(
          'Trending-signals agent finished without calling trends_complete'
        );
      }
      return capturedClusters;
    },
  });

  if (!capturedReceived) {
    throw new Error(
      'Trending-signals agent finished without capturing a result'
    );
  }

  // Post-process: hydrate each cluster with the raw SignalItem rows
  // it references by index. This decouples the model's schema (which
  // only sees numeric indexes, keeping the context short) from the
  // persisted shape (which carries the full raw payload).
  const clusters: TrendingSignalCluster[] = capturedClusters.map(
    (cluster) => {
      const supporting = cluster.supportingSignalIndexes
        .map((i) => rawSignals[i])
        .filter((s): s is SignalItem => s !== undefined);
      return {
        topic: cluster.topic,
        headline: cluster.headline,
        url: cluster.representativeUrl,
        source: cluster.representativeSource,
        velocityScore: cluster.velocityScore,
        rawSignals: supporting,
      };
    }
  );

  // Drop clusters whose supporting signals span fewer than 2 distinct
  // sources, even if the model insisted on including them. Defensive:
  // the schema already requires ≥2 indexes, but two signals from the
  // same source do not make a trend.
  return clusters.filter((cluster) => {
    const distinctSources = new Set(cluster.rawSignals.map((s) => s.source));
    return distinctSources.size >= 2;
  });
}
