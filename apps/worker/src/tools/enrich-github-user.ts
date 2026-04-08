import { z } from 'zod';
import { env } from '../env.js';
import {
  readEnrichmentCache,
  rehydrateEnrichmentCache,
  writeEnrichmentCache,
  type InfluencerProfile,
} from './influencer-enrichment-types.js';

/**
 * GitHub user enrichment via the public REST `GET /users/{login}`
 * endpoint.
 *
 * Phase 3's `search-github-influencers` tool surfaces repo owners as
 * trending-signal authors. This tool takes one of those logins and
 * returns a `InfluencerProfile` the discovery agent can rank: follower
 * count, bio, public repo count, plus the `html_url` so the dashboard
 * can link back to the GitHub profile via the raw payload.
 *
 * Soft-fail contract: every non-happy path returns `null`. 404 means
 * "user renamed or deleted," network error / timeout / schema mismatch
 * all return `null` so the discovery loop's `Promise.all` fan-out is
 * not broken by a single bad handle.
 */

const GITHUB_USER_ENDPOINT = 'https://api.github.com/users';
const REQUEST_TIMEOUT_MS = 15_000;

const GitHubUserResponseSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  followers: z.number().int().nonnegative(),
  public_repos: z.number().int().nonnegative(),
  location: z.string().nullable(),
  blog: z.string().nullable(),
  html_url: z.string(),
});

export interface EnrichGitHubUserInput {
  /** GitHub login (username). No leading `@`, no URL. */
  handle: string;
}

export async function enrichGitHubUser(
  input: EnrichGitHubUserInput
): Promise<InfluencerProfile | null> {
  const handle = input.handle.trim();
  if (handle.length === 0) return null;

  const cached = await readEnrichmentCache('github_user', handle);
  if (cached !== null) {
    const rehydrated = rehydrateEnrichmentCache(cached, 'github_user');
    if (rehydrated) return rehydrated;
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'LaunchKit/1.0',
  };
  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${env.GITHUB_TOKEN}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${GITHUB_USER_ENDPOINT}/${encodeURIComponent(handle)}`,
      {
        headers,
        signal: controller.signal,
      }
    );
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[enrichGitHubUser] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
  clearTimeout(timer);

  if (!response.ok) {
    console.warn(
      `[enrichGitHubUser] ${String(response.status)} ${response.statusText}`
    );
    return null;
  }

  const rawJson: unknown = await response.json().catch(() => null);
  const parsed = GitHubUserResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn('[enrichGitHubUser] response did not match expected shape');
    return null;
  }

  const profile: InfluencerProfile = {
    source: 'github_user',
    handle: parsed.data.login,
    displayName: parsed.data.name,
    bio: parsed.data.bio,
    followers: parsed.data.followers,
    additionalMetrics: {
      publicRepos: parsed.data.public_repos,
    },
  };

  await writeEnrichmentCache('github_user', handle, profile);
  return profile;
}
