import { z } from 'zod';
import {
  readEnrichmentCache,
  rehydrateEnrichmentCache,
  writeEnrichmentCache,
  type InfluencerProfile,
} from './influencer-enrichment-types.js';

/**
 * Hacker News user enrichment via the public Firebase API.
 *
 * HN exposes per-user data at
 * `https://hacker-news.firebaseio.com/v0/user/{id}.json` with no
 * auth. The endpoint returns `karma`, `about` (HTML bio), and the
 * user's `submitted` list (story IDs). We surface karma as the ranker
 * signal — HN has no follower graph — and keep the about text as the
 * `bio`.
 *
 * Documentation: https://github.com/HackerNews/API
 *
 * Soft-fail contract matches the other enrichment tools — every
 * non-happy path returns `null`.
 */

const HN_USER_ENDPOINT = 'https://hacker-news.firebaseio.com/v0/user';
const REQUEST_TIMEOUT_MS = 15_000;

// The Firebase endpoint returns `null` (not 404) for unknown users,
// and the `about` field is often absent rather than null. The schema
// tolerates both shapes.
const HnUserResponseSchema = z.object({
  id: z.string(),
  created: z.number().int(),
  karma: z.number().int().nonnegative(),
  about: z.string().nullish(),
  submitted: z.array(z.number().int()).nullish(),
});

export interface EnrichHnUserInput {
  /** Hacker News user id. Case-sensitive, no leading `@`. */
  handle: string;
}

export async function enrichHnUser(
  input: EnrichHnUserInput
): Promise<InfluencerProfile | null> {
  const handle = input.handle.trim();
  if (handle.length === 0) return null;

  const cached = await readEnrichmentCache('hn_user', handle);
  if (cached !== null) {
    const rehydrated = rehydrateEnrichmentCache(cached, 'hn_user');
    if (rehydrated) return rehydrated;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${HN_USER_ENDPOINT}/${encodeURIComponent(handle)}.json`,
      {
        headers: { 'User-Agent': 'LaunchKit/1.0' },
        signal: controller.signal,
      }
    );
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[enrichHnUser] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
  clearTimeout(timer);

  if (!response.ok) {
    console.warn(
      `[enrichHnUser] ${String(response.status)} ${response.statusText}`
    );
    return null;
  }

  const rawJson: unknown = await response.json().catch(() => null);
  // Firebase returns the bare value `null` (not a 404) for unknown
  // users. Treat that as a soft miss.
  if (rawJson === null) {
    return null;
  }

  const parsed = HnUserResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn('[enrichHnUser] response did not match expected shape');
    return null;
  }

  const profile: InfluencerProfile = {
    source: 'hn_user',
    handle: parsed.data.id,
    displayName: null,
    bio: parsed.data.about ?? null,
    followers: null,
    additionalMetrics: {
      karma: parsed.data.karma,
    },
  };

  await writeEnrichmentCache('hn_user', handle, profile);
  return profile;
}
