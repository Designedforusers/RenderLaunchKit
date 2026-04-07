import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import type { z } from 'zod';
import {
  GITHUB_API_BASE,
  GITHUB_RAW_BASE,
  REDIS_CHANNELS,
  retry,
  truncate,
} from '@launchkit/shared';
import {
  GitHubCommitListSchema,
  GitHubLanguagesSchema,
  GitHubReadmeSchema,
  GitHubRepoSchema,
  GitHubSearchResponseSchema,
  GitHubTopicsSchema,
  GitHubTreeSchema,
  PackageJsonSchema,
  type GitHubRepo,
  type PackageJson,
} from '../lib/schemas/github.js';
import { env } from '../env.js';

/**
 * SHA-256 hash truncated to 16 hex chars for Redis cache keys.
 *
 * The previous implementation used a 32-bit djb2 variant that produced
 * collisions across cached GitHub API responses. With ~10^4 collision
 * resistance per 16 hex chars (64 bits) we have a vanishingly small chance
 * of two different repo URLs colliding to the same cache key.
 */
function hashCacheKey(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

const headers: Record<string, string> = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'LaunchKit/1.0',
};

const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
  : null;

const DEFAULT_CACHE_TTL_SECONDS = env.GITHUB_CACHE_TTL_SECONDS;

// Add auth token if available (increases rate limits)
if (env.GITHUB_TOKEN) {
  headers['Authorization'] = `token ${env.GITHUB_TOKEN}`;
}

function cacheKey(kind: string, input: string): string {
  return REDIS_CHANNELS.GITHUB_CACHE(`${kind}:${hashCacheKey(input)}`);
}

async function readCache(key: string): Promise<unknown> {
  if (!redis) return null;

  try {
    const cached = await redis.get(key);
    return cached ? (JSON.parse(cached) as unknown) : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!redis || ttlSeconds <= 0) return;

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Cache failures should never fail the request.
  }
}

/**
 * Fetch a GitHub REST endpoint, validate the response with the
 * supplied Zod schema, and cache the parsed result. Throws on:
 *
 *   - Network or HTTP errors (after `retry()` exhausts attempts)
 *   - Schema validation failures (the GitHub response shape changed
 *     in a way our schema does not allow)
 *
 * The schema does the heavy lifting: callers get a typed value back
 * and never see `unknown`. Cached values are also re-validated on
 * read so a stale cache entry from a previous schema version cannot
 * silently produce the wrong type — the cache returns `null`, the
 * fetch retries fresh, and the new value is validated and stored.
 */
async function githubFetch<S extends z.ZodType>(
  path: string,
  schema: S,
  options?: { cacheTtlSeconds?: number }
): Promise<z.infer<S>> {
  const url = `${GITHUB_API_BASE}${path}`;
  const cacheTtlSeconds = options?.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  const key = cacheKey('api', url);

  const cached = await readCache(key);
  if (cached !== null) {
    const parsedCached = schema.safeParse(cached);
    if (parsedCached.success) {
      return parsedCached.data;
    }
    // Stale cache from a previous schema version — fall through and
    // re-fetch.
  }

  const response: unknown = await retry(async () => {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  });

  const parsed = schema.parse(response);
  await writeCache(key, parsed, cacheTtlSeconds);
  return parsed;
}

/**
 * Fetch a raw JSON file from raw.githubusercontent.com (used for
 * package.json). Same caching + schema validation discipline as
 * `githubFetch`. Returns `null` instead of throwing on network or
 * parse failure because callers treat a missing/invalid package.json
 * as "no dependency info available", not as an error.
 */
async function githubRawJsonFetch<S extends z.ZodType>(
  url: string,
  schema: S,
  options?: { cacheTtlSeconds?: number }
): Promise<z.infer<S> | null> {
  const cacheTtlSeconds = options?.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  const key = cacheKey('raw', url);

  const cached = await readCache(key);
  if (cached !== null) {
    const parsedCached = schema.safeParse(cached);
    if (parsedCached.success) {
      return parsedCached.data;
    }
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'LaunchKit/1.0',
        ...(env.GITHUB_TOKEN
          ? { Authorization: `token ${env.GITHUB_TOKEN}` }
          : {}),
      },
    });
    if (!res.ok) return null;

    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) return null;

    await writeCache(key, parsed.data, cacheTtlSeconds);
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Fetch repo metadata.
 */
export async function getRepo(owner: string, name: string): Promise<GitHubRepo> {
  return githubFetch(`/repos/${owner}/${name}`, GitHubRepoSchema);
}

/**
 * Fetch repo README content.
 */
export async function getReadme(owner: string, name: string): Promise<string> {
  try {
    const data = await githubFetch(`/repos/${owner}/${name}/readme`, GitHubReadmeSchema);
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return truncate(content, 10_000);
  } catch {
    return '(No README found)';
  }
}

/**
 * Fetch repo file tree (top-level + key directories).
 */
export async function getFileTree(owner: string, name: string): Promise<string[]> {
  try {
    const data = await githubFetch(
      `/repos/${owner}/${name}/git/trees/HEAD?recursive=1`,
      GitHubTreeSchema
    );
    return (data.tree ?? [])
      .filter((item) => item.type === 'blob')
      .map((item) => item.path)
      .slice(0, 200);
  } catch {
    return [];
  }
}

/**
 * Fetch package.json to understand dependencies.
 */
export async function getPackageJson(owner: string, name: string): Promise<PackageJson | null> {
  const url = `${GITHUB_RAW_BASE}/${owner}/${name}/HEAD/package.json`;
  return githubRawJsonFetch(url, PackageJsonSchema, { cacheTtlSeconds: 3600 });
}

/**
 * Fetch recent commits.
 */
export async function getRecentCommits(owner: string, name: string, count: number = 10) {
  try {
    const commits = await githubFetch(
      `/repos/${owner}/${name}/commits?per_page=${count}`,
      GitHubCommitListSchema,
      { cacheTtlSeconds: 120 }
    );
    return commits.map((c) => {
      const firstLine = c.commit.message.split('\n')[0] ?? '';
      return {
        sha: c.sha,
        message: truncate(firstLine, 100),
        date: c.commit.author.date,
        author: c.commit.author.name,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Search GitHub repos by query.
 */
export async function searchRepos(query: string, limit: number = 5) {
  try {
    const data = await githubFetch(
      `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=${limit}`,
      GitHubSearchResponseSchema,
      { cacheTtlSeconds: 1800 }
    );
    return (data.items ?? []).map((repo) => ({
      fullName: repo.full_name,
      description: truncate(repo.description ?? '', 200),
      stars: repo.stargazers_count ?? 0,
      language: repo.language ?? null,
      url: repo.html_url,
      topics: repo.topics ?? [],
    }));
  } catch {
    return [];
  }
}

/**
 * Get repo languages breakdown.
 */
export async function getLanguages(owner: string, name: string): Promise<Record<string, number>> {
  try {
    return await githubFetch(`/repos/${owner}/${name}/languages`, GitHubLanguagesSchema);
  } catch {
    return {};
  }
}

/**
 * Get repo topics.
 */
export async function getTopics(owner: string, name: string): Promise<string[]> {
  try {
    const data = await githubFetch(`/repos/${owner}/${name}/topics`, GitHubTopicsSchema);
    return data.names ?? [];
  } catch {
    return [];
  }
}
