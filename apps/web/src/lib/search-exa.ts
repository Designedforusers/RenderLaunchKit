import { z } from 'zod';
import { env } from '../env.js';

/**
 * Exa REST search helper.
 *
 * Calls the Exa search API directly (not via MCP) for the
 * `/api/trends/search` endpoint. Returns web search results with
 * titles, URLs, snippets, and publish dates.
 *
 * Uses `EXA_API_KEY` from the web service's typed env module.
 * When the key is absent, returns an empty array — the search
 * endpoint treats each provider as best-effort.
 */

// ── Zod schema for the upstream response ─────────────────────────

const ExaResultSchema = z.object({
  title: z.string().nullable().default(null),
  url: z.string(),
  text: z.string().nullable().optional(),
  publishedDate: z.string().nullable().optional(),
  score: z.number().optional(),
});

const ExaSearchResponseSchema = z.object({
  results: z.array(ExaResultSchema),
});

// ── Public return type ───────────────────────────────���───────────

export interface ExaSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate: string | null;
  score: number;
}

const REQUEST_TIMEOUT_MS = 8_000;

// ── Main search function ─────────────────────────────────────────

export async function searchExa(
  query: string,
  numResults = 10
): Promise<ExaSearchResult[]> {
  const apiKey = env.EXA_API_KEY;
  if (!apiKey) {
    console.warn('[Exa] EXA_API_KEY not set — skipping Exa search');
    return [];
  }
  if (query.trim().length === 0) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        type: 'auto',
        numResults,
        contents: {
          text: { maxCharacters: 300 },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      console.warn(
        `[Exa] Search failed: HTTP ${String(response.status)}`
      );
      return [];
    }

    const json: unknown = await response.json();
    const parsed = ExaSearchResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn('[Exa] Response schema mismatch:', parsed.error.message);
      return [];
    }

    return parsed.data.results
      .filter((r) => r.title !== null)
      .map((r) => ({
        title: r.title ?? query,
        url: r.url,
        snippet: r.text ?? '',
        publishedDate: r.publishedDate ?? null,
        score: r.score ?? 0,
      }));
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('[Exa] Search timed out');
    } else {
      console.warn('[Exa] Search error:', err);
    }
    return [];
  }
}
