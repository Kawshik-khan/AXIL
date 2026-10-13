/**
 * CommerceOS: Hybrid Search Engine & Reciprocal Rank Fusion (RRF)
 *
 * Combines dense semantic vector retrieval (pgvector / embeddings)
 * with sparse lexical retrieval (BM25) using Reciprocal Rank Fusion (RRF).
 */

import { db } from "@/infrastructure/db";
import { KnowledgeChunk, HybridSearchResult, VectorSearchResultItem, BM25SearchResult, HybridSearchDiagnostics, RetrievalChannelTrace } from "@/types/ai";
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
    return (await this.searchWithDiagnostics(tenantId, query, options)).results;
  }

  public static async searchWithDiagnostics(
    tenantId: string,
    query: string,
    options: HybridSearchOptions = {},
  ): Promise<{ results: HybridSearchResult[]; diagnostics: HybridSearchDiagnostics }> {
    if (!query || !query.trim()) return {
      results: [],
      diagnostics: {
        dense: { status: "EMPTY", candidate_count: 0, latency_ms: 0 },
        sparse: { status: "EMPTY", candidate_count: 0, latency_ms: 0 },
      },
    };

    const topK = options.topK ?? 20;
    const denseLimit = options.denseLimit ?? 30;
    const sparseLimit = options.sparseLimit ?? 30;
    const rrfK = options.rrfConstantK ?? this.DEFAULT_RRF_K;
    const wDense = options.weightDense !== undefined ? options.weightDense : this.DEFAULT_WEIGHT_DENSE;
    const wSparse = options.weightSparse !== undefined ? options.weightSparse : this.DEFAULT_WEIGHT_SPARSE;
    const minVectorScore = options.minVectorSimilarity ?? 0.45;
    const onlyChildChunks = options.onlyChildChunks !== false;

    if (!Number.isInteger(topK) || topK < 1 || topK > 100 || !Number.isInteger(denseLimit) || denseLimit < 1 || denseLimit > 500 ||
        !Number.isInteger(sparseLimit) || sparseLimit < 1 || sparseLimit > 500 || !Number.isFinite(rrfK) || rrfK <= 0 ||
        !Number.isFinite(minVectorScore) || minVectorScore < -1 || minVectorScore > 1 ||
        !Number.isFinite(wDense) || wDense < 0 || !Number.isFinite(wSparse) || wSparse < 0 || wDense + wSparse <= 0) {
      throw new Error("Invalid hybrid search options.");
    }

    // 1. Run Parallel Retrievals
    const [dense, sparse] = await Promise.all([
      this.executeDenseSearch(tenantId, query, denseLimit, minVectorScore, onlyChildChunks),
      this.executeSparseSearch(tenantId, query, sparseLimit, onlyChildChunks),
    ]);
    const denseResults = dense.items;
    const sparseResults = sparse.items;

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
    const results = fusedList.slice(0, topK).map((item) => ({
      chunk: item.chunk,
      rrf_score: Number(item.rrfScore.toFixed(5)),
      vector_rank: item.vectorRank,
      vector_similarity: item.vectorSimilarity ? Number(item.vectorSimilarity.toFixed(4)) : undefined,
      bm25_rank: item.bm25Rank,
      bm25_score: item.bm25Score ? Number(item.bm25Score.toFixed(4)) : undefined,
    }));
    return {
      results,
      diagnostics: {
        dense: { status: dense.status, candidate_count: denseResults.length, latency_ms: dense.latencyMs, error_code: dense.errorCode },
        sparse: { status: sparse.status, candidate_count: sparseResults.length, latency_ms: sparse.latencyMs, error_code: sparse.errorCode },
        ...(dense.profile ? { index_profile: dense.profile } : {}),
      },
    };
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
  ): Promise<{ items: VectorSearchResultItem[]; status: RetrievalChannelTrace["status"]; latencyMs: number; errorCode?: string; profile?: HybridSearchDiagnostics["index_profile"] }> {
    const start = Date.now();
    try {
      const queryEmbedding = await EmbeddingService.embedText(query);
      const profile = EmbeddingService.getProfile(queryEmbedding.length);

      const activeDocuments = db.getKnowledgeDocuments(tenantId).filter((doc) => doc.status === "ACTIVE");
      const activeVersions = new Map(activeDocuments.map((doc) => [doc.id, doc.version]));
      const compatibleChunk = (chunk: KnowledgeChunk | undefined) => !!chunk && activeVersions.get(chunk.document_id) === chunk.metadata.version &&
        chunk.metadata.embedding_model === profile.model && chunk.metadata.embedding_provider === profile.provider &&
        chunk.metadata.embedding_dimensions === profile.dimensions && chunk.metadata.index_version === profile.index_version;

      // 1. Use Qdrant when configured (QDRANT_URL)
      try {
        const { isQdrantConfigured, searchVectors } = await import("@/infrastructure/qdrant/client");
        if (isQdrantConfigured(tenantId)) {
          const pcResults = await searchVectors(tenantId, queryEmbedding, limit * 3, minScore, profile);
          const verifiedResults = (pcResults || []).flatMap((r) => {
              const localChunk = db.findKnowledgeChunkById(tenantId, r.id);
              if (!localChunk || !compatibleChunk(localChunk) || localChunk.document_id !== r.metadata.document_id ||
                  localChunk.metadata.version !== r.metadata.version || localChunk.metadata.index_version !== r.metadata.index_version) return [];
              return [{ chunk: localChunk, similarity: r.score, rank: 0 }];
          }).slice(0, limit).map((result, index) => ({ ...result, rank: index + 1 }));
          if (verifiedResults.length > 0) {
            return { items: verifiedResults, status: "SUCCESS", latencyMs: Date.now() - start, profile };
          }
        }
      } catch (pcErr) {
        const error = pcErr as Error;
        // A Qdrant failure is observable, while compatible local vectors remain a valid dense fallback.
        console.warn("[HybridSearch] Qdrant search failed; using local vectors:", error.message);
      }

      // 2. Local pgvector / in-memory vector search fallback
      const activeVersionChunks = db.getAllTenantKnowledgeChunks(tenantId)
        .filter((chunk) => compatibleChunk(chunk) && (!onlyChildChunks || chunk.chunk_type !== "PARENT"));
      const scoredChunks = db.searchKnowledgeChunks(
        tenantId,
        queryEmbedding,
        limit,
        minScore,
        onlyChildChunks ? { excludeParents: true } : undefined,
      );
      const filtered = scoredChunks.filter((chunk) => activeVersionChunks.some((active) => active.id === chunk.id));
      if (filtered.length > 0) return { items: filtered.map((c, idx) => ({
        chunk: c,
        similarity: c.similarity,
        rank: idx + 1,
      })), status: "SUCCESS", latencyMs: Date.now() - start, profile };
      const hasIndexedChunks = activeVersionChunks.some((chunk) => chunk.embedding?.length > 0);
      return { items: [], status: hasIndexedChunks ? "EMPTY" : "INCOMPATIBLE_INDEX", latencyMs: Date.now() - start, profile };
    } catch (err) {
      console.warn("[HybridSearch] Dense search unavailable:", (err as Error).message);
      return { items: [], status: "UNAVAILABLE", latencyMs: Date.now() - start, errorCode: (err as { code?: string }).code || "EMBEDDING_OR_VECTOR_SEARCH_FAILED" };
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
  ): Promise<{ items: BM25SearchResult[]; status: RetrievalChannelTrace["status"]; latencyMs: number; errorCode?: string }> {
    const start = Date.now();
    try {
      // Pull all tenant chunks from db
      const activeVersions = new Map(db.getKnowledgeDocuments(tenantId).filter((doc) => doc.status === "ACTIVE").map((doc) => [doc.id, doc.version]));
      let allChunks = db.getAllTenantKnowledgeChunks(tenantId).filter((chunk) => activeVersions.get(chunk.document_id) === chunk.metadata.version);
      if (onlyChildChunks) {
        allChunks = allChunks.filter((c) => c.chunk_type !== "PARENT");
      }

      if (allChunks.length === 0) return { items: [], status: "EMPTY", latencyMs: Date.now() - start };

      const items = BM25Service.search(tenantId, query, allChunks, limit);
      return { items, status: items.length ? "SUCCESS" : "EMPTY", latencyMs: Date.now() - start };
    } catch (err) {
      console.warn("[HybridSearch] Sparse BM25 search unavailable:", (err as Error).message);
      return { items: [], status: "UNAVAILABLE", latencyMs: Date.now() - start, errorCode: "BM25_SEARCH_FAILED" };
    }
  }
}
