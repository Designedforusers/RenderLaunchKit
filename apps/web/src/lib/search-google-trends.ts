import { z } from 'zod';

/**
 * Google Trends search helper.
 *
 * Wraps the `google-trends-api` npm package (unofficial Google Trends
 * scraper — no API key required) for the `/api/trends/search`
 * endpoint. Returns interest-over-time data and related rising
 * queries for a given keyword.
 *
 * Every upstream response is Zod-parsed at the boundary. Failures
 * return empty results — the search endpoint treats each provider
 * as best-effort so a Google Trends hiccup doesn't break the page.
 */

// ── Zod schemas for the upstream JSON shapes ─────────────────────

const TimelinePointSchema = z.object({
  time: z.string(),
  formattedTime: z.string(),
  value: z.tuple([z.number()]),
});

const InterestOverTimeSchema = z.object({
  default: z.object({
    timelineData: z.array(TimelinePointSchema),
  }),
});

const RankedKeywordSchema = z.object({
  query: z.string(),
  value: z.number(),
});

const RelatedQueriesBlockSchema = z.object({
  rankedList: z.array(
    z.object({
      rankedKeyword: z.array(RankedKeywordSchema),
    })
  ),
});

// ── Public return types ──────────────────────────────────────────

export interface InterestPoint {
  date: string;
  value: number;
}

export interface RelatedQuery {
  query: string;
  value: number;
}

export interface GoogleTrendsResult {
  interestOverTime: InterestPoint[];
  risingQueries: RelatedQuery[];
  topQueries: RelatedQuery[];
}

const EMPTY_RESULT: GoogleTrendsResult = {
  interestOverTime: [],
  risingQueries: [],
  topQueries: [],
};

const REQUEST_TIMEOUT_MS = 8_000;

// ── Main search function ─────────────────────────────────────────

export async function searchGoogleTrends(
  keyword: string,
  geo = 'US'
): Promise<GoogleTrendsResult> {
  if (keyword.trim().length === 0) return EMPTY_RESULT;

  // google-trends-api ships as CJS with `module.exports = { ... }`.
  // The local type declaration in `apps/web/src/google-trends-api.d.ts`
  // uses `export =` so dynamic import surfaces the API on `.default`
  // with its full typed shape — no boundary cast needed. If the
  // package fails to load (missing dep, network hiccup at cold
  // start), return the empty result so the aggregation path in
  // `trends-api-routes.ts` still returns Exa + local signals.
  let googleTrends;
  try {
    const mod = await import('google-trends-api');
    googleTrends = mod.default;
  } catch {
    console.warn('[GoogleTrends] Failed to import google-trends-api');
    return EMPTY_RESULT;
  }

  const [interestRaw, relatedRaw] = await Promise.allSettled([
    // Interest over time — last 12 months
    withTimeout(
      googleTrends.interestOverTime({
        keyword,
        geo,
        startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      }),
      REQUEST_TIMEOUT_MS
    ),
    // Related queries — rising and top
    withTimeout(googleTrends.relatedQueries({ keyword, geo }), REQUEST_TIMEOUT_MS),
  ]);

  const interestOverTime = parseInterestOverTime(interestRaw);
  const { risingQueries, topQueries } = parseRelatedQueries(relatedRaw);

  return { interestOverTime, risingQueries, topQueries };
}

// ── Parsers ──────────────────────────────────────────────────────

function parseInterestOverTime(
  result: PromiseSettledResult<string>
): InterestPoint[] {
  if (result.status === 'rejected') {
    console.warn('[GoogleTrends] interestOverTime failed:', result.reason);
    return [];
  }
  try {
    const raw: unknown = JSON.parse(result.value);
    const parsed = InterestOverTimeSchema.safeParse(raw);
    if (!parsed.success) return [];
    return parsed.data.default.timelineData.map((pt) => ({
      date: pt.formattedTime,
      value: pt.value[0],
    }));
  } catch {
    return [];
  }
}

function parseRelatedQueries(
  result: PromiseSettledResult<string>
): { risingQueries: RelatedQuery[]; topQueries: RelatedQuery[] } {
  const empty = { risingQueries: [], topQueries: [] };
  if (result.status === 'rejected') {
    console.warn('[GoogleTrends] relatedQueries failed:', result.reason);
    return empty;
  }
  try {
    const raw: unknown = JSON.parse(result.value);
    const parsed = RelatedQueriesBlockSchema.safeParse(raw);
    if (!parsed.success) return empty;
    const lists = parsed.data.rankedList;
    const topQueries = lists[0]?.rankedKeyword ?? [];
    const risingQueries = lists[1]?.rankedKeyword ?? [];
    return {
      topQueries: topQueries.slice(0, 10),
      risingQueries: risingQueries.slice(0, 10),
    };
  } catch {
    return empty;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Race a promise against a timeout, clearing the timer when the
 * inner promise settles so Node doesn't hold a stale `setTimeout`
 * open in the event loop until it fires into a settled race. The
 * bare `setTimeout` version leaks spurious `UnhandledPromiseRejection`
 * warnings on Node 18+ when the timeout rejects into an already-
 * resolved race.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timeout after ${String(ms)}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
