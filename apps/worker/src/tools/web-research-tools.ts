import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import { truncate } from '@launchkit/shared';

const WEB_SEARCH_PROVIDER = (process.env.WEB_SEARCH_PROVIDER || 'duckduckgo').toLowerCase();
const FETCH_TIMEOUT_MS = 10_000;

// ── SSRF defense ─────────────────────────────────────────────────────────
//
// The research agent can be steered (intentionally or via prompt injection)
// to fetch arbitrary URLs. We must prevent it from reaching internal networks,
// cloud metadata endpoints, or anything else inside the host's trust boundary.
//
// Strategy:
//
//   1. Reject non-HTTP(S) schemes outright.
//   2. Reject URLs whose host literal is itself a blocked IP or a known
//      metadata hostname (catches the easy cases without DNS).
//   3. Configure undici with a custom DNS lookup that resolves the hostname
//      and rejects the resolved IP if it falls inside any private/loopback/
//      link-local/CGNAT/ULA range. The lookup runs *inside* the connect call,
//      so there is no TOCTOU window between resolution and connection — undici
//      uses the address we hand back, not a fresh lookup.
//   4. Disable HTTP redirects (`maxRedirections: 0`) so a redirect target
//      cannot bypass the lookup.
//
// This still does not protect against a non-recursive DNS rebinding window
// inside `validateFetchUrl`'s pre-flight resolve, but the dispatcher-bound
// lookup makes the actual connection safe even if the pre-flight raced.

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata.azure.net',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + AWS IMDS
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 224 && b >= 0) return false; // multicast — allow but do not special-case
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');

  if (lower === '::' || lower === '::1') return true;

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) — recurse on the v4 portion.
  const mappedV4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedV4 && mappedV4[1]) {
    return isPrivateIPv4(mappedV4[1]);
  }

  // fe80::/10 link-local. The first hextet is fe80..febf.
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;

  // fc00::/7 unique local (fc00..fdff first hextet).
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true;

  return false;
}

function isBlockedAddress(ip: string): boolean {
  return ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

function isLikelyIpLiteral(host: string): boolean {
  // Strip IPv6 brackets if present.
  const stripped = host.replace(/^\[|\]$/g, '');
  return /^\d+\.\d+\.\d+\.\d+$/.test(stripped) || stripped.includes(':');
}

/**
 * Custom DNS lookup that mirrors `dns.lookup`'s callback signature but
 * rejects any resolved address that lives inside a blocked range.
 *
 * Bound to the undici Agent below so the actual TCP connection uses the
 * address we vetted — there is no second lookup the attacker could race.
 */
function safeDnsLookup(
  hostname: string,
  options: unknown,
  callback: (err: Error | null, address: string, family: number) => void
): void {
  // undici sometimes calls with (hostname, callback) — normalise.
  const cb = typeof options === 'function'
    ? (options as typeof callback)
    : callback;

  dnsLookup(hostname).then(
    (resolved) => {
      if (isBlockedAddress(resolved.address)) {
        cb(new Error(`SSRF blocked: ${hostname} resolves to ${resolved.address}`), '', 0);
        return;
      }
      cb(null, resolved.address, resolved.family);
    },
    (err: unknown) => {
      cb(err instanceof Error ? err : new Error(String(err)), '', 0);
    }
  );
}

const safeAgent = new Agent({
  connect: {
    lookup: safeDnsLookup,
  },
  bodyTimeout: FETCH_TIMEOUT_MS,
  headersTimeout: FETCH_TIMEOUT_MS,
});

async function validateFetchUrl(input: string): Promise<URL> {
  const url = new URL(input);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) URLs are allowed');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Refusing to fetch local or metadata hostnames');
  }

  // If the URL embeds an IP literal, check it directly without DNS.
  if (isLikelyIpLiteral(hostname) && isBlockedAddress(hostname)) {
    throw new Error('Refusing to fetch private or loopback IP addresses');
  }

  // For symbolic hostnames, do an early resolve so we can reject the
  // request before opening a socket. The dispatcher does its own
  // (authoritative) check at connect time as the second line of defense.
  if (!isLikelyIpLiteral(hostname)) {
    try {
      const resolved = await dnsLookup(hostname);
      if (isBlockedAddress(resolved.address)) {
        throw new Error(`Refusing to fetch ${hostname}: resolves to ${resolved.address}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Refusing')) {
        throw err;
      }
      throw new Error(`DNS lookup failed for ${hostname}`);
    }
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
    const response = await undiciFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LaunchKit/1.0)',
      },
      dispatcher: safeAgent,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [{ title: 'Search unavailable', snippet: `Could not search for: ${query}`, url: '' }];
    }

    const html = await response.text();

    // Extract results from DuckDuckGo HTML.
    const results: SearchResult[] = [];
    const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      const rawHref = match[1] ?? '';
      const decoded = (() => {
        try {
          return decodeURIComponent(rawHref.replace(/.*uddg=/, '').split('&')[0] ?? '');
        } catch {
          return '';
        }
      })();

      results.push({
        url: decoded,
        title: (match[2] ?? '').trim(),
        snippet: (match[3] ?? '').replace(/<[^>]*>/g, '').trim(),
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
 *
 * Goes through the SSRF-aware undici dispatcher and disables redirects
 * (`maxRedirections: 0`) so a 30x response cannot bounce the request to a
 * blocked address. Callers receive a string error message rather than a
 * thrown exception so the LLM tool loop can recover gracefully.
 */
export async function fetchUrl(url: string): Promise<string> {
  try {
    const safeUrl = await validateFetchUrl(url);
    const response = await undiciFetch(safeUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LaunchKit/1.0)',
      },
      dispatcher: safeAgent,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error',
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
