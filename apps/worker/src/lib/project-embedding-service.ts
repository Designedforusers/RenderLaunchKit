import { EMBEDDING_DIMENSIONS } from '@launchkit/shared';

/**
 * Generate a deterministic lexical feature vector for pgvector
 * similarity search. This is a stand-in for a real embedding API so
 * the demo stays self-contained.
 *
 * The function returns synchronously today, but the type signature
 * is `Promise<number[]>` so a future swap to a network embedding
 * service (Voyage, OpenAI, Cohere) is a one-line replacement of the
 * body — every call site already `await`s the result. The
 * `require-await` lint rule cannot tell the difference, so we
 * disable it on this single function with the explicit reason
 * spelled out.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function generateEmbedding(text: string): Promise<number[]> {
  // Create a deterministic pseudo-embedding from text content
  // This gives us consistent vectors for similarity search
  const vector: number[] = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);

  // Use a combination of character codes and position to create a spread vector
  const normalizedText = text.toLowerCase().trim();

  for (let i = 0; i < normalizedText.length; i++) {
    const charCode = normalizedText.charCodeAt(i);
    const idx = (charCode * (i + 1) * 31) % EMBEDDING_DIMENSIONS;
    vector[idx] = (vector[idx] ?? 0) + 1.0 / Math.sqrt(normalizedText.length);
  }

  // Normalize to unit length
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] = (vector[i] ?? 0) / magnitude;
    }
  }

  return vector;
}

/**
 * Create a text summary suitable for embedding from project data.
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
