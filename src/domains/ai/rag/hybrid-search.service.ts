/**
 * CommerceOS: Hybrid Search Engine & Reciprocal Rank Fusion (RRF)
 *
 * Combines dense semantic vector retrieval (pgvector / embeddings)
 * with sparse lexical retrieval (BM25) using Reciprocal Rank Fusion (RRF).
 */

import { db } from "@/infrastructure/db";
import { KnowledgeChunk, HybridSearchResult, VectorSearchResultItem, BM25SearchResult } from "@/types/ai";
import { BM25Service } from "./bm25.service";
import { EmbeddingService } from "./embedding.service";

export interface HybridSearchOptions {
  topK?: number;           // Final number of fused candidates to return (default: 20)
  denseLimit?: number;     // Number of dense vector results to fetch (default: 30)
  sparseLimit?: number;    // Number of BM25 results to fetch (default: 30)
  rrfConstantK?: number;   // RRF smoothing parameter k (default: 60)
  weightDense?: number;    // RRF dense weight (default: 0.60)
  weightSparse?: number;   // RRF sparse weight (default: 0.40)
  minVectorSimilarity?: number; // Minimum cosine similarity cutoff (default: 0.50)
  onlyChildChunks?: boolean;    // Focus retrieval on high-granularity child chunks (default: true)
}

export class HybridSearchService {
  private static readonly DEFAULT_RRF_K = 60;
  private static readonly DEFAULT_WEIGHT_DENSE = 0.60;
  private static readonly DEFAULT_WEIGHT_SPARSE = 0.40;

