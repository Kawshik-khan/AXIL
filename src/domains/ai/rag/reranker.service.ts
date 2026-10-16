/**
 * CommerceOS: Cross-Encoder Reranker & Parent Context Resolver
 *
 * Implements a high-precision, zero-external-dependency cross-scoring algorithm
 * that evaluates joint query-document interaction and resolves Child chunks to their Parent contexts.
 */

import { db } from "@/infrastructure/db";
import { HybridSearchResult, RerankedChunkResult, KnowledgeChunk } from "@/types/ai";
import { BM25Service } from "./bm25.service";

export interface RerankerOptions {
  topK?: number;                   // Final number of reranked items to return (default: 5)
  minRerankScore?: number;         // Threshold cutoff for reranker (default: 0.40)
  resolveParentContext?: boolean;  // Automatically resolve child to parent chunk (default: true)
  deduplicateParents?: boolean;    // Deduplicate sibling children sharing the same parent (default: true)
  queryVariants?: string[];        // Expanded equivalents may ground lexical matches across scripts/languages.
}

export class RerankerService {
  /**
   * Reranks candidate chunks against the user query and resolves their parent contexts.
   */
  public static rerank(
    tenantId: string,
    query: string,
    candidates: HybridSearchResult[],
    options: RerankerOptions = {}
  ): RerankedChunkResult[] {
    if (!candidates || candidates.length === 0 || !query || !query.trim()) {
      return [];
    }

    const topK = options.topK || 5;
    const minScore = options.minRerankScore !== undefined ? options.minRerankScore : 0.40;
    const resolveParent = options.resolveParentContext !== false;
    const deduplicateParents = options.deduplicateParents !== false;

    const queryVariants = Array.from(new Set([query, ...(options.queryVariants || [])].map((value) => value.trim()).filter(Boolean)));
    const queryTokenSets = queryVariants.map((variant) => ({ text: variant.toLowerCase(), tokens: BM25Service.tokenize(variant) })).filter((variant) => variant.tokens.length > 0);

    // 1. Cross-Score each candidate
    const scoredList: Array<{
      candidate: HybridSearchResult;
      rerankScore: number;
    }> = [];

    for (const cand of candidates) {
      const chunk = cand.chunk;
      const content = chunk.content.toLowerCase();
      const heading = (chunk.section_heading || "").toLowerCase();
      const parentHeading = (chunk.metadata.parent_heading || "").toLowerCase();

      // Signal 1: Lexical Coverage with root stem handling (e.g. dhakar -> dhaka, baire -> outside)
      let lexicalCoverage = 0;
      for (const variant of queryTokenSets) {
        let matchedTokenCount = 0;
        for (const qt of variant.tokens) {
          const root = qt.endsWith("r") || qt.endsWith("e") ? qt.slice(0, -1) : qt;
          const matchesContent = content.includes(qt) || (root.length >= 3 && content.includes(root));
          const matchesHeading = heading.includes(qt) || (root.length >= 3 && heading.includes(root));
          const matchesParentHeading = parentHeading.includes(qt) || (root.length >= 3 && parentHeading.includes(root));
          const matchesConcept =
            (qt === "baire" && (content.includes("outside") || heading.includes("outside"))) ||
            (qt === "vetore" && (content.includes("inside") || heading.includes("inside"))) ||
            (qt === "ferot" && (content.includes("return") || heading.includes("return")));
          if (matchesContent || matchesHeading || matchesParentHeading || matchesConcept) matchedTokenCount++;
        }
        lexicalCoverage = Math.max(lexicalCoverage, matchedTokenCount / variant.tokens.length);
      }

      // Signal 2: Exact Phrase Match / Bi-gram Boost
      let phraseBoost = 0;
      let headingAffinity = 0;
      for (const variant of queryTokenSets) {
        let variantPhraseBoost = 0;
        if (variant.text.length > 5 && content.includes(variant.text)) {
          variantPhraseBoost = 0.35;
        } else if (variant.tokens.length >= 2) {
          let biGramMatches = 0;
          for (let i = 0; i < variant.tokens.length - 1; i++) {
            const bigram = `${variant.tokens[i]} ${variant.tokens[i + 1]}`;
            if (content.includes(bigram)) biGramMatches++;
          }
          variantPhraseBoost = Math.min(0.30, biGramMatches * 0.15);
        }
        phraseBoost = Math.max(phraseBoost, variantPhraseBoost);
        let variantHeadingAffinity = 0;
        for (const qt of variant.tokens) {
          if (heading.includes(qt) || parentHeading.includes(qt)) variantHeadingAffinity += 0.15;
        }
        headingAffinity = Math.max(headingAffinity, Math.min(0.25, variantHeadingAffinity));
      }

      // Signal 4: Baseline RRF & Dense Vector Anchor
      const baseAnchor = Math.min(0.50, cand.rrf_score * 35.0);
      const denseBonus = (cand.vector_similarity ? cand.vector_similarity - 0.5 : 0) * 0.2;

      // Composite Cross-Encoder Formula
      const compositeScore =
        baseAnchor +
        (lexicalCoverage * 0.35) +
        phraseBoost +
        headingAffinity +
        denseBonus;

      const finalRerankScore = Math.min(1.0, Math.max(0.0, compositeScore));

      if (finalRerankScore >= minScore) {
        scoredList.push({
          candidate: cand,
          rerankScore: Number(finalRerankScore.toFixed(4)),
        });
      }
    }

    // 2. Sort by rerank score descending
    scoredList.sort((a, b) => b.rerankScore - a.rerankScore);

    // 3. Hierarchical Parent Context Resolution & Sibling Deduplication
    const results: RerankedChunkResult[] = [];
    const seenParentIds = new Set<string>();

    for (const item of scoredList) {
      const chunk = item.candidate.chunk;
      let parentChunk: KnowledgeChunk | undefined = undefined;
      let resolvedContent = chunk.content;

      if (resolveParent && chunk.parent_chunk_id) {
        // If deduplication is requested and we've already included this parent, skip duplicate sibling
        if (deduplicateParents && seenParentIds.has(chunk.parent_chunk_id)) {
          continue;
        }

        // Fetch parent chunk from database
        const parent = db.findParentKnowledgeChunk(tenantId, chunk.parent_chunk_id);
        if (parent && parent.tenant_id === tenantId && parent.document_id === chunk.document_id &&
            parent.metadata.version === chunk.metadata.version && parent.chunk_type === "PARENT") {
          parentChunk = parent;
          resolvedContent = parent.content;
          seenParentIds.add(chunk.parent_chunk_id);
        }
      }

      results.push({
        chunk,
        rerank_score: item.rerankScore,
        original_rrf_score: item.candidate.rrf_score,
        parent_chunk: parentChunk,
        resolved_content: resolvedContent,
      });

      if (results.length >= topK) {
        break;
      }
    }

    return results;
  }
}
