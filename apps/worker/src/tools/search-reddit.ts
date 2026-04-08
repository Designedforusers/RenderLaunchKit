import { z } from 'zod';
import {
  readSignalCache,
  rehydrateSignalCache,
  writeSignalCache,
  type SignalItem,
} from './trending-signal-types.js';

/**
 * Reddit trending signals via the public listing JSON endpoint.
 *
 * `https://www.reddit.com/r/<sub>/top.json?t=week` returns the top
 * posts in a subreddit over a time window. Reddit requires a unique,
 * descriptive User-Agent; without one the API returns `429 Too Many
 * Requests` regardless of actual traffic volume.
 *
 * As of late 2024 Reddit has tightened its free API: some listings
 * now require OAuth. The `/r/<name>/top.json` path still works for
 * read-only access when the User-Agent is set correctly, but a 403
 * on a particular subreddit is not an error worth failing the run
 * for — we log and return `[]`.
 */

const REDDIT_USER_AGENT =
  'web:com.launchkit.trending-signals:v1 (+https://launchkit.dev)';
const REDDIT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW: RedditTimeWindow = 'week';

type RedditTimeWindow = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

const RedditChildDataSchema = z.object({
  id: z.string(),
  title: z.string(),
  selftext: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  permalink: z.string(),
  author: z.string().nullable(),
  subreddit: z.string(),
  ups: z.number().int(),
  num_comments: z.number().int(),
  created_utc: z.number(),
  over_18: z.boolean().optional(),
});

const RedditListingSchema = z.object({
  data: z.object({
    children: z.array(
      z.object({
        kind: z.string(),
        data: RedditChildDataSchema,
      })
    ),
  }),
});

export interface RedditSearchInput {
  /**
   * Subreddit name without the `r/` prefix (e.g. `programming`,
   * `rust`, `webdev`).
   */
  subreddit: string;
  /** Time window for the top listing. Default `week`. */
  timeWindow?: RedditTimeWindow;
  /** Max posts to return. Default 20, max 100. */
  limit?: number;
}

export async function searchReddit(
  input: RedditSearchInput
): Promise<SignalItem[]> {
  const subreddit = input.subreddit.trim().replace(/^r\//i, '');
  if (subreddit.length === 0 || !/^[\w-]+$/.test(subreddit)) return [];

  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), 100);
  const timeWindow = input.timeWindow ?? DEFAULT_WINDOW;

  const cacheFingerprint = `${subreddit}|${timeWindow}|${String(limit)}`;
  const cached = await readSignalCache('reddit', cacheFingerprint);
  if (cached !== null) {
    const rehydrated = rehydrateSignalCache(cached, 'reddit');
    if (rehydrated.length > 0) return rehydrated;
  }

  const url = new URL(
    `https://www.reddit.com/r/${subreddit}/top.json`
  );
  url.searchParams.set('t', timeWindow);
  url.searchParams.set('limit', String(limit));

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    REDDIT_REQUEST_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        'User-Agent': REDDIT_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[searchReddit] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
  clearTimeout(timer);

  if (!response.ok) {
    console.warn(
      `[searchReddit] ${String(response.status)} ${response.statusText} for r/${subreddit}`
    );
    return [];
  }

  const rawJson: unknown = await response.json().catch(() => null);
  const parsed = RedditListingSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn('[searchReddit] response did not match expected shape');
    return [];
  }

  const signals: SignalItem[] = parsed.data.data.children
    .filter((child) => child.data.over_18 !== true)
    .map((child) => {
      const post = child.data;
      const externalUrl =
        post.url && post.url.length > 0
          ? post.url
          : `https://www.reddit.com${post.permalink}`;
      return {
        source: 'reddit' as const,
        topic: subreddit,
        headline: post.title,
        url: externalUrl,
        author: post.author,
        engagement: {
          upvotes: post.ups,
          comments: post.num_comments,
        },
        publishedAt: new Date(post.created_utc * 1000).toISOString(),
        rawPayload: post,
      };
    });

  await writeSignalCache('reddit', cacheFingerprint, signals);
  return signals;
}
