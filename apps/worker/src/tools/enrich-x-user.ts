import { z } from 'zod';
import { env } from '../env.js';
import {
  readEnrichmentCache,
  rehydrateEnrichmentCache,
  writeEnrichmentCache,
  type InfluencerProfile,
} from './influencer-enrichment-types.js';

/**
 * X (Twitter) user enrichment via the v2 `users/by/username` endpoint.
 *
 * This is the only paid tool in the Phase 5 enrichment fan-out. The
 * v2 API requires a Bearer token on the "Basic" tier or above; when
 * the `X_API_BEARER_TOKEN` env var is unset, this tool short-circuits
 * to `null` without making an upstream call and logs a single info
 * message at module-first-use so the warning does not spam the logs
 * on every discovery-loop iteration.
 *
 * Documentation:
 * https://developer.twitter.com/en/docs/twitter-api/users/lookup/api-reference/get-users-by-username-username
 *
 * Soft-fail contract matches the other enrichment tools — every
 * non-happy path (401, 404, 429, 503, network error, schema mismatch)
 * returns `null`. The 429 path logs a distinct "rate limited" warning
 * so an operator watching the logs can tell "we hit the cap" apart
 * from "upstream is sick."
 */

const X_USER_ENDPOINT = 'https://api.twitter.com/2/users/by/username';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60;

// Module-level guard so the "disabled" warning fires once per worker
// process. Resetting to `true` on subsequent calls would spam the
// logs every time the discovery agent fans out.
let disabledWarningLogged = false;

const XPublicMetricsSchema = z.object({
  followers_count: z.number().int().nonnegative(),
  following_count: z.number().int().nonnegative(),
  tweet_count: z.number().int().nonnegative(),
  listed_count: z.number().int().nonnegative(),
});

const XUserResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
    description: z.string().optional(),
    verified: z.boolean().optional(),
    public_metrics: XPublicMetricsSchema,
  }),
});

export interface EnrichXUserInput {
  /** X (Twitter) username. No leading `@`, no URL. */
  handle: string;
}

export async function enrichXUser(
  input: EnrichXUserInput
): Promise<InfluencerProfile | null> {
  const bearer = env.X_API_BEARER_TOKEN;
  if (!bearer) {
    if (!disabledWarningLogged) {
      console.info(
        '[enrichXUser] X enrichment disabled (X_API_BEARER_TOKEN unset)'
      );
      disabledWarningLogged = true;
    }
    return null;
  }

  const handle = input.handle.trim();
  if (handle.length === 0) return null;

  const cached = await readEnrichmentCache('x_user', handle);
  if (cached !== null) {
    const rehydrated = rehydrateEnrichmentCache(cached, 'x_user');
    if (rehydrated) return rehydrated;
  }

  const url = new URL(`${X_USER_ENDPOINT}/${encodeURIComponent(handle)}`);
  url.searchParams.set(
    'user.fields',
    'public_metrics,description,verified,created_at,profile_image_url'
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${bearer}`,
        'User-Agent': 'LaunchKit/1.0',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[enrichXUser] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
  clearTimeout(timer);

  if (response.status === 429) {
    console.warn('[enrichXUser] X API rate limited');
    return null;
  }

  if (!response.ok) {
    console.warn(
      `[enrichXUser] ${String(response.status)} ${response.statusText}`
    );
    return null;
  }

  const rawJson: unknown = await response.json().catch(() => null);
  const parsed = XUserResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn('[enrichXUser] response did not match expected shape');
    return null;
  }

  const metrics = parsed.data.data.public_metrics;
  const description = parsed.data.data.description;
  const verified = parsed.data.data.verified;
  const profile: InfluencerProfile = {
    source: 'x_user',
    handle: parsed.data.data.username,
    displayName: parsed.data.data.name,
    bio: description ?? null,
    followers: metrics.followers_count,
    additionalMetrics: {
      followingCount: metrics.following_count,
      tweetCount: metrics.tweet_count,
      listedCount: metrics.listed_count,
      ...(verified !== undefined ? { verified } : {}),
    },
  };

  // Cache TTL is at least 24h; a longer enrichment cadence on the
  // cron side should keep the cache warm between refreshes so we do
  // not re-pay for identical reads. The default is the floor — a
  // future cron-driven override can pass a larger value here.
  await writeEnrichmentCache('x_user', handle, profile, DEFAULT_CACHE_TTL_SECONDS);
  return profile;
}
