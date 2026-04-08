import { z } from 'zod';
import { env } from '../env.js';
import {
  readSignalCache,
  rehydrateSignalCache,
  writeSignalCache,
  type SignalItem,
} from './trending-signal-types.js';

/**
 * Product Hunt trending signals via the v2 GraphQL API.
 *
 * Product Hunt deprecated its v1 REST API; v2 is GraphQL-only and
 * requires an `Authorization: Bearer` header with a developer token.
 * The token is free to obtain at
 * https://api.producthunt.com/v2/oauth/applications but requires a
 * Product Hunt account — for that reason we mark `PRODUCT_HUNT_TOKEN`
 * optional in the worker env and have this tool return `[]` when the
 * key is absent. The agent then falls back to the other sources.
 *
 * The query asks for the top posts in a topic ordered by vote count
 * over a rolling window — the GraphQL equivalent of "recent makers
 * in this category".
 */

const PRODUCT_HUNT_GRAPHQL_ENDPOINT =
  'https://api.producthunt.com/v2/api/graphql';
const PRODUCT_HUNT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_LIMIT = 15;

const GRAPHQL_QUERY = `
  query TopPostsByTopic($topic: String!, $first: Int!) {
    posts(topic: $topic, first: $first, order: VOTES) {
      edges {
        node {
          id
          name
          tagline
          url
          votesCount
          commentsCount
          featuredAt
          user {
            name
            username
          }
          topics(first: 5) {
            edges {
              node {
                name
              }
            }
          }
        }
      }
    }
  }
`;

const ProductHuntNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  url: z.string(),
  votesCount: z.number().int(),
  commentsCount: z.number().int(),
  featuredAt: z.string().nullable(),
  user: z.object({
    name: z.string().nullable(),
    username: z.string(),
  }),
  topics: z.object({
    edges: z.array(
      z.object({
        node: z.object({ name: z.string() }),
      })
    ),
  }),
});

const ProductHuntResponseSchema = z.object({
  data: z.object({
    posts: z.object({
      edges: z.array(z.object({ node: ProductHuntNodeSchema })),
    }),
  }),
});

export interface ProductHuntSearchInput {
  /**
   * Product Hunt topic slug (e.g. `developer-tools`, `artificial-intelligence`).
   * See https://www.producthunt.com/topics for the canonical list.
   */
  topic: string;
  /** Max posts to return. Default 15, max 30. */
  limit?: number;
}

export async function searchProductHunt(
  input: ProductHuntSearchInput
): Promise<SignalItem[]> {
  const token = env.PRODUCT_HUNT_TOKEN;
  if (!token) return [];

  const topic = input.topic.trim();
  if (topic.length === 0) return [];

  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), 30);

  const cacheFingerprint = `${topic}|${String(limit)}`;
  const cached = await readSignalCache('producthunt', cacheFingerprint);
  if (cached !== null) {
    const rehydrated = rehydrateSignalCache(cached, 'producthunt');
    if (rehydrated.length > 0) return rehydrated;
  }

  const body = {
    query: GRAPHQL_QUERY,
    variables: { topic, first: limit },
  };

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    PRODUCT_HUNT_REQUEST_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(PRODUCT_HUNT_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'LaunchKit/1.0',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[searchProductHunt] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
  clearTimeout(timer);

  if (!response.ok) {
    console.warn(
      `[searchProductHunt] ${String(response.status)} ${response.statusText}`
    );
    return [];
  }

  const rawJson: unknown = await response.json().catch(() => null);
  const parsed = ProductHuntResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn(
      '[searchProductHunt] response did not match expected shape'
    );
    return [];
  }

  const signals: SignalItem[] = parsed.data.data.posts.edges.map(
    ({ node }) => ({
      source: 'producthunt' as const,
      topic,
      headline: `${node.name} — ${node.tagline}`,
      url: node.url,
      author: node.user.name ?? node.user.username,
      engagement: {
        upvotes: node.votesCount,
        comments: node.commentsCount,
      },
      publishedAt: node.featuredAt,
      rawPayload: node,
    })
  );

  await writeSignalCache('producthunt', cacheFingerprint, signals);
  return signals;
}
