import { generateVoyageEmbedding } from './voyage-embeddings.js';

/**
 * Generate a semantic embedding vector for a piece of project text
 * using Voyage AI (`voyage-3-large`, 1024 dim).
 *
 * Replaces the previous deterministic lexical hash that populated
 * the `projects.embedding` pgvector column with a vector that had no
 * semantic meaning ("fast HTTP server" and "speedy web framework"
 * produced unrelated vectors despite being semantically identical).
 *
 * The function signature is unchanged from the lexical-hash version
 * so every existing call site keeps working — they just get real
 * embeddings now. Throws `VoyageEmbeddingError` if `VOYAGE_API_KEY`
 * is not set or the upstream API call fails. See
 * `apps/worker/src/lib/voyage-embeddings.ts` for the full failure
 * surface.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  return generateVoyageEmbedding(text, { inputType: 'document' });
}

/**
 * Build the canonical text representation of a project for
 * embedding. Combines repo name + description + language + tech
 * stack + category + topics into a single line that captures the
 * project's semantic identity. The result is fed straight into
 * `generateEmbedding` so the same project always produces the same
 * embedding regardless of when it's regenerated.
 */
export function createProjectEmbeddingText(data: {
  repoName: string;
  description: string;
  language: string;
  techStack: string[];
  category: string;
  topics: string[];
}): string {
  return [
    data.repoName,
    data.description,
    `Language: ${data.language}`,
    `Tech: ${data.techStack.join(', ')}`,
    `Category: ${data.category}`,
    `Topics: ${data.topics.join(', ')}`,
  ]
    .filter(Boolean)
    .join('. ');
}
