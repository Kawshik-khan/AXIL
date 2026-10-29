/**
 * CommerceOS: Cross-Encoder Reranker & Parent Context Resolver
 *
 * Implements a zero-external-dependency cross-scoring algorithm that evaluates joint query-document interaction and
 * resolves Child chunks to their Parent contexts.
 *
 * The score is a weighted average of signals that are each in [0, 1], with weights that sum to 1, so it never needs
 * clamping and ties only happen when the evidence really is equal (2026-10-29). The earlier formula added bonuses to a
 * rank-based anchor (~0.5 for every top-10 candidate, relevant or not) and clamped at 1.0: many chunks scored exactly
 * 1.0, and a question no document answers still cleared the 0.6 cutoff.
 */

import { db } from "@/infrastructure/db";
import { HybridSearchResult, RerankedChunkResult } from "@/types/ai";
import { BM25Service } from "./bm25.service";

export interface RerankerOptions {
  topK?: number;                   // Final number of reranked items to return (default: 5)
  minRerankScore?: number;         // Threshold cutoff for reranker (default: RELEVANCE_FLOOR)
  resolveParentContext?: boolean;  // Automatically resolve child to parent chunk (default: true)
  deduplicateParents?: boolean;    // Deduplicate sibling children sharing the same parent (default: true)
  queryVariants?: string[];        // Equivalents of the question (e.g. its Bangla→English sub-query), scored in full
  // Topic phrases from query expansion ("return and exchange policy terms conditions"). They bridge Banglish words to
  // English policy text, so they still count, but discounted: at full weight they rank a document's title section
  // above the section that answers, because the phrase matches every title word.
  expansionVariants?: string[];
}

/** Weights of the composite score; they sum to 1. */
export const RERANK_WEIGHTS = {
  vector: 0.35,   // dense similarity: the only signal that measures meaning
  bm25: 0.2,      // sparse match strength
  lexical: 0.25,  // share of the question's words in the chunk, its heading or its document title
  heading: 0.15,  // question words in the section heading (title at half weight): merchants title each topic
  phrase: 0.05,   // the question, or its word pairs, verbatim in the chunk
} as const;

/**
 * A document's title block (title, store name, "last updated") answers nothing once the document has topic sections,
 * yet it shares every title word with the question. Short title-only sections keep this share of their score.
 */
const TITLE_BLOCK_FACTOR = 0.5;
const TITLE_BLOCK_MAX_CHARS = 160;

/** A question word in the document title counts this much toward the heading signal (a section heading counts 1). */
const TITLE_MATCH_WEIGHT = 0.5;

/**
 * Cutoffs on the weighted scale. Dense similarity is 35% of the score, and a real embedding model gives every pair of
 * texts a higher cosine than the offline embedders, so each kind has its own cutoffs:
 * - Offline (hashing embedder, demo mock; tests/agent-evals/section-eval.ts, 2026-10-29): every answerable question's
 *   best section scored >= 0.35, and 4 of 5 questions no document answers stayed below 0.30.
 * - Real (Gemini gemini-embedding-001, the same 8 documents on production, 2026-10-30): answerable questions' best
 *   section scored 0.54-0.83; questions no document answers scored 0.32-0.39, except "international shipping" (0.54,
 *   against the delivery charges). At 0.30 they all released evidence.
 * `low`: below it no evidence is released (the answer is "I don't know"); `high`: at or above it, HIGH confidence.
 */
export const RELEVANCE_OFFLINE = { low: 0.3, high: 0.5 } as const;
export const RELEVANCE_REAL = { low: 0.45, high: 0.65 } as const;
export const RELEVANCE_FLOOR = 0.2; // reranker's own cutoff for candidates kept at all

/**
 * The cutoffs for the embedder that made the vectors, by its stamp (`EmbeddingService.currentStamp()`): a real
 * provider is stamped "<provider>/<model>"; the offline embedders by a bare name ("local-hash-embedder",
 * "MockIntelligentProvider").
 */
export function relevanceCutoffs(embeddingModel: string): { low: number; high: number } {
  return embeddingModel.includes("/") ? RELEVANCE_REAL : RELEVANCE_OFFLINE;
}

/** How much an expansion phrase counts against the question itself. */
export const EXPANSION_DISCOUNT = 0.6;

/** BM25 is unbounded; s / (s + K) maps it to [0, 1) with half weight at K. */
const BM25_HALF_SATURATION = 6;

export interface RerankSignals {
  vector: number;
  bm25: number;
  lexical: number;
  heading: number;
  phrase: number;
  score: number;
}

