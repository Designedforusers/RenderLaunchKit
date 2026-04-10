/**
 * Parse a GitHub repo URL into owner and name.
 * Supports: https://github.com/owner/repo, github.com/owner/repo, owner/repo
 */
export function parseRepoUrl(url: string): { owner: string; name: string } | null {
  // Strip trailing slashes and .git
  const cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');

  // Try full URL pattern
  const urlMatch = /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/.exec(cleaned);
  if (urlMatch?.[1] && urlMatch[2]) {
    return { owner: urlMatch[1], name: urlMatch[2] };
  }

  // Try owner/repo pattern
  const shortMatch = /^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/.exec(cleaned);
  if (shortMatch?.[1] && shortMatch[2]) {
    return { owner: shortMatch[1], name: shortMatch[2] };
  }

  return null;
}

/**
 * Build the canonical GitHub URL for a repo.
 */
export function buildRepoUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}`;
}

/**
 * Group an array by a key function.
 */
export function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const key = fn(item);
    acc[key] ??= [];
    acc[key].push(item);
    return acc;
  }, {});
}

/**
 * Compute the mean of an array of numbers.
 */
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Truncate text to a max length, adding ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError = new Error('retry: no attempts made');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelay * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Format a duration in ms to a human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Sanitize text for safe display (strip potential XSS vectors).
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Parse a Redis URL into the connection object shape BullMQ expects.
 *
 * Browser-safe: uses the platform `URL` constructor, no Node imports.
 */
export function parseRedisUrl(redisUrl: string): {
  host: string;
  port: number;
  password: string | undefined;
} {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

// `simpleHash` (a 32-bit djb2 variant) was previously exported here for
// Redis cache keys. It was removed because the ~4 billion-key space allowed
// collisions across cached GitHub API responses, which could serve the wrong
// repo's data from cache. Server-side callers now use a SHA-256 helper that
// lives next to the consumer (e.g. apps/worker/src/tools/github-repository-tools.ts).
//
// `node:crypto` is intentionally not imported in this package because the
// dashboard bundle imports from @launchkit/shared and must remain
// browser-buildable.
