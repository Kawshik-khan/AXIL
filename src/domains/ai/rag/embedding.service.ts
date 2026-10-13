/**
 * CommerceOS Phase 4: Embedding Service
 * Multilingual vector embedding generation with batching.
 *
 * FX-82 (audit F13): a failed embedding is retried with backoff and always counted; callers that fall back (the dense
 * search channel) do so visibly, and the agent-health alerts fire above a 1% failure rate.
 */

import { modelRouter } from "@/domains/ai/providers/model-router";
import { logger } from "@/lib/logger";
import { isAppError } from "@/lib/errors";

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

/** Only retry throttling, timeouts, server errors and network failures. Invalid configuration/data fails immediately. */
export function isTransientEmbeddingError(error: unknown): boolean {
  if (!isAppError(error)) return false;
  const providerStatus = Number(error.details?.status);
  const failureKind = error.details?.failure_kind;
  return providerStatus === 408 || providerStatus === 429 || providerStatus >= 500 || failureKind === "timeout" || failureKind === "network";
}

export class EmbeddingService {
  private static readonly PREPROCESSING_VERSION = "section-content-v1";

  /** The model and vector size new chunks are stamped with; chunks with another stamp are re-embedded (FX-82). */
  public static currentStamp(): { embedding_model: string; dimensions?: number } {
    return modelRouter.embeddingStamp();
  }

  public static getProfile(dimensions: number): { provider: string; model: string; dimensions: number; preprocessing_version: string; index_version: string } {
    const profile = modelRouter.getEmbeddingProfile();
    if (!Number.isInteger(dimensions) || dimensions < 1 || (profile.configured_dimensions && profile.configured_dimensions !== dimensions)) {
      throw new Error("Embedding vector dimensions do not match the configured embedding profile.");
    }
    const generation = `${this.PREPROCESSING_VERSION}:${profile.provider}:${profile.model}:${dimensions}`;
    return { ...profile, dimensions, preprocessing_version: this.PREPROCESSING_VERSION, index_version: generation };
  }

  /**
   * Generates an embedding vector for a single string. Retries twice with backoff; a final failure is counted and thrown.
   */
  public static async embedText(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) throw new Error("Cannot embed empty text.");
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
        if (isAppError(err) && !isTransientEmbeddingError(err) && code !== "LLM_PROVIDER_ERROR" && code !== "OUTBOUND_UNREACHABLE") {
          break;
        }
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
    if (texts.length === 0) return [];
    const results: number[][] = [];
    const batchSize = 8;
    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const batch = await Promise.all(texts.slice(offset, offset + batchSize).map((text) => this.embedText(text)));
      results.push(...batch);
    }
    const dimensions = results[0]?.length;
    if (!dimensions || results.length !== texts.length || results.some((vector) =>
      vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)) || !vector.some((value) => value !== 0)
    )) throw new Error("Embedding batch has missing, invalid, zero, or inconsistent vectors.");
    this.getProfile(dimensions);
    return results;
  }
}
