import Redis from 'ioredis';
import {
  GITHUB_API_BASE,
  GITHUB_RAW_BASE,
  REDIS_CHANNELS,
  retry,
  simpleHash,
  truncate,
} from '@launchkit/shared';

const headers: Record<string, string> = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'LaunchKit/1.0',
};

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
  : null;

const DEFAULT_CACHE_TTL_SECONDS = parseInt(
  process.env.GITHUB_CACHE_TTL_SECONDS || '900',
  10
);

// Add auth token if available (increases rate limits)
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
}

function cacheKey(kind: string, input: string): string {
  return REDIS_CHANNELS.GITHUB_CACHE(`${kind}:${simpleHash(input)}`);
}

async function readCache<T>(key: string): Promise<T | null> {
  if (!redis) return null;

  try {
    const cached = await redis.get(key);
    return cached ? (JSON.parse(cached) as T) : null;
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

async function githubFetch(
  path: string,
  options?: { cacheTtlSeconds?: number }
): Promise<any> {
  const url = `${GITHUB_API_BASE}${path}`;
  const cacheTtlSeconds = options?.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  const key = cacheKey('api', url);

  const cached = await readCache<any>(key);
  if (cached) {
    return cached;
  }

  const response = await retry(async () => {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  });

  await writeCache(key, response, cacheTtlSeconds);
  return response;
}

async function githubRawJsonFetch(
  url: string,
  options?: { cacheTtlSeconds?: number }
): Promise<Record<string, any> | null> {
  const cacheTtlSeconds = options?.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  const key = cacheKey('raw', url);

  const cached = await readCache<Record<string, any>>(key);
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'LaunchKit/1.0',
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    });
    if (!res.ok) return null;

    const json = (await res.json()) as Record<string, any>;
    await writeCache(key, json, cacheTtlSeconds);
    return json;
  } catch {
    return null;
  }
}

/**
 * Fetch repo metadata.
 */
export async function getRepo(owner: string, name: string) {
  return githubFetch(`/repos/${owner}/${name}`);
}

/**
 * Fetch repo README content.
 */
export async function getReadme(owner: string, name: string): Promise<string> {
  try {
    const data = await githubFetch(`/repos/${owner}/${name}/readme`);
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
    const data = await githubFetch(`/repos/${owner}/${name}/git/trees/HEAD?recursive=1`);
    const files = (data.tree || [])
      .filter((item: any) => item.type === 'blob')
      .map((item: any) => item.path)
      .slice(0, 200);
    return files;
  } catch {
    return [];
  }
}

/**
 * Fetch package.json to understand dependencies.
 */
export async function getPackageJson(owner: string, name: string): Promise<Record<string, any> | null> {
  const url = `${GITHUB_RAW_BASE}/${owner}/${name}/HEAD/package.json`;
  return githubRawJsonFetch(url, { cacheTtlSeconds: 3600 });
}

/**
 * Fetch recent commits.
 */
export async function getRecentCommits(owner: string, name: string, count: number = 10) {
  try {
    const commits = await githubFetch(`/repos/${owner}/${name}/commits?per_page=${count}`, {
      cacheTtlSeconds: 120,
    });
    return commits.map((c: any) => ({
      sha: c.sha,
      message: truncate(c.commit.message.split('\n')[0], 100),
      date: c.commit.author.date,
      author: c.commit.author.name,
    }));
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
      { cacheTtlSeconds: 1800 }
    );
    return (data.items || []).map((repo: any) => ({
      fullName: repo.full_name,
      description: truncate(repo.description || '', 200),
      stars: repo.stargazers_count,
      language: repo.language,
      url: repo.html_url,
      topics: repo.topics || [],
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
    return await githubFetch(`/repos/${owner}/${name}/languages`);
  } catch {
    return {};
  }
}

/**
 * Get repo topics.
 */
export async function getTopics(owner: string, name: string): Promise<string[]> {
  try {
    const data = await githubFetch(`/repos/${owner}/${name}/topics`);
    return data.names || [];
  } catch {
    return [];
  }
}