interface Variant { text: string; tokens: string[]; weight: number }

// BM25 drops these as stop words, but "what is NOT covered" must not rank the same as "what is covered"
const NEGATIONS = /\b(not|no|never|cannot|without)\b/gi;

// Question and filler words name no topic; left in, "what is covered" matches "what is NOT covered" as well as its own
// section. English, Banglish and Bangla.
const QUESTION_WORDS = new Set([
  "what", "which", "who", "whom", "whose", "does", "do", "did", "i", "me", "my", "you", "your", "we", "our", "it", "be",
  "much", "many", "please", "kon", "ki", "kivabe", "kibhabe", "kokhon", "kothay", "keno", "amar", "amake", "apnara",
  "apnader", "ache", "achhe", "e", "er", "te", "korbo", "nibo", "pabo", "jabe", "kora", "korte", "dite", "thake",
  "কিভাবে", "কীভাবে", "কখন", "কোথায়", "কেন", "কত", "আমার", "আমি", "করবো", "যাবে", "পাবো",
]);

/** Distinct topic words: a repeated word ("delivery delivery charge") must not count twice toward a heading match. */
export function tokensOf(text: string): string[] {
  const words = [...BM25Service.tokenize(text), ...(text.match(NEGATIONS) || []).map((t) => t.toLowerCase())];
  return [...new Set(words.filter((w) => !QUESTION_WORDS.has(w)))];
}

function tokenMatches(token: string, text: string): boolean {
  // Short words and numbers match whole words only: "not" is not in "cannot be", "38" is not in "138"
  if (token.length <= 3) return new RegExp(`(^|[^a-z0-9\\u0980-\\u09ff])${token}($|[^a-z0-9\\u0980-\\u09ff])`).test(text);
  // Root stem handling (e.g. dhakar -> dhaka, washing -> wash; baire -> outside via concepts below)
  const roots = [
    token.endsWith("r") || token.endsWith("e") ? token.slice(0, -1) : token,
    token.length > 5 && token.endsWith("ing") ? token.slice(0, -3) : token,
    token.length > 4 && /(es|ed)$/.test(token) ? token.slice(0, -2) : token,
    token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token,
  ];
  return text.includes(token) || roots.some((root) => root.length >= 3 && text.includes(root));
}

function conceptMatches(token: string, text: string): boolean {
  return (token === "baire" && text.includes("outside")) ||
    (token === "vetore" && text.includes("inside")) ||
    (token === "ferot" && text.includes("return")) ||
    (token === "din" && text.includes("day"));
}

/** A heading made only of the document title's words ("RETURN & EXCHANGE POLICY" in "01 return exchange policy"). */
function isTitleLike(heading: string, title: string): boolean {
  const headingTokens = BM25Service.tokenize(heading);
  const titleTokens = new Set(BM25Service.tokenize(title));
  return headingTokens.length > 0 && headingTokens.every((t) => titleTokens.has(t));
}

/**
 * Title blocks, by document: the first section of a document that has more than one section, when its heading only
 * repeats the title (the "# Title / Store: … / Last updated: …" block merchants put on top). A one-section document,
 * or a first section with its own topic ("## Returns"), is content, not a title block.
 */
function findTitleBlocks(tenantId: string, candidates: HybridSearchResult[]): Map<string, string> {
  const titleBlocks = new Map<string, string>();
  for (const documentId of new Set(candidates.map((cand) => cand.chunk.document_id))) {
    const sample = candidates.find((cand) => cand.chunk.document_id === documentId)!.chunk;
    const sections = db.getKnowledgeChunks(tenantId, documentId)
      .filter((chunk) => chunk.metadata.version === sample.metadata.version && chunk.chunk_type === "PARENT")
      .sort((a, b) => a.chunk_index - b.chunk_index);
    const first = sections[0]?.section_heading || "";
    if (new Set(sections.map((chunk) => chunk.section_heading || "")).size > 1 && isTitleLike(first, sample.metadata.document_title || "")) {
      titleBlocks.set(documentId, first);
    }
  }
  return titleBlocks;
}

