/**
 * CommerceOS: Agentic RAG Top-Level Controller
 *
 * Orchestrates autonomous multi-step retrieval, colloquial Banglish query expansion,
 * parallel Hybrid Search (BM25 + pgvector), Cross-Encoder Reranking,
 * Hierarchical Parent-Child context resolution, and Corrective RAG confidence evaluation.
 */

import { RequestContext } from "@/lib/context";
import {
  AgenticRagResult,
  AgenticRagStepTrace,
  RetrievalCitation,
  RerankedChunkResult,
} from "@/types/ai";
import { HybridSearchService } from "./hybrid-search.service";
import { RerankerService } from "./reranker.service";

export interface AgenticRagControllerOptions {
  topK?: number;                  // Number of top citations to retrieve (default: 3)
  confidenceThresholdHigh?: number; // High confidence cutoff (default: 0.80)
  confidenceThresholdLow?: number;  // Minimum confidence cutoff (default: 0.65)
  enableQueryExpansion?: boolean;   // Expand Banglish/Bangla terms (default: true)
  resolveParentContext?: boolean;   // Expand child to parent chunk (default: true)
}

export class AgenticRagController {
  private static readonly CONFIDENCE_HIGH = 0.80;
  private static readonly CONFIDENCE_LOW = 0.65;

  /**
   * Main entrypoint for Agentic RAG execution loop.
   */
  public static async execute(
    tenantId: string,
    query: string,
    options: AgenticRagControllerOptions = {}
  ): Promise<AgenticRagResult> {
    const startTime = Date.now();
    const traces: AgenticRagStepTrace[] = [];

    const topK = options.topK || 3;
    const thresholdHigh = options.confidenceThresholdHigh || this.CONFIDENCE_HIGH;
    const thresholdLow = options.confidenceThresholdLow || this.CONFIDENCE_LOW;
    const enableExpansion = options.enableQueryExpansion !== false;
    const resolveParent = options.resolveParentContext !== false;

    // ────────────────────────────────────────────────────────────
    // STEP 1: QUERY ANALYSIS & INTENT CLASSIFICATION
    // ────────────────────────────────────────────────────────────
    const step1Start = Date.now();
    const intent = this.classifyIntent(query);
    const requiresRetrieval = intent !== "GREETING" && intent !== "OFF_TOPIC";

    traces.push({
      step: "QUERY_ANALYSIS",
      timestamp: new Date().toISOString(),
      details: { intent, requiresRetrieval },
      latency_ms: Date.now() - step1Start,
    });

    if (!requiresRetrieval) {
      return {
        query,
        expanded_queries: [query],
        intent,
        requires_retrieval: false,
        citations: [],
        grounded_context: "",
        confidence_score: 1.0,
        confidence_level: "HIGH",
        is_fallback: false,
        suggested_escalation: false,
        traces,
        total_latency_ms: Date.now() - startTime,
      };
    }

    // ────────────────────────────────────────────────────────────
    // STEP 2: BANGLA/BANGLISH QUERY EXPANSION & SUB-QUERIES
    // ────────────────────────────────────────────────────────────
    const step2Start = Date.now();
    const expandedQueries = enableExpansion
      ? this.expandQueryForBanglaCommerce(query)
      : [query];

    traces.push({
      step: "QUERY_EXPANSION",
      timestamp: new Date().toISOString(),
      details: { original: query, expandedQueries },
      latency_ms: Date.now() - step2Start,
    });

    // ────────────────────────────────────────────────────────────
    // STEP 3: PARALLEL HYBRID RETRIEVAL (BM25 + pgvector)
    // ────────────────────────────────────────────────────────────
    const step3Start = Date.now();
    const hybridSearchPromises = expandedQueries.map((subQuery) =>
      HybridSearchService.search(tenantId, subQuery, {
        topK: 15,
        denseLimit: 25,
        sparseLimit: 25,
        onlyChildChunks: true,
      })
    );

    const allSubResults = await Promise.all(hybridSearchPromises);

    // Merge and deduplicate candidates across all sub-queries
    const candidateMap = new Map<string, (typeof allSubResults)[0][0]>();
    for (const subList of allSubResults) {
      for (const cand of subList) {
        if (!candidateMap.has(cand.chunk.id)) {
          candidateMap.set(cand.chunk.id, cand);
        } else {
          // Take higher RRF score if discovered by multiple sub-queries
          const existing = candidateMap.get(cand.chunk.id)!;
          if (cand.rrf_score > existing.rrf_score) {
            candidateMap.set(cand.chunk.id, cand);
          }
        }
      }
    }

    const aggregatedCandidates = Array.from(candidateMap.values());

    traces.push({
      step: "HYBRID_RETRIEVAL",
      timestamp: new Date().toISOString(),
      details: {
        subQueryCount: expandedQueries.length,
        totalUniqueCandidates: aggregatedCandidates.length,
      },
      latency_ms: Date.now() - step3Start,
    });

    // ────────────────────────────────────────────────────────────
    // STEP 4: CROSS-ENCODER RERANKING & PARENT CONTEXT RESOLUTION
    // ────────────────────────────────────────────────────────────
    const step4Start = Date.now();
    const rerankedResults: RerankedChunkResult[] = RerankerService.rerank(
      tenantId,
      query,
      aggregatedCandidates,
      {
        topK,
        minRerankScore: 0.35,
        resolveParentContext: resolveParent,
        deduplicateParents: true,
      }
    );

    traces.push({
      step: "RERANKING",
      timestamp: new Date().toISOString(),
      details: {
        rerankedCount: rerankedResults.length,
        topScore: rerankedResults[0]?.rerank_score || 0,
      },
      latency_ms: Date.now() - step4Start,
    });

    // ────────────────────────────────────────────────────────────
    // STEP 5: CORRECTIVE RAG (CRAG) & CONFIDENCE GATE
    // ────────────────────────────────────────────────────────────
    const step5Start = Date.now();
    const topScore = rerankedResults[0]?.rerank_score || 0;

    let confidenceLevel: "HIGH" | "MODERATE" | "LOW" = "LOW";
    let isFallback = false;
    let suggestedEscalation = false;

    if (topScore >= thresholdHigh) {
      confidenceLevel = "HIGH";
    } else if (topScore >= thresholdLow) {
      confidenceLevel = "MODERATE";
      suggestedEscalation = true;
    } else {
      confidenceLevel = "LOW";
      isFallback = true;
      suggestedEscalation = true;
    }

    traces.push({
      step: "CONFIDENCE_GATE",
      timestamp: new Date().toISOString(),
      details: {
        topScore,
        confidenceLevel,
        isFallback,
        suggestedEscalation,
      },
      latency_ms: Date.now() - step5Start,
    });

    // ────────────────────────────────────────────────────────────
    // STEP 6: CONTEXT ASSEMBLY & CITATION STAMPING
    // ────────────────────────────────────────────────────────────
    const step6Start = Date.now();
    const citations: RetrievalCitation[] = rerankedResults.map((r) => ({
      document_id: r.chunk.document_id,
      document_title: r.chunk.metadata.document_title,
      section: r.chunk.section_heading || r.parent_chunk?.section_heading || "Store Policy",
      chunk_id: r.chunk.id,
      parent_chunk_id: r.chunk.parent_chunk_id,
      version: r.chunk.metadata.version,
      similarity_score: r.rerank_score,
      content_snippet: r.chunk.content,
      parent_content: r.parent_chunk?.content,
    }));

    // Build grounded context string
    let groundedContext = "";
    if (!isFallback && citations.length > 0) {
      groundedContext = rerankedResults
        .map((r, i) => {
          const title = r.chunk.metadata.document_title;
          const section = r.chunk.section_heading || "General";
          const body = r.resolved_content;
          return `[Source ${i + 1}: ${title} > ${section}]\n${body}`;
        })
        .join("\n\n---\n\n");
    }

    traces.push({
      step: "SYNTHESIS",
      timestamp: new Date().toISOString(),
      details: {
        citationCount: citations.length,
        contextLengthChars: groundedContext.length,
      },
      latency_ms: Date.now() - step6Start,
    });

    return {
      query,
      expanded_queries: expandedQueries,
      intent,
      requires_retrieval: true,
      citations,
      grounded_context: groundedContext,
      confidence_score: topScore,
      confidence_level: confidenceLevel,
      is_fallback: isFallback,
      suggested_escalation: suggestedEscalation,
      traces,
      total_latency_ms: Date.now() - startTime,
    };
  }

