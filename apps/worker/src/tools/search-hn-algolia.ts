import { z } from 'zod';
import {
  readSignalCache,
  rehydrateSignalCache,
  writeSignalCache,
  type SignalItem,
} from './trending-signal-types.js';

/**
 * Hacker News trending signals via the Algolia HN Search API.
 *
 * No API key required. The endpoint returns the highest-ranked story
 * matching the query, sorted by "points" (the default) or "date".
 * For trending-signal ingestion we bias toward recent posts with high
 * engagement, so we query `search_by_date` with a numericFilter on
 * `created_at_i` (unix seconds) to get the last 72 hours of activity.
 *
 * Documentation: https://hn.algolia.com/api
 *
 * Failure contract matches the other source tools: returns `[]` on
 * network, parse, or shape errors so a flaky upstream never takes
 * down the agent run.
 */

const HN_ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date';
const HN_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_LOOKBACK_HOURS = 72;
const DEFAULT_HITS_PER_PAGE = 20;

const HnHitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  author: z.string().nullable(),
  points: z.number().int().nullable(),
  num_comments: z.number().int().nullable(),
  created_at_i: z.number().int(),
  story_text: z.string().nullable().optional(),
});

const HnResponseSchema = z.object({
  hits: z.array(HnHitSchema),
  nbHits: z.number().int(),
});

export interface HnAlgoliaSearchInput {
  /** Query string passed to Algolia. Supports plain keywords. */
  query: string;
  /**
   * Look-back window in hours. Defaults to 72; Grok and the other
   * sources use the same window so the agent sees a consistent
   * recency cut across every source.
   */
  lookbackHours?: number;
  /** Upper bound on results returned. Defaults to 20, max 50. */
  limit?: number;
}

export async function searchHnAlgolia(
  input: HnAlgoliaSearchInput
): Promise<SignalItem[]> {
  const query = input.query.trim();
  if (query.length === 0) return [];

  const lookbackHours = Math.max(1, input.lookbackHours ?? DEFAULT_LOOKBACK_HOURS);
  const hitsPerPage = Math.min(
    Math.max(1, input.limit ?? DEFAULT_HITS_PER_PAGE),
    50
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const sinceSeconds = nowSeconds - lookbackHours * 3600;

  const cacheFingerprint = `${query}|${String(lookbackHours)}|${String(hitsPerPage)}`;
  const cached = await readSignalCache('hn', cacheFingerprint);
  if (cached !== null) {
    const rehydrated = rehydrateSignalCache(cached, 'hn');
    if (rehydrated.length > 0) return rehydrated;
  }

  const url = new URL(HN_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('tags', 'story');
  url.searchParams.set('hitsPerPage', String(hitsPerPage));
  url.searchParams.set(
    'numericFilters',
    `created_at_i>${String(sinceSeconds)}`
  );

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    HN_REQUEST_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'LaunchKit/1.0' },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[searchHnAlgolia] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
  clearTimeout(timer);

  if (!response.ok) {
    console.warn(
      `[searchHnAlgolia] ${String(response.status)} ${response.statusText}`
    );
    return [];
  }

  const rawJson: unknown = await response.json().catch(() => null);
  const parsed = HnResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn('[searchHnAlgolia] response did not match expected shape');
    return [];
  }

  const signals: SignalItem[] = parsed.data.hits
    .filter((hit) => hit.title !== null)
    .map((hit) => ({
      source: 'hn' as const,
      topic: query,
      headline: hit.title ?? '',
      url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author,
      engagement: {
        points: hit.points ?? 0,
        comments: hit.num_comments ?? 0,
      },
      publishedAt: new Date(hit.created_at_i * 1000).toISOString(),
      rawPayload: hit,
    }));

  await writeSignalCache('hn', cacheFingerprint, signals);
  return signals;
}
