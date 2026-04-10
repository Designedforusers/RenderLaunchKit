import { z } from 'zod';
import { env } from '../env.js';
import {
  readSignalCache,
  rehydrateSignalCache,
  writeSignalCache,
  type SignalItem,
} from './trending-signal-types.js';

/**
 * Grok (xAI) — live X (Twitter) search via the Responses API.
 *
 * The only trending-signal source with live access to posts on X.
 * Uses the xAI Responses API (`/v1/responses`) with the native
 * `x_search` tool — Grok searches X natively, returns citations,
 * and we force structured JSON output via `text.format.json_schema`
 * so the model emits a machine-parseable array of posts.
 *
 * The `x_search` tool supports `from_date` / `to_date` date-range
 * filtering (ISO 8601 "YYYY-MM-DD"), so we restrict the search
 * window to the last 72 hours at the API level rather than relying
 * on the prompt alone.
 *
 * Failure contract
 * ----------------
 *
 * The function returns an empty array — never throws — on:
 *   - Missing `GROK_API_KEY` (the source is optional; the plan calls
 *     out that the agent degrades gracefully to the free APIs)
 *   - Non-2xx response from xAI
 *   - Upstream timeout (60s — reasoning models are slower)
 *   - Response body that does not match the expected shape
 *
 * Config errors in the env module are still thrown by the `env`
 * Proxy at first read. Everything else stays soft so the agent keeps
 * running when a single source is flaky.
 */

const GROK_RESPONSES_ENDPOINT = 'https://api.x.ai/v1/responses';
const GROK_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_POSTS = 15;

/**
 * JSON schema the model is forced to emit via `text.format`. Matches
 * the subset of `SignalItem` that Grok can plausibly know from an
 * X post — the source, topic, engagement, and publishedAt fields
 * are filled in by the tool wrapper below.
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

/**
 * Responses API envelope. The output array contains message items;
 * we extract the first `output_text` content block from the first
 * message item. Citations live at the top level.
 */
const ResponsesOutputTextSchema = z.object({
  type: z.literal('output_text'),
  text: z.string(),
});

const ResponsesMessageSchema = z.object({
  type: z.literal('message'),
  content: z.array(ResponsesOutputTextSchema).min(1),
});

const ResponsesEnvelopeSchema = z.object({
  output: z.array(z.unknown()).min(1),
});

export interface GrokXSearchInput {
  /**
   * Topic keyword or phrase the agent is exploring. Passed through
   * to Grok's x_search prompt verbatim and used as the
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

/**
 * Returns an ISO 8601 date string (YYYY-MM-DD) for N days ago.
 */
function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function grokXSearch(
  input: GrokXSearchInput
): Promise<SignalItem[]> {
  const apiKey = env.GROK_API_KEY;
  if (!apiKey) {
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

  const userPrompt = `You are a dev-community trend scout. Search X for "${topic}" and return the ${String(maxPosts)} most engaging posts. Only include posts directly about the topic — not tangential mentions. Prioritize posts from developers, engineers, and technical founders. Return every post's real URL (x.com/handle/status/id), not shortened links. If you cannot find any posts, return an empty array.`;

  const requestBody = {
    model: env.GROK_MODEL,
    input: [
      { role: 'user', content: userPrompt },
    ],
    // Native x_search tool — Grok searches X at the API level.
    // Date range restricts to the last 72 hours so we get fresh
    // signals without relying on the prompt alone.
    tools: [
      {
        type: 'x_search',
        from_date: daysAgoDate(3),
        to_date: new Date().toISOString().slice(0, 10),
      },
    ],
    // Force structured output via the Responses API text format.
    text: {
      format: {
        type: 'json_schema',
        json_schema: GROK_RESPONSE_JSON_SCHEMA,
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    GROK_REQUEST_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(GROK_RESPONSES_ENDPOINT, {
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

  // Parse the Responses API envelope — extract the first message's
  // first output_text content block.
  const parsedEnvelope = ResponsesEnvelopeSchema.safeParse(rawJson);
  if (!parsedEnvelope.success) {
    console.warn(
      '[grokXSearch] response envelope did not match expected shape'
    );
    return [];
  }

  // Find the first message-type item in the output array.
  let textContent: string | null = null;
  for (const item of parsedEnvelope.data.output) {
    const parsed = ResponsesMessageSchema.safeParse(item);
    if (parsed.success) {
      const firstText = parsed.data.content[0];
      if (firstText) {
        textContent = firstText.text;
        break;
      }
    }
  }

  if (textContent === null) {
    console.warn('[grokXSearch] no message output found in response');
    return [];
  }

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(textContent);
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
    rawPayload: { post },
  }));

  await writeSignalCache('grok', cacheFingerprint, signals);
  return signals;
}
