import { generateJSON } from '../lib/anthropic-claude-client.js';
import { WebhookFilterDecisionSchema } from '@launchkit/shared';
import type {
  AssetType,
  RepoAnalysis,
  StrategyBrief,
  WebhookFilterDecision,
} from '@launchkit/shared';
import { env } from '../env.js';

/**
 * Phase 6 — Commit marketability agent.
 *
 * Renamed from `webhook-relevance-agent.ts` and extended with
 * trend-awareness. Decides whether a GitHub commit is substantial
 * enough to regenerate launch content. Same single-call generateJSON
 * shape as the original; the only behavioural change is that the
 * agent now accepts an optional list of relevant trends (the top
 * trending topics in the project's category, computed by the new
 * `trend-matcher.ts` helper) and uses them to bias the decision.
 *
 * A commit that touches a hot trend is MORE marketable than one
 * that does not, even if its scope is small. The system prompt
 * tells the model this explicitly; the rules-based fallback also
 * checks the commit message against trend topic keywords.
 *
 * The schema name `WebhookFilterDecisionSchema` is intentionally
 * preserved because renaming it would cascade through too many
 * call sites for cosmetic improvement. The `WebhookFilter*` names
 * are read by future maintainers as "the marketability filter
 * decision" — accurate enough.
 */

export interface CommitMarketabilityTrend {
  topic: string;
  headline: string;
  velocityScore: number;
}

export interface CommitMarketabilityInput {
  eventType: string;
  commitMessage: string;
  commitSha?: string | null;
  repoAnalysis: RepoAnalysis;
  strategy: StrategyBrief;
  availableAssets: AssetType[];
  // Top 3-5 trends from `trend_signals` for the project's category.
  // The agent uses these to decide whether the commit aligns with what
  // the dev community is currently talking about. Optional so the agent
  // still works when trends are unavailable (fresh deploy with empty
  // trend_signals table, or Voyage misconfigured).
  relevantTrends?: CommitMarketabilityTrend[];
}

const SYSTEM_PROMPT = `You are a product marketing editor deciding whether a GitHub event is substantial enough to regenerate launch content.

Return JSON:
{
  "isMarketable": true,
  "reasoning": "short explanation",
  "assetTypes": ["blog_post", "twitter_thread"]
}

Rules:
- Major releases, new features, meaningful UX changes, new integrations, or notable performance improvements are marketable.
- Tiny chores, typos, docs-only edits, refactors without user-visible changes, CI changes, and dependency bumps alone are not marketable.
- Choose only from the provided available assets.
- Prefer a focused subset when the change is narrow.
- For release events, it is acceptable to regenerate the full available set.

Trend awareness:
- Up to 5 current dev community trends are provided via the user prompt's "Relevant trends" section. A commit that touches one of these trends is MORE marketable, even if its scope is small.
- Reference the trend by topic in your \`reasoning\` when applicable.
- Trends are NOT required. When none are provided, fall back to the strategy + repo context only.`;

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function selectAssetTypes(
  availableAssets: AssetType[],
  message: string,
  eventType: string
): AssetType[] {
  if (eventType === 'release') {
    return availableAssets;
  }

  const normalized = message.toLowerCase();
  const selected: AssetType[] = [];

  const addIfAvailable = (...types: AssetType[]) => {
    for (const type of types) {
      if (availableAssets.includes(type)) {
        selected.push(type);
      }
    }
  };

  addIfAvailable('blog_post', 'twitter_thread', 'changelog_entry');

  if (
    /ui|dashboard|design|landing|image|brand|hero|theme|visual|screenshot/.test(
      normalized
    )
  ) {
    addIfAvailable('og_image', 'social_card');
  }

  if (
    /demo|video|animation|flow|walkthrough|onboarding|tour/.test(normalized)
  ) {
    addIfAvailable('product_video', 'video_storyboard', 'voiceover_script');
  }

  if (/release|launch|announce|show hn|product hunt|pricing/.test(normalized)) {
    addIfAvailable(
      'product_hunt_description',
      'hacker_news_post',
      'linkedin_post',
      'faq'
    );
  }

  return unique(selected.length > 0 ? selected : availableAssets.slice(0, 3));
}