/** `titleBlocks`: from findTitleBlocks; a chunk of a title block gets no heading credit and, when short, half its score. */
export function scoreCandidate(cand: HybridSearchResult, variants: Variant[], titleBlocks?: ReadonlyMap<string, string>): RerankSignals {
  const chunk = cand.chunk;
  const content = chunk.content.toLowerCase();
  const inTitleBlock = titleBlocks?.get(chunk.document_id) === (chunk.section_heading || "");
  const heading = inTitleBlock ? "" : (chunk.section_heading || "").toLowerCase();
  const title = (chunk.metadata.document_title || "").toLowerCase();

  let lexical = 0;
  let headingScore = 0;
  let phrase = 0;
  for (const variant of variants) {
    let inContent = 0;
    let inHeading = 0;
    let inTitle = 0;
    for (const qt of variant.tokens) {
      // A chunk carries its heading and its document's title: "Payment Methods" > "We accept bKash" answers "payment methods"
      if (tokenMatches(qt, content) || (heading && tokenMatches(qt, heading)) || (title && tokenMatches(qt, title)) || conceptMatches(qt, content)) inContent++;
      if (heading && (tokenMatches(qt, heading) || conceptMatches(qt, heading))) inHeading++;
      if (title && (tokenMatches(qt, title) || conceptMatches(qt, title))) inTitle++;
    }
    lexical = Math.max(lexical, variant.weight * (inContent / variant.tokens.length));
    // The section heading picks the section; the document title picks the document, at half weight
    const share = (n: number) => Math.min(1, n / Math.min(variant.tokens.length, 3));
    headingScore = Math.max(headingScore, variant.weight * Math.max(share(inHeading), TITLE_MATCH_WEIGHT * share(inTitle)));

    let variantPhrase = 0;
    if (variant.text.length > 5 && content.includes(variant.text)) {
      variantPhrase = 1;
    } else if (variant.tokens.length >= 2) {
      let bigrams = 0;
      for (let i = 0; i < variant.tokens.length - 1; i++) {
        if (content.includes(`${variant.tokens[i]} ${variant.tokens[i + 1]}`)) bigrams++;
      }
      variantPhrase = Math.min(1, bigrams / 2);
    }
    phrase = Math.max(phrase, variant.weight * variantPhrase);
  }

  const vector = Math.min(1, Math.max(0, cand.vector_similarity ?? 0));
  const bm25Raw = Math.max(0, cand.bm25_score ?? 0);
  const bm25 = bm25Raw / (bm25Raw + BM25_HALF_SATURATION);

  const titleBlock = inTitleBlock && chunk.content.trim().length <= TITLE_BLOCK_MAX_CHARS;
  const score = (titleBlock ? TITLE_BLOCK_FACTOR : 1) * (
    RERANK_WEIGHTS.vector * vector +
    RERANK_WEIGHTS.bm25 * bm25 +
    RERANK_WEIGHTS.lexical * lexical +
    RERANK_WEIGHTS.heading * headingScore +
    RERANK_WEIGHTS.phrase * phrase);

  return { vector, bm25, lexical, heading: headingScore, phrase, score: Number(score.toFixed(4)) };
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
    const minScore = options.minRerankScore !== undefined ? options.minRerankScore : RELEVANCE_FLOOR;
    const resolveParent = options.resolveParentContext !== false;
    const deduplicateParents = options.deduplicateParents !== false;

    const primary = Array.from(new Set([query, ...(options.queryVariants || [])].map((value) => value.trim().toLowerCase()).filter(Boolean)));
    const expansions = Array.from(new Set((options.expansionVariants || []).map((value) => value.trim().toLowerCase())))
      .filter((value) => value && !primary.includes(value));
    const variants: Variant[] = [
      ...primary.map((text) => ({ text, tokens: tokensOf(text), weight: 1 })),
      ...expansions.map((text) => ({ text, tokens: tokensOf(text), weight: EXPANSION_DISCOUNT })),
    ].filter((variant) => variant.tokens.length > 0);

    // 1. Cross-Score each candidate
    const scoredList: Array<{
      candidate: HybridSearchResult;
      rerankScore: number;
    }> = [];

    const titleBlocks = findTitleBlocks(tenantId, candidates);
    for (const cand of candidates) {
      const { score } = scoreCandidate(cand, variants, titleBlocks);
      if (score >= minScore) {
        scoredList.push({ candidate: cand, rerankScore: score });
      }
    }

    // 2. Sort by rerank score descending; the fused rank breaks exact ties
    scoredList.sort((a, b) => b.rerankScore - a.rerankScore || b.candidate.rrf_score - a.candidate.rrf_score);

    // 3. Hierarchical Parent Context Resolution & Sibling Deduplication
    const results: RerankedChunkResult[] = [];
    const seenParentIds = new Set<string>();

    for (const item of scoredList) {
      const chunk = item.candidate.chunk;
      let parentChunk: RerankedChunkResult["parent_chunk"] = undefined;
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
