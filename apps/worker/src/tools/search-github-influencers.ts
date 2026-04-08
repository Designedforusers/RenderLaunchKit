import { z } from 'zod';
import { env } from '../env.js';
import {
  readSignalCache,
  rehydrateSignalCache,
  writeSignalCache,
  type SignalItem,
} from './trending-signal-types.js';

/**
 * GitHub trending signals via the public REST search endpoint.
 *
 * The tool name "influencers" is aspirational — in Phase 5 the
 * influencer-discovery agent will enrich these hits with follower
 * counts and bios. In Phase 3 we only need the weak signal of
 * "which repositories are trending under this GitHub topic right
 * now?" — the highest-star new repos under a topic are an
 * excellent proxy for where mindshare is moving in the category.
 *
 * We call `GET /search/repositories?q=topic:<topic>+created:>N` so
 * the search scope is "new repos in this topic" rather than "all
 * repos in this topic, forever." Sorted by stars descending so the
 * top `limit` results are the highest-stars repos created in the
 * last `lookbackDays` window.
 *
 * The repo owner's handle becomes the `SignalItem.author` so the
 * Phase 5 influencer discovery agent can pick this signal back up
 * and enrich the user record.
 */

const GITHUB_SEARCH_ENDPOINT = 'https://api.github.com/search/repositories';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 15;
const DEFAULT_LOOKBACK_DAYS = 30;

const GitHubRepoHitSchema = z.object({
  id: z.number().int(),
  full_name: z.string(),
  html_url: z.string(),
  description: z.string().nullable(),
  stargazers_count: z.number().int(),
  watchers_count: z.number().int(),
  forks_count: z.number().int(),
  open_issues_count: z.number().int().optional(),
  created_at: z.string(),
  pushed_at: z.string().nullable(),
  topics: z.array(z.string()).optional(),
  language: z.string().nullable(),
  owner: z.object({
    login: z.string(),
    html_url: z.string(),
    type: z.string(),
  }),
});

const GitHubSearchResponseSchema = z.object({
  total_count: z.number().int(),
  incomplete_results: z.boolean(),
  items: z.array(GitHubRepoHitSchema),
});

export interface GitHubInfluencerSearchInput {
  /**
   * GitHub topic slug (e.g. `react`, `rust`, `typescript`). Matches
   * the `topic:` qualifier on GitHub search.
   */
  topic: string;
  /** Max repos to return. Default 15, max 30. */
  limit?: number;
  /**
   * Only surface repos created in the last N days. Defaults to 30 so
   * the signal stays "what's new and trending," not "the evergreen
   * top 10 of this topic."
   */
  lookbackDays?: number;
}

export async function searchGitHubInfluencers(
  input: GitHubInfluencerSearchInput
): Promise<SignalItem[]> {
  const topic = input.topic.trim();
  if (topic.length === 0) return [];

  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), 30);
  const lookbackDays = Math.max(1, input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);

  const createdAfter = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD for GitHub's `created:>` qualifier

  const cacheFingerprint = `${topic}|${String(limit)}|${createdAfter}`;
  const cached = await readSignalCache('github', cacheFingerprint);
  if (cached !== null) {
    const rehydrated = rehydrateSignalCache(cached, 'github');
    if (rehydrated.length > 0) return rehydrated;
  }

  const url = new URL(GITHUB_SEARCH_ENDPOINT);
  url.searchParams.set(
    'q',
    `topic:${topic} created:>${createdAfter}`
  );
  url.searchParams.set('sort', 'stars');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(limit));

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'LaunchKit/1.0',
  };
  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${env.GITHUB_TOKEN}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[searchGitHubInfluencers] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
  clearTimeout(timer);

  if (!response.ok) {
    console.warn(
      `[searchGitHubInfluencers] ${String(response.status)} ${response.statusText}`
    );
    return [];
  }

  const rawJson: unknown = await response.json().catch(() => null);
  const parsed = GitHubSearchResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn(
      '[searchGitHubInfluencers] response did not match expected shape'
    );
    return [];
  }

  const signals: SignalItem[] = parsed.data.items.map((repo) => ({
    source: 'github' as const,
    topic,
    headline: `${repo.full_name} — ${repo.description ?? '(no description)'}`,
    url: repo.html_url,
    author: repo.owner.login,
    engagement: {
      upvotes: repo.stargazers_count,
      reactions: repo.forks_count,
      comments: repo.open_issues_count ?? 0,
    },
    publishedAt: repo.created_at,
    rawPayload: repo,
  }));

  await writeSignalCache('github', cacheFingerprint, signals);
  return signals;
}