  /**
   * Executes dual-channel Hybrid Retrieval and Reciprocal Rank Fusion.
   */
  public static async search(
    tenantId: string,
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult[]> {
    if (!query || !query.trim()) return [];

    const topK = options.topK || 20;
    const denseLimit = options.denseLimit || 30;
    const sparseLimit = options.sparseLimit || 30;
    const rrfK = options.rrfConstantK || this.DEFAULT_RRF_K;
    const wDense = options.weightDense !== undefined ? options.weightDense : this.DEFAULT_WEIGHT_DENSE;
    const wSparse = options.weightSparse !== undefined ? options.weightSparse : this.DEFAULT_WEIGHT_SPARSE;
    const minVectorScore = options.minVectorSimilarity || 0.45;
    const onlyChildChunks = options.onlyChildChunks !== false;

    // 1. Run Parallel Retrievals
    const [denseResults, sparseResults] = await Promise.all([
      this.executeDenseSearch(tenantId, query, denseLimit, minVectorScore, onlyChildChunks),
      this.executeSparseSearch(tenantId, query, sparseLimit, onlyChildChunks),
    ]);

    // 2. Perform Reciprocal Rank Fusion (RRF)
    const fusedMap = new Map<string, {
      chunk: KnowledgeChunk;
      rrfScore: number;
      vectorRank?: number;
      vectorSimilarity?: number;
      bm25Rank?: number;
      bm25Score?: number;
    }>();

    // Ingest Dense Ranks into RRF
    for (const d of denseResults) {
      const rrfContribution = wDense * (1.0 / (rrfK + d.rank));
      fusedMap.set(d.chunk.id, {
        chunk: d.chunk,
        rrfScore: rrfContribution,
        vectorRank: d.rank,
        vectorSimilarity: d.similarity,
      });
    }

    // Ingest Sparse BM25 Ranks into RRF
    for (const s of sparseResults) {
      const rrfContribution = wSparse * (1.0 / (rrfK + s.rank));
      if (fusedMap.has(s.chunk.id)) {
        const existing = fusedMap.get(s.chunk.id)!;
        existing.rrfScore += rrfContribution;
        existing.bm25Rank = s.rank;
        existing.bm25Score = s.score;
      } else {
        fusedMap.set(s.chunk.id, {
          chunk: s.chunk,
          rrfScore: rrfContribution,
          bm25Rank: s.rank,
          bm25Score: s.score,
        });
      }
    }

    // 3. Sort by fused RRF score descending
    const fusedList = Array.from(fusedMap.values());
    fusedList.sort((a, b) => b.rrfScore - a.rrfScore);

    // 4. Return topK candidates
    return fusedList.slice(0, topK).map((item) => ({
      chunk: item.chunk,
      rrf_score: Number(item.rrfScore.toFixed(5)),
      vector_rank: item.vectorRank,
      vector_similarity: item.vectorSimilarity ? Number(item.vectorSimilarity.toFixed(4)) : undefined,
      bm25_rank: item.bm25Rank,
      bm25_score: item.bm25Score ? Number(item.bm25Score.toFixed(4)) : undefined,
    }));
  }

  /**
   * Dense semantic vector retrieval channel via pgvector / embeddings.
   */
  private static async executeDenseSearch(
    tenantId: string,
    query: string,
    limit: number,
    minScore: number,
    onlyChildChunks: boolean
  ): Promise<VectorSearchResultItem[]> {
    try {
      const queryEmbedding = await EmbeddingService.embedText(query);

      // 1. Use Qdrant when configured (QDRANT_URL)
      try {
        const { isQdrantConfigured, searchVectors } = await import("@/infrastructure/qdrant/client");
        if (isQdrantConfigured(tenantId)) {
          const pcResults = await searchVectors(tenantId, queryEmbedding, limit, minScore);
          if (pcResults && pcResults.length > 0) {
            return pcResults.map((r, idx) => {
              const localChunk = db.findKnowledgeChunkById(tenantId, r.id);
              const chunk: KnowledgeChunk = localChunk || {
                id: r.id,
                tenant_id: tenantId,
                document_id: r.metadata.document_id,
                chunk_index: r.metadata.chunk_index || idx,
                chunk_type: "CHILD",
                parent_chunk_id: r.metadata.parent_chunk_id,
                section_heading: r.metadata.section_heading,
                content: r.metadata.content,
                embedding: queryEmbedding,
                token_count: Math.ceil((r.metadata.content || "").length / 4),
                metadata: {
                  document_title: r.metadata.document_title,
                  document_type: r.metadata.document_type as any,
                  version: r.metadata.version || 1,
                  language: r.metadata.language || "mixed",
                },
                created_at: new Date().toISOString(),
              };

              return {
                chunk,
                similarity: r.score,
                rank: idx + 1,
              };
            });
          }
        }
      } catch (pcErr) {
        console.warn("[HybridSearch] Qdrant search error, falling back to local vectors:", pcErr);
      }

      // 2. Local pgvector / in-memory vector search fallback
      const scoredChunks = db.searchKnowledgeChunks(
        tenantId,
        queryEmbedding,
        limit,
        minScore,
        onlyChildChunks ? { excludeParents: true } : undefined
      );

      return scoredChunks.map((c, idx) => ({
        chunk: c,
        similarity: c.similarity,
        rank: idx + 1,
      }));
    } catch (err) {
      console.warn("[HybridSearch] Dense search fallback to empty:", err);
      return [];
    }
  }

  /**
   * Sparse lexical BM25 retrieval channel.
   */
  private static async executeSparseSearch(
    tenantId: string,
    query: string,
    limit: number,
    onlyChildChunks: boolean
  ): Promise<BM25SearchResult[]> {
    try {
      // Pull all tenant chunks from db
      let allChunks = db.getAllTenantKnowledgeChunks(tenantId);
      if (onlyChildChunks) {
        allChunks = allChunks.filter((c) => c.chunk_type !== "PARENT");
      }

      if (allChunks.length === 0) return [];

      return BM25Service.search(tenantId, query, allChunks, limit);
    } catch (err) {
      console.warn("[HybridSearch] Sparse BM25 search fallback to empty:", err);
      return [];
    }
  }
}
