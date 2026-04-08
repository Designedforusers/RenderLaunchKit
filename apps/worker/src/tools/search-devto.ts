import { z } from 'zod';
import {
  readSignalCache,
  rehydrateSignalCache,
  writeSignalCache,
  type SignalItem,
} from './trending-signal-types.js';

/**
 * dev.to trending signals via the public Articles API.
 *
 * dev.to's REST API is keyless for read operations. The `/api/articles`
 * endpoint supports filtering by tag and sorting by top reactions
 * over a time window — exactly what we want for "top posts in this
 * category in the last week."
 *
 * Documentation: https://developers.forem.com/api/v1#tag/articles
 *
 * Failure contract matches the other source tools — returns `[]` on
 * network or parse errors.
 */

const DEVTO_ENDPOINT = 'https://dev.to/api/articles';
const DEVTO_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 20;
const DEFAULT_TOP_DAYS = 7;

const DevtoArticleSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  canonical_url: z.string().nullable().optional(),
  published_at: z.string(),
  tag_list: z.union([z.array(z.string()), z.string()]),
  positive_reactions_count: z.number().int(),
  comments_count: z.number().int(),
  page_views_count: z.number().int().nullable().optional(),
  user: z.object({
    username: z.string(),
    name: z.string().nullable(),
  }),
});

const DevtoResponseSchema = z.array(DevtoArticleSchema);

export interface DevtoSearchInput {
  /**
   * dev.to tag to query (e.g. `javascript`, `rust`, `webdev`). dev.to
   * uses normalized lowercase tags — the tool does not lowercase for
   * the caller, so pass the canonical tag.
   */
  tag: string;
  /** Max articles to return. Default 20, max 50. */
  limit?: number;
  /**
   * Sort-by-top window in days. dev.to's `top` param accepts a number
   * of days; defaults to 7 (last week).
   */
  topDays?: number;
}

export async function searchDevto(
  input: DevtoSearchInput
): Promise<SignalItem[]> {
  const tag = input.tag.trim();
  if (tag.length === 0) return [];

  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), 50);
  const topDays = Math.max(1, input.topDays ?? DEFAULT_TOP_DAYS);

  const cacheFingerprint = `${tag}|${String(limit)}|${String(topDays)}`;
  const cached = await readSignalCache('devto', cacheFingerprint);
  if (cached !== null) {
    const rehydrated = rehydrateSignalCache(cached, 'devto');
    if (rehydrated.length > 0) return rehydrated;
  }

  const url = new URL(DEVTO_ENDPOINT);
  url.searchParams.set('tag', tag);
  url.searchParams.set('top', String(topDays));
  url.searchParams.set('per_page', String(limit));

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    DEVTO_REQUEST_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'LaunchKit/1.0',
        Accept: 'application/vnd.forem.api-v1+json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[searchDevto] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
  clearTimeout(timer);

  if (!response.ok) {
    console.warn(
      `[searchDevto] ${String(response.status)} ${response.statusText}`
    );
    return [];
  }

  const rawJson: unknown = await response.json().catch(() => null);
  const parsed = DevtoResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn('[searchDevto] response did not match expected shape');
    return [];
  }

  const signals: SignalItem[] = parsed.data.map((article) => ({
    source: 'devto' as const,
    topic: tag,
    headline: article.title,
    url: article.canonical_url ?? article.url,
    author: article.user.name ?? article.user.username,
    engagement: {
      reactions: article.positive_reactions_count,
      comments: article.comments_count,
      views: article.page_views_count ?? undefined,
    },
    publishedAt: article.published_at,
    rawPayload: article,
  }));

  await writeSignalCache('devto', cacheFingerprint, signals);
  return signals;
}
