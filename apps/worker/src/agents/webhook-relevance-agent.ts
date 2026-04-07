import { generateJSON } from '../lib/anthropic-claude-client.js';
import { WebhookFilterDecisionSchema } from '@launchkit/shared';
import type {
  AssetType,
  RepoAnalysis,
  StrategyBrief,
  WebhookFilterDecision,
} from '@launchkit/shared';

interface WebhookFilterInput {
  eventType: string;
  commitMessage: string;
  commitSha?: string | null;
  repoAnalysis: RepoAnalysis;
  strategy: StrategyBrief;
  availableAssets: AssetType[];
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
- For release events, it is acceptable to regenerate the full available set.`;

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

function fallbackDecision(input: WebhookFilterInput): WebhookFilterDecision {
  const normalized = input.commitMessage.toLowerCase();

  if (input.eventType === 'release') {
    return {
      isMarketable: true,
      reasoning: 'Release events are marketing-worthy by default and should refresh the launch pack.',
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
    return {
      isMarketable: false,
      reasoning: 'The change appears internal or editorial rather than something users would notice.',
      assetTypes: [],
    };
  }

  return {
    isMarketable: true,
    reasoning: 'The change looks user-visible enough to warrant refreshed launch assets.',
    assetTypes: selectAssetTypes(
      input.availableAssets,
      input.commitMessage,
      input.eventType
    ),
  };
}

export async function evaluateWebhookEvent(
  input: WebhookFilterInput
): Promise<WebhookFilterDecision> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fallbackDecision(input);
  }

  try {
    const decision = await generateJSON(
      WebhookFilterDecisionSchema,
      SYSTEM_PROMPT,
      `Decide whether this event should trigger content regeneration.

## Event
- Type: ${input.eventType}
- Commit SHA: ${input.commitSha || 'unknown'}
- Commit message: ${input.commitMessage}

## Product
${JSON.stringify(input.repoAnalysis, null, 2)}

## Current strategy
${JSON.stringify(input.strategy, null, 2)}

## Available assets
${input.availableAssets.join(', ')}`,
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
