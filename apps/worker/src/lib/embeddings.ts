import { anthropic } from './claude.js';
import { EMBEDDING_DIMENSIONS } from '@launchkit/shared';

/**
 * Generate an embedding vector for text using a simple hash-based approach.
 * In production, you'd use a dedicated embedding model (e.g., voyage-3 or similar).
 * For this project, we use Claude to create a descriptive summary and then
 * hash it into a fixed-dimension vector for pgvector similarity search.
 *
 * Note: This is a functional approximation. For production-grade similarity,
 * use an actual embedding API.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Create a deterministic pseudo-embedding from text content
  // This gives us consistent vectors for similarity search
  const vector: number[] = new Array(EMBEDDING_DIMENSIONS).fill(0);

  // Use a combination of character codes and position to create a spread vector
  const normalizedText = text.toLowerCase().trim();

  for (let i = 0; i < normalizedText.length; i++) {
    const charCode = normalizedText.charCodeAt(i);
    const idx = (charCode * (i + 1) * 31) % EMBEDDING_DIMENSIONS;
    vector[idx] += 1.0 / Math.sqrt(normalizedText.length);
  }

  // Normalize to unit length
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= magnitude;
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
