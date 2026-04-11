import { Hono } from 'hono';
import { desc, gt, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { trendSignals } from '@launchkit/shared';
import { database } from '../lib/database.js';
import { searchGoogleTrends } from '../lib/search-google-trends.js';
import { searchExa } from '../lib/search-exa.js';

/**
 * Trends API routes.
 *
 * Three endpoints:
 *
 * `GET /api/trends` — returns the latest non-expired trending signals
 *   ordered by velocity score (highest first), capped at 50. Used by
 *   the dashboard's "Currently Trending" section.
 *
 * `GET /api/trends/search?q=...` — real-time aggregated search across
 *   Google Trends, Exa, and existing trend signals. Fans out to all
 *   three providers in parallel, normalizes results, and returns a
 *   unified response. Used by the dashboard's search box.
 *
 * `GET /api/trends/discover` — broad trending topics from Exa. Not
 *   dev-centric — covers culture, business, entertainment, consumer
 *   tech. Used by the dashboard's "Trending Across the Web" section.
 */

const trendsApiRoutes = new Hono();

// ── GET /api/trends ──────────────────────────────────────────────
//
// Existing endpoint. Returns DB-stored trend signals.

trendsApiRoutes.get('/', async (c) => {
  const now = new Date();

  const rows = await database
    .select({
      id: trendSignals.id,
      source: trendSignals.source,
      topic: trendSignals.topic,
      headline: trendSignals.headline,
      url: trendSignals.url,
      velocityScore: trendSignals.velocityScore,
      category: trendSignals.category,
      ingestedAt: trendSignals.ingestedAt,
    })
    .from(trendSignals)
    .where(gt(trendSignals.expiresAt, now))
    .orderBy(desc(trendSignals.velocityScore))
    .limit(50);

  const trends = rows.map((row) => ({
    ...row,
    ingestedAt: row.ingestedAt.toISOString(),
  }));

  return c.json({ trends });
});

// ── GET /api/trends/search?q=... ─────────────────────────────────
//
// Aggregated search. Fans out to Google Trends + Exa + DB text
// match in parallel. Each provider is best-effort — a failure in
// one never blocks the others.

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
});

trendsApiRoutes.get('/search', async (c) => {
  const parsed = SearchQuerySchema.safeParse({ q: c.req.query('q') });
  if (!parsed.success) {
    return c.json({ error: 'Missing or invalid `q` parameter' }, 400);
  }
  const query = parsed.data.q.trim();

  // Fan out to all three providers in parallel
  const [googleResult, exaResult, signalsResult] = await Promise.allSettled([
    searchGoogleTrends(query),
    searchExa(`${query} trending 2026`, 8),
    searchExistingSignals(query),
  ]);

  // Build the aggregated response
  const googleTrends =
    googleResult.status === 'fulfilled' ? googleResult.value : null;

  const exaResults =
    exaResult.status === 'fulfilled' ? exaResult.value : [];

  const matchedSignals =
    signalsResult.status === 'fulfilled' ? signalsResult.value : [];

  return c.json({
    query,
    googleTrends: googleTrends
      ? {
          interestOverTime: googleTrends.interestOverTime,
          risingQueries: googleTrends.risingQueries,
          topQueries: googleTrends.topQueries,
        }
      : null,
    exaResults: exaResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      publishedDate: r.publishedDate,
      score: r.score,
    })),
    matchedSignals: matchedSignals.map((row) => ({
      id: row.id,
      source: row.source,
      topic: row.topic,
      headline: row.headline,
      url: row.url,
      velocityScore: row.velocityScore,
      category: row.category,
      ingestedAt: row.ingestedAt.toISOString(),
    })),
  });
});

// ── GET /api/trends/discover ──────────────────────────────────────
//
// Broad trending topics via Exa. Not dev-centric — covers culture,
// business, entertainment, consumer tech, social trends. Three
// parallel Exa searches with different angles, deduplicated by URL.

trendsApiRoutes.get('/discover', async (c) => {
  const queries = [
    'trending topics this week viral popular',
    'biggest news stories trending culture entertainment 2026',
    'consumer trends popular products going viral',
  ];

  const results = await Promise.allSettled(
    queries.map((q) => searchExa(q, 6))
  );

  // Flatten, deduplicate by URL, cap at 12
  const seen = new Set<string>();
  const items: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedDate: string | null;
  }> = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        publishedDate: item.publishedDate,
      });
    }
  }

  return c.json({ items: items.slice(0, 12) });
});

export default trendsApiRoutes;

// ── DB text-match helper ─────────────────────────────────────────
//
// Simple ILIKE search against existing trend_signals. This avoids
// the Voyage embedding dependency (which lives on the worker, not
// the web service). Good enough for keyword-based matches; the
// semantic heavy lifting is done by Exa.

async function searchExistingSignals(query: string) {
  const pattern = `%${query}%`;

  return database
    .select({
      id: trendSignals.id,
      source: trendSignals.source,
      topic: trendSignals.topic,
      headline: trendSignals.headline,
      url: trendSignals.url,
      velocityScore: trendSignals.velocityScore,
      category: trendSignals.category,
      ingestedAt: trendSignals.ingestedAt,
    })
    .from(trendSignals)
    .where(
      or(
        ilike(trendSignals.topic, pattern),
        ilike(trendSignals.headline, pattern)
      )
    )
    .orderBy(desc(trendSignals.velocityScore))
    .limit(8);
}
