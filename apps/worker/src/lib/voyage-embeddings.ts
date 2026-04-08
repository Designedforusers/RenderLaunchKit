import { z } from 'zod';
import { env } from '../env.js';

/**
 * Voyage AI embeddings client.
 *
 * Voyage is Anthropic's recommended embeddings pairing — `voyage-3-large`
 * is the current state-of-the-art on retrieval benchmarks and the
 * canonical choice for projects that already use Claude as the
 * reasoning model. Replaces the previous lexical-hash placeholder in
 * `project-embedding-service.ts` that produced semantically meaningless
 * vectors.
 *
 * Why a hand-written client (no SDK)
 * ----------------------------------
 *
 * Voyage's REST API is small enough that pulling in their SDK adds
 * dependency surface for ~30 lines of saved code. The whole API we use
 * is one POST endpoint with one response shape, both of which are
 * Zod-validated below — same discipline as every other external API
 * boundary in this repo.
 *
 * Failure mode
 * ------------
 *
 * Throws `VoyageEmbeddingError` (a named subclass of Error) on:
 *   - missing `VOYAGE_API_KEY` (with the exact env var name in the message)
 *   - non-2xx HTTP response (with the upstream status + body)
 *   - response body that does not match the documented Voyage shape
 *   - empty `data` array (zero embeddings returned)
 *
 * Callers that need graceful degradation should catch the error at
 * the call site. The default behavior is fail-fast — pgvector queries
 * with garbage embeddings are worse than no embeddings.
 */

const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

// Voyage's documented per-request limit for `voyage-3-large`. The
// generic `generateVoyageEmbeddings` chunks longer arrays
// automatically.
const VOYAGE_BATCH_LIMIT = 128;

// Hard ceiling on a single fetch call to Voyage. The worker's job
// timeouts are minutes-long; without an explicit timeout here a
// stalled connection would hang the BullMQ job processor right up
// to the job timeout instead of failing fast.
const VOYAGE_REQUEST_TIMEOUT_MS = 30_000;

const VoyageEmbeddingResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(
    z.object({
      object: z.literal('embedding'),
      embedding: z.array(z.number()),
      index: z.number(),
    })
  ),
  model: z.string(),
  usage: z.object({
    total_tokens: z.number(),
  }),
});

export class VoyageEmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoyageEmbeddingError';
  }
}

export interface VoyageEmbeddingOptions {
  /**
   * Voyage's `input_type` parameter. Use `'document'` for content
   * being stored for later retrieval (default), `'query'` for the
   * query side of a search. Voyage's models produce slightly
   * different embeddings for each, optimized for the asymmetric
   * retrieval case.
   */
  inputType?: 'document' | 'query';
}

interface VoyageRequestBody {
  input: string[];
  model: string;
  input_type: 'document' | 'query';
}

async function callVoyage(
  texts: string[],
  options: VoyageEmbeddingOptions
): Promise<number[][]> {
  const apiKey = env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new VoyageEmbeddingError(
      'VOYAGE_API_KEY is not set. Add it to your `.env`: ' +
        '`VOYAGE_API_KEY=pa-...`. Sign up at https://www.voyageai.com — ' +
        '200M tokens free, then $0.18/M tokens.'
    );
  }

  const requestBody: VoyageRequestBody = {
    input: texts,
    model: env.VOYAGE_MODEL,
    input_type: options.inputType ?? 'document',
  };

  // Wire up an `AbortController` so the fetch fails fast on a stalled
  // connection. Without this, a hung Voyage call sits at the network
  // layer until the BullMQ job timeout kills the whole job — minutes
  // of wall time for a config error.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    VOYAGE_REQUEST_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(VOYAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    // `fetch` throws a `TypeError` for network-level failures (DNS
    // miss, connection refused, TLS error) and a `DOMException` with
    // `name === 'AbortError'` when our timeout fires. Both fail
    // modes go through the same error class so callers checking
    // `instanceof VoyageEmbeddingError` catch them.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new VoyageEmbeddingError(
        `Voyage API request timed out after ${VOYAGE_REQUEST_TIMEOUT_MS}ms`
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new VoyageEmbeddingError(
      `Voyage API network error: ${message}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '<no body>');
    throw new VoyageEmbeddingError(
      `Voyage API returned ${response.status} ${response.statusText}: ${errorText}`
    );
  }

  const rawJson: unknown = await response.json();
  const parsed = VoyageEmbeddingResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => {
        const path =
          issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new VoyageEmbeddingError(
      `Voyage API response did not match expected shape: ${formatted}`
    );
  }

  if (parsed.data.data.length === 0) {
    throw new VoyageEmbeddingError(
      `Voyage API returned no embeddings for ${texts.length} inputs`
    );
  }

  // Sort by `index` to guarantee the output order matches the input
  // order regardless of how Voyage chooses to return the array.
  return parsed.data.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Generate a single Voyage embedding for one piece of text.
 *
 * Returns a `number[]` of length `EMBEDDING_DIMENSIONS` (1024 for
 * `voyage-3-large`).
 */
export async function generateVoyageEmbedding(
  text: string,
  options: VoyageEmbeddingOptions = {}
): Promise<number[]> {
  const results = await callVoyage([text], options);
  const first = results[0];
  if (!first) {
    throw new VoyageEmbeddingError(
      'Voyage API returned an empty embedding array for a single-input call'
    );
  }
  return first;
}

/**
 * Generate Voyage embeddings for an array of texts in a single API
 * call. Voyage supports up to 128 inputs per request natively; this
 * function chunks longer arrays automatically.
 *
 * Use this for the seed step (re-embedding every project) and for
 * batch jobs that have many texts to embed at once. For one-off
 * single-text embeddings, use `generateVoyageEmbedding`.
 */
export async function generateVoyageEmbeddings(
  texts: string[],
  options: VoyageEmbeddingOptions = {}
): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (texts.length <= VOYAGE_BATCH_LIMIT) {
    return callVoyage(texts, options);
  }

  // Chunk into Voyage-allowed batch sizes and concatenate.
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += VOYAGE_BATCH_LIMIT) {
    const chunk = texts.slice(i, i + VOYAGE_BATCH_LIMIT);
    const chunkResults = await callVoyage(chunk, options);
    results.push(...chunkResults);
  }
  return results;
}
