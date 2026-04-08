import { z } from 'zod';
import { env } from '../env.js';
import {
  readSignalCache,
  rehydrateSignalCache,
  writeSignalCache,
  type SignalItem,
} from './trending-signal-types.js';

/**
 * Grok (xAI) — live X (Twitter) search.
 *
 * The only trending-signal source with live access to posts on X.
 * xAI exposes Live Search through the chat completions endpoint via
 * the `search_parameters` field; passing `sources: [{type: 'x'}]`
 * restricts the search surface to X posts and returns citations
 * alongside the model's synthesized answer.
 *
 * We then ask Grok to emit a structured JSON array of the posts it
 * considered most relevant, forced through an OpenAI-compatible
 * `response_format: json_schema` so the model cannot drift into prose.
 * A best-effort Zod parse validates the payload at the boundary; if
 * the response shape is malformed (shouldn't happen with a forced
 * schema, but defensive anyway) the tool returns `[]` and the agent
 * moves on to the other sources rather than failing the whole turn.
 *
 * Failure contract
 * ----------------
 *
 * The function returns an empty array — never throws — on:
 *   - Missing `GROK_API_KEY` (the source is optional; the plan calls
 *     out that the agent degrades gracefully to the free APIs)
 *   - Non-2xx response from xAI
 *   - Upstream timeout (30s)
 *   - Response body that does not match the expected shape
 *
 * Config errors in the env module are still thrown by the `env`
 * Proxy at first read. Everything else stays soft so the agent keeps
 * running when a single source is flaky.
 */

const GROK_ENDPOINT = 'https://api.x.ai/v1/chat/completions';
const GROK_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_POSTS = 15;

/**
 * JSON schema the model is forced to emit. Matches the subset of
 * `SignalItem` that Grok can plausibly know from an X post — the
 * source, topic, engagement, and publishedAt fields are filled in
 * by the tool wrapper below.
 */
const GROK_RESPONSE_JSON_SCHEMA = {
  name: 'grok_x_posts',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            headline: {
              type: 'string',
              description:
                'Short summary of the post content in one sentence',
            },
            url: {
              type: 'string',
              description: 'Full URL to the X post',
            },
            author_handle: {
              type: 'string',
              description: 'X handle with the leading @',
            },
            likes: { type: 'integer' },
            reposts: { type: 'integer' },
            replies: { type: 'integer' },
            posted_at: {
              type: 'string',
              description: 'ISO 8601 timestamp if known, empty string otherwise',
            },
          },
          required: [
            'headline',
            'url',
            'author_handle',
            'likes',
            'reposts',
            'replies',
            'posted_at',
          ],
        },
      },
    },
    required: ['posts'],
  },
} as const;

const GrokPostSchema = z.object({
  headline: z.string().min(1),
  url: z.string().min(1),
  author_handle: z.string().min(1),
  likes: z.number().int().nonnegative(),
  reposts: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  posted_at: z.string(),
});

const GrokContentPayloadSchema = z.object({
  posts: z.array(GrokPostSchema),
});

const GrokResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      })
    )
    .min(1),
  citations: z.array(z.string()).optional(),
});

export interface GrokXSearchInput {
  /**
   * Topic keyword or phrase the agent is exploring. Passed through
   * to Grok's live-search prompt verbatim and used as the
   * `SignalItem.topic` on every returned row.
   */
  topic: string;
  /**
   * Upper bound on the number of posts to return. Defaults to 15;
   * Grok is asked to return the most engaging posts in the last
   * 72 hours regardless of this cap.
   */
  maxPosts?: number;
}

export async function grokXSearch(
  input: GrokXSearchInput
): Promise<SignalItem[]> {
  const apiKey = env.GROK_API_KEY;
  if (!apiKey) {
    // Grok is optional — the agent is expected to tolerate its
    // absence and fall back to the free APIs. Log once at debug
    // level rather than throwing.
    return [];
  }

  const topic = input.topic.trim();
  if (topic.length === 0) return [];

  const maxPosts = Math.min(
    Math.max(1, input.maxPosts ?? DEFAULT_MAX_POSTS),
    25
  );

  const cacheFingerprint = `${topic}|${String(maxPosts)}`;
  const cached = await readSignalCache('grok', cacheFingerprint);
  if (cached !== null) {
    const rehydrated = rehydrateSignalCache(cached, 'grok');
    if (rehydrated.length > 0) return rehydrated;
  }

  const systemPrompt = `You are a dev-community trend scout. You will search live X (Twitter) for the user's topic and return the most engaging, relevant posts from the last 72 hours. Only include posts that are directly about the topic — not tangential mentions. Return every post's real URL (x.com/handle/status/id), not shortened links. If you cannot find any posts, return an empty array.`;

  const userPrompt = `Topic: ${topic}\n\nFind the ${String(maxPosts)} most engaging X posts about this topic from the last 72 hours. Prioritize posts from developers, engineers, and technical founders.`;

  const requestBody = {
    model: env.GROK_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    // xAI Live Search: restrict the search surface to X posts only.
    // `mode: 'on'` forces the model to always run the search rather
    // than deciding adaptively; for a trending-signal ingest pass we
    // always want the fresh data even if the model thinks it could
    // answer from memory.
    search_parameters: {
      mode: 'on',
      sources: [{ type: 'x' }],
      max_search_results: maxPosts,
      return_citations: true,
    },
    // Force structured output — the model cannot drift into prose.
    response_format: {
      type: 'json_schema',
      json_schema: GROK_RESPONSE_JSON_SCHEMA,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    GROK_REQUEST_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(GROK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.warn(
      '[grokXSearch] network error:',
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => '<no body>');
    console.warn(
      `[grokXSearch] ${String(response.status)} ${response.statusText}: ${body.slice(0, 200)}`
    );
    return [];
  }

  const rawJson: unknown = await response.json().catch(() => null);
  const parsedEnvelope = GrokResponseSchema.safeParse(rawJson);
  if (!parsedEnvelope.success) {
    console.warn(
      '[grokXSearch] response envelope did not match expected shape'
    );
    return [];
  }

  const firstChoice = parsedEnvelope.data.choices[0];
  if (!firstChoice) return [];

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(firstChoice.message.content);
  } catch {
    console.warn('[grokXSearch] model returned non-JSON content');
    return [];
  }

  const parsedPayload = GrokContentPayloadSchema.safeParse(parsedContent);
  if (!parsedPayload.success) {
    console.warn(
      '[grokXSearch] model output did not match json_schema: ',
      parsedPayload.error.issues[0]?.message ?? 'unknown'
    );
    return [];
  }

  const signals: SignalItem[] = parsedPayload.data.posts.map((post) => ({
    source: 'grok',
    topic,
    headline: post.headline,
    url: post.url,
    author: post.author_handle,
    engagement: {
      likes: post.likes,
      reposts: post.reposts,
      replies: post.replies,
    },
    publishedAt: post.posted_at.length > 0 ? post.posted_at : null,
    rawPayload: {
      post,
      // Citations are the URLs Grok actually pulled during live
      // search. Kept so the audit trail shows what the model saw.
      citations: parsedEnvelope.data.citations ?? [],
    },
  }));

  await writeSignalCache('grok', cacheFingerprint, signals);
  return signals;
}
