import { truncate } from '@launchkit/shared';

const WEB_SEARCH_PROVIDER = (process.env.WEB_SEARCH_PROVIDER || 'duckduckgo').toLowerCase();

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host === '169.254.169.254'
  );
}

function validateFetchUrl(input: string): URL {
  const url = new URL(input);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed');
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error('Refusing to fetch local or private network URLs');
  }

  return url;
}

/**
 * Search the web for information.
 * Uses a simple fetch-based approach to search via DuckDuckGo HTML.
 * In production, you'd use a proper search API (Brave, Serper, etc.)
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  if (WEB_SEARCH_PROVIDER !== 'duckduckgo') {
    return [{
      title: 'Search provider unavailable',
      snippet: `Unsupported WEB_SEARCH_PROVIDER "${WEB_SEARCH_PROVIDER}". Set it to "duckduckgo".`,
      url: '',
    }];
  }

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LaunchKit/1.0)',
      },
    });

    if (!response.ok) {
      return [{ title: 'Search unavailable', snippet: `Could not search for: ${query}`, url: '' }];
    }

    const html = await response.text();

    // Extract results from DuckDuckGo HTML
    const results: SearchResult[] = [];
    const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      results.push({
        url: decodeURIComponent(match[1].replace(/.*uddg=/, '').split('&')[0]),
        title: match[2].trim(),
        snippet: match[3].replace(/<[^>]*>/g, '').trim(),
      });
    }

    if (results.length === 0) {
      return [{
        title: `Results for: ${query}`,
        snippet: 'No detailed results available. Try a more specific search query.',
        url: '',
      }];
    }

    return results;
  } catch (err) {
    return [{
      title: 'Search error',
      snippet: `Failed to search: ${err instanceof Error ? err.message : String(err)}`,
      url: '',
    }];
  }
}

/**
 * Fetch and extract text content from a URL.
 */
export async function fetchUrl(url: string): Promise<string> {
  try {
    const safeUrl = validateFetchUrl(url);
    const response = await fetch(safeUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LaunchKit/1.0)',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return `Failed to fetch: ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = await response.json();
      return truncate(JSON.stringify(json, null, 2), 5000);
    }

    const html = await response.text();

    // Basic HTML to text extraction
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return truncate(text, 5000);
  } catch (err) {
    return `Error fetching URL: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}
