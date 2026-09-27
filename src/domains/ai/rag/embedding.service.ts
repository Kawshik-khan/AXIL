/**
 * CommerceOS Phase 4: Embedding Service
 * Multilingual 1536-dimensional vector embedding generation with batching.
 */

import { modelRouter } from "@/domains/ai/providers/model-router";

export class EmbeddingService {
  /**
   * Generates a 1536-dimensional embedding vector for a single string.
   */
  public static async embedText(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(1536).fill(0);
    }
    return modelRouter.generateEmbedding(text);
  }

  /**
   * Batch generates embeddings for multiple text chunks.
   */
  public static async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const vec = await this.embedText(text);
      results.push(vec);
    }
    return results;
  }
}
