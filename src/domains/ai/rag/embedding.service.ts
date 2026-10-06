/**
 * CommerceOS Phase 4: Embedding Service
 * Multilingual vector embedding generation with batching.
 *
 * FX-82 (audit F13): a failed embedding is retried with backoff and always counted; callers that fall back (the dense
 * search channel) do so visibly, and the agent-health alerts fire above a 1% failure rate.
 */

import { modelRouter } from "@/domains/ai/providers/model-router";
import { logger } from "@/lib/logger";

const RETRIES = 2;
const BASE_BACKOFF_MS = 200;
const counters = { calls: 0, failures: 0, retries: 0, since: new Date().toISOString() };

/** This server's embedding calls and failures since start (FX-82 metric). */
export function embeddingMetrics(): { calls: number; failures: number; retries: number; failure_rate: number | null; since: string } {
  return { ...counters, failure_rate: counters.calls ? Math.round((counters.failures / counters.calls) * 1000) / 10 : null };
}

/** Tests only. */
export function resetEmbeddingMetrics(): void {
  Object.assign(counters, { calls: 0, failures: 0, retries: 0, since: new Date().toISOString() });
}

export class EmbeddingService {
  /** The model and vector size new chunks are stamped with; chunks with another stamp are re-embedded (FX-82). */
  public static currentStamp(): { embedding_model: string; dimensions?: number } {
    return modelRouter.embeddingStamp();
  }

  /**
   * Generates an embedding vector for a single string. Retries twice with backoff; a final failure is counted and thrown.
   */
  public static async embedText(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(1536).fill(0);
    }
    counters.calls++;
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        return await modelRouter.generateEmbedding(text);
      } catch (err) {
        lastError = err;
        const code = (err as { code?: string }).code;
        // Configuration problems and kill switches won't fix themselves on retry
        if (code === "AI_PROVIDER_NOT_CONFIGURED" || code === "KILL_SWITCH_ACTIVE") break;
        if (attempt < RETRIES) {
          counters.retries++;
          await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * 2 ** attempt));
        }
      }
    }
    counters.failures++;
    logger.warn("rag.embedding_failed", { code: (lastError as { code?: string }).code ?? "ERROR", failures: counters.failures, calls: counters.calls });
    throw lastError;
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