function fallbackDecision(
  input: CommitMarketabilityInput
): WebhookFilterDecision {
  const normalized = input.commitMessage.toLowerCase();

  if (input.eventType === 'release') {
    return {
      isMarketable: true,
      reasoning:
        'Release events are marketing-worthy by default and should refresh the launch pack.',
      assetTypes: input.availableAssets,
    };
  }

  const negativeOnly =
    /(typo|readme|docs|comment|lint|format|chore|ci|test|refactor|bump|deps?)/.test(
      normalized
    ) &&
    !/(feat|feature|add|new|release|launch|perf|performance|ui|ux|integration|api|support)/.test(
      normalized
    );

  if (negativeOnly) {
    // Trend override: a small commit that happens to touch a hot topic
    // is still marketable. We look for any trend whose `topic` appears
    // as a substring of the lowercased commit message.
    if (
      input.relevantTrends !== undefined &&
      input.relevantTrends.length > 0
    ) {
      const matchingTrend = input.relevantTrends.find((trend) =>
        normalized.includes(trend.topic.toLowerCase())
      );
      if (matchingTrend !== undefined) {
        return {
          isMarketable: true,
          reasoning: `Commit touches trending topic "${matchingTrend.topic}" — marking marketable despite the heuristic skip.`,
          assetTypes: selectAssetTypes(
            input.availableAssets,
            input.commitMessage,
            input.eventType
          ),
        };
      }
    }

    return {
      isMarketable: false,
      reasoning:
        'The change appears internal or editorial rather than something users would notice.',
      assetTypes: [],
    };
  }

  return {
    isMarketable: true,
    reasoning:
      'The change looks user-visible enough to warrant refreshed launch assets.',
    assetTypes: selectAssetTypes(
      input.availableAssets,
      input.commitMessage,
      input.eventType
    ),
  };
}

function renderTrendsSection(
  trends: CommitMarketabilityTrend[] | undefined
): string {
  if (trends === undefined || trends.length === 0) {
    return '';
  }

  const lines = trends
    .map(
      (trend) =>
        `- ${trend.topic} (velocity ${trend.velocityScore.toFixed(2)}): ${trend.headline}`
    )
    .join('\n');

  return `\n\n## Relevant trends in the dev community right now\n${lines}`;
}

export async function evaluateCommitMarketability(
  input: CommitMarketabilityInput
): Promise<WebhookFilterDecision> {
  if (!env.ANTHROPIC_API_KEY) {
    return fallbackDecision(input);
  }

  try {
    const decision = await generateJSON(
      WebhookFilterDecisionSchema,
      SYSTEM_PROMPT,
      `Decide whether this event should trigger content regeneration.

## Event
- Type: ${input.eventType}
- Commit SHA: ${input.commitSha ?? 'unknown'}
- Commit message: ${input.commitMessage}

## Product
${JSON.stringify(input.repoAnalysis, null, 2)}

## Current strategy
${JSON.stringify(input.strategy, null, 2)}

## Available assets
${input.availableAssets.join(', ')}${renderTrendsSection(input.relevantTrends)}`,
      { maxTokens: 1200 }
    );

    // The schema guarantees `decision.isMarketable`, `reasoning`, and
    // `assetTypes` are present and well-typed. We still filter the
    // returned asset types against the project's `availableAssets` so
    // a hallucinated-but-schema-valid asset type can't queue a
    // generation job for an asset the project does not have.
    return {
      isMarketable: decision.isMarketable,
      reasoning: decision.reasoning,
      assetTypes: unique(
        decision.assetTypes.filter((type) =>
          input.availableAssets.includes(type)
        )
      ),
    };
  } catch {
    return fallbackDecision(input);
  }
}
