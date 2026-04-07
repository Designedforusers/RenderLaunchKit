import { GITHUB_API_BASE, GITHUB_RAW_BASE, retry, truncate } from '@launchkit/shared';

const headers: Record<string, string> = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'LaunchKit/1.0',
};

// Add auth token if available (increases rate limits)
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
}

async function githubFetch(path: string): Promise<any> {
  const url = `${GITHUB_API_BASE}${path}`;
  const response = await retry(async () => {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  });
  return response;
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
  try {
    const url = `${GITHUB_RAW_BASE}/${owner}/${name}/HEAD/package.json`;
    const res = await fetch(url, { headers: { 'User-Agent': 'LaunchKit/1.0' } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch recent commits.
 */
export async function getRecentCommits(owner: string, name: string, count: number = 10) {
  try {
    const commits = await githubFetch(`/repos/${owner}/${name}/commits?per_page=${count}`);
    return commits.map((c: any) => ({
      sha: c.sha.slice(0, 7),
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
      `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=${limit}`
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
