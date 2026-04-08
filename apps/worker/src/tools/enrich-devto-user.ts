import { z } from 'zod';
import {
  readEnrichmentCache,
  rehydrateEnrichmentCache,
  writeEnrichmentCache,
  type InfluencerProfile,
} from './influencer-enrichment-types.js';

/**
 * dev.to user enrichment via the public `GET /api/users/by_username`
 * endpoint.
 *
 * dev.to's REST API is keyless for read operations. The `by_username`
 * lookup returns the profile fields the influencer-discovery agent
 * needs (name, summary, join date, post count) without an auth
 * header. dev.to does not expose a follower count on this endpoint,
 * so `followers` is `null` and the ranker falls back to `post_count`
 * via `additionalMetrics.postCount`.
 *
 * Documentation: https://developers.forem.com/api/v1#tag/users
 *
 * Soft-fail contract matches the other enrichment tools — every
 * non-happy path returns `null`.
 */

const DEVTO_ENDPOINT = 'https://dev.to/api/users/by_username';
const REQUEST_TIMEOUT_MS = 15_000;

const DevtoUserResponseSchema = z.object({
  username: z.string(),
  name: z.string().nullable(),
  summary: z.string().nullable(),
  joined_at: z.string(),
  post_count: z.number().int().nonnegative(),
});

export interface EnrichDevtoUserInput {
  /** dev.to username. No leading `@`, no URL. */
  handle: string;
}

export async function enrichDevtoUser(
  input: EnrichDevtoUserInput
): Promise<InfluencerProfile | null> {
  const handle = input.handle.trim();
  if (handle.length === 0) return null;

  const cached = await readEnrichmentCache('devto_user', handle);
  if (cached !== null) {
    const rehydrated = rehydrateEnrichmentCache(cached, 'devto_user');
    if (rehydrated) return rehydrated;
  }

  const url = new URL(DEVTO_ENDPOINT);
  url.searchParams.set('url', handle);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'LaunchKit/1.0',
        Accept: 'application/vnd.forem.api-v1+json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[enrichDevtoUser] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
  clearTimeout(timer);

  if (!response.ok) {
    console.warn(
      `[enrichDevtoUser] ${String(response.status)} ${response.statusText}`
    );
    return null;
  }

  const rawJson: unknown = await response.json().catch(() => null);
  const parsed = DevtoUserResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn('[enrichDevtoUser] response did not match expected shape');
    return null;
  }

  const profile: InfluencerProfile = {
    source: 'devto_user',
    handle: parsed.data.username,
    displayName: parsed.data.name,
    bio: parsed.data.summary,
    followers: null,
    additionalMetrics: {
      postCount: parsed.data.post_count,
    },
  };

  await writeEnrichmentCache('devto_user', handle, profile);
  return profile;
}