  /**
   * Classifies user intent to determine query type and retrieval routing.
   */
  private static classifyIntent(query: string): string {
    const q = query.toLowerCase();

    if (/^(hi|hello|hey|assalamu|salam|kemon achen|hlw)\b/i.test(q) && q.length < 25) {
      return "GREETING";
    }
    if (/return|exchange|ferot|badla|replacement|policy|refund/i.test(q)) {
      return "RETURN_EXCHANGE_POLICY";
    }
    if (/delivery|shipping|charge|khoroch|rate|inside dhaka|outside dhaka|courier|steadfast|pathao/i.test(q)) {
      return "SHIPPING_DELIVERY_CHARGE";
    }
    if (/size|measurement|chart|inch|chest|length|fit|size chart/i.test(q)) {
      return "SIZING_FIT_GUIDE";
    }
    if (/payment|bkash|nagad|cod|cash on delivery|advance|advance payment/i.test(q)) {
      return "PAYMENT_TERMS";
    }
    if (/order|track|tracking|parcel|status|kothay/i.test(q)) {
      return "ORDER_INQUIRY";
    }

    return "GENERAL_COMMERCE_POLICY";
  }

  /**
   * Expands colloquial Bangladeshi E-commerce queries into multiple targeted search phrases.
   */
  private static expandQueryForBanglaCommerce(query: string): string[] {
    const q = query.toLowerCase().trim();
    const expansions: Set<string> = new Set([q]);

    // Shipping & Delivery expansions
    if (/delivery|charge|khoroch|pathao|steadfast|dhaka/i.test(q)) {
      expansions.add("delivery charge inside and outside dhaka");
      expansions.add("shipping fees courier charges");
      if (/baire|outside|gram/i.test(q)) {
        expansions.add("outside dhaka delivery fee 120");
      }
      if (/vetore|inside|dhakar moddhe/i.test(q)) {
        expansions.add("inside dhaka delivery charge 60");
      }
    }

    // Return & Exchange expansions
    if (/return|ferot|badla|exchange|refund/i.test(q)) {
      expansions.add("return and exchange policy terms conditions");
      expansions.add("parcel return timeframe delivery refund");
      expansions.add("damaged product exchange guidelines");
    }

    // Size & Fit expansions
    if (/size|chart|measurement|map|fit/i.test(q)) {
      expansions.add("apparel size chart measurement guide");
      expansions.add("chest length waist dimensions inches");
    }

    // Payment & COD expansions
    if (/cod|cash on delivery|bkash|advance|payment/i.test(q)) {
      expansions.add("cash on delivery payment policy");
      expansions.add("advance payment requirements bkash nagad");
    }

    return Array.from(expansions).slice(0, 4);
  }
}
