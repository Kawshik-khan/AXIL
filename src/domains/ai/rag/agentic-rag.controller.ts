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
import { EXPANSION_DISCOUNT, RELEVANCE_FLOOR, RELEVANCE_HIGH, RELEVANCE_LOW, RerankerService } from "./reranker.service";

/**
 * Declarative Intent Rule for RAG Query Classification.
 */
export interface RagIntentRule {
  readonly intent: string;
  readonly matches: (query: string, normalizedQuery: string) => boolean;
  readonly description?: string;
}

export interface AgenticRagControllerOptions {
  topK?: number; // Number of top citations to retrieve (default: 3)
  confidenceThresholdHigh?: number; // High confidence cutoff (default: RELEVANCE_HIGH)
  confidenceThresholdLow?: number; // Minimum confidence cutoff (default: RELEVANCE_LOW)
  enableQueryExpansion?: boolean; // Expand Banglish/Bangla terms (default: true)
  resolveParentContext?: boolean; // Expand child to parent chunk (default: true)
  minRerankScore?: number; // Reranker cutoff (default RELEVANCE_FLOOR); the customer agent passes 0 and decides relevance itself (FX-82)
  rerankTopK?: number; // Candidates kept after reranking (default: topK)
  customIntentRules?: readonly RagIntentRule[]; // Optional domain- or tenant-specific intent rules evaluated with priority
  // Rerank against the question and its Bangla→English sub-query only. The topic phrases from expansion still widen
  // retrieval, but in ranking they let any document sharing their keywords outrank the one that answers (FX-82)
  rerankOnTranslationsOnly?: boolean;
}

/**
 * Bangla-script policy words → English (FX-82): a deterministic sub-query, so a Bangla question also matches English
 * policy text. No LLM, no numbers: amounts come from tools, never from retrieval hints.
 */
const BANGLA_POLICY_TERMS: Array<[RegExp, string]> = [
  [/ডেলিভারি|ডেলিভারী|পৌঁছাবে|পাঠাবেন|কুরিয়ার/u, "delivery"],
  [/চার্জ|খরচ|ফি(?=[\s।?,!]|$)/u, "delivery charge"], // \b doesn't work next to Bangla letters
  [/ঢাকার? বাইরে|বাইরে/u, "outside Dhaka"],
  [/ঢাকার? (?:ভিতরে|মধ্যে)|ঢাকায়/u, "inside Dhaka"],
  [/ফেরত|রিটার্ন|ফেরৎ/u, "return"],
  [/বদল|এক্সচেঞ্জ|পরিবর্তন/u, "exchange"],
  [/রিফান্ড|টাকা ফেরত/u, "refund"],
  [/সাইজ|মাপ/u, "size"],
  [/বিকাশ/u, "bKash payment"],
  [/নগদ/u, "Nagad payment"],
  [/ক্যাশ অন ডেলিভারি|হাতে হাতে|পণ্য হাতে পেয়ে/u, "cash on delivery"],
  [/অগ্রিম|এডভান্স|অ্যাডভান্স/u, "advance payment"],
  [/সময়|কতদিন|কত দিন|কবে/u, "delivery time days"],
  [/খোলা|অফিস সময়|সাপোর্ট|উত্তর দেন|রিপ্লাই|শুক্রবার/u, "support hours team replies"],
  [/নষ্ট|ভাঙা|ছেঁড়া|ভুল পণ্য/u, "damaged product exchange"],
];

// ────────────────────────────────────────────────────────────
// PRE-COMPILED INTENT PATTERNS & FUNCTIONAL COMBINATORS
// ────────────────────────────────────────────────────────────

/**
 * Fast O(M + N) conjunction matcher: verifies that ALL provided patterns match
 * in any order without expensive regex branch alternation or catastrophic backtracking.
 */
export const matchAll = (...patterns: readonly RegExp[]) => {
  return (_raw: string, norm: string): boolean =>
    patterns.every((pattern) => pattern.test(norm));
};

/**
 * Fast pattern matcher: verifies if the pattern matches the normalized query.
 */
export const matchAny = (pattern: RegExp) => {
  return (_raw: string, norm: string): boolean => pattern.test(norm);
};

const RE_GREETING = /^(hi|hello|hey|assalamu|salam|kemon achen|hlw)\b/i;
const RE_OFF_TOPIC =
  /\b(weather|rain|raining|forecast)\b|আবহাওয়া|আবহাওয়া|বৃষ্টি|বৃষ্টিপাত/i;

// Live status entity & attribute matchers (conjunction: linear O(M + N) check without backtracking)
const RE_PAYMENT_ENTITY = /payment|পেমেন্ট|বিকাশ|নগদ|ট্রানজেকশন/i;
const RE_PAYMENT_STATUS_ATTRIBUTES =
  /success|successful|succeeded|failed|status|confirmed|সফল|হয়েছে|হয়েছে|কনফার্ম|স্ট্যাটাস/i;

const RE_ORDER_ENTITY = /order|অর্ডার/i;
const RE_ORDER_TRACKING_ATTRIBUTES =
  /where|status|track|tracking|কোথায়|কোথায়|অবস্থা|ট্র্যাক/i;

const RE_STOCK_ENTITY = /stock|inventory|স্টক|মজুত/i;
const RE_STOCK_AVAILABILITY_ATTRIBUTES =
  /current|available|remaining|today|এখন|বর্তমান|কত|আছে/i;

const RE_DISCOUNT_ENTITY = /discount|offer|ছাড়|ছাড়|ডিসকাউন্ট/i;
const RE_DISCOUNT_ELIGIBILITY_ATTRIBUTES =
  /approved|eligible|আমার জন্য|পাবো|পাব কি/i;

// Policy & Store informational matchers
const RE_RETURN_POLICY =
  /return|exchange|ferot|badla|replacement|policy|refund|ফেরত|রিটার্ন|বদল|এক্সচেঞ্জ/i;

const RE_SHIPPING_TERMS =
  /delivery|shipping|charge|fee|khoroch|rate|inside dhaka|outside dhaka|courier|steadfast|pathao|ডেলিভারি|কুরিয়ার|কুরিয়ার|খরচ|চার্জ|ঢাকা.*(?:বাইরে|ভিতরে)|(?:বাইরে|ভিতরে).*ঢাকা/i;

const RE_SIZING_GUIDE =
  /size|measurement|chart|inch|chest|length|fit|size chart|সাইজ|মাপ|বুক|লম্বা/i;

const RE_PAYMENT_TERMS =
  /payment|bkash|nagad|cod|cash on delivery|advance|advance payment|পেমেন্ট|বিকাশ|নগদ/i;

const RE_ORDER_INQUIRY =
  /order|track|tracking|parcel|status|kothay|অর্ডার|পার্সেল|কোথায়|কোথায়/i;

export const DEFAULT_INTENT_RULES: readonly RagIntentRule[] = Object.freeze([
  {
    intent: "GREETING",
    description: "Initial conversational greetings under 25 chars",
    matches: (_raw, norm) => norm.length < 25 && RE_GREETING.test(norm),
  },
  {
    intent: "OFF_TOPIC",
    description: "Weather or general chit-chat outside store commerce scope",
    matches: matchAny(RE_OFF_TOPIC),
  },
  {
    intent: "LIVE_PAYMENT_STATUS",
    description:
      "Transactional payment confirmation / failure checks requiring live DB lookup",
    matches: matchAll(RE_PAYMENT_ENTITY, RE_PAYMENT_STATUS_ATTRIBUTES),
  },
  {
    intent: "LIVE_ORDER_STATUS",
    description:
      "Live package tracking / delivery status inquiries requiring order DB lookup",
    matches: matchAll(RE_ORDER_ENTITY, RE_ORDER_TRACKING_ATTRIBUTES),
  },
  {
    intent: "LIVE_STOCK_STATUS",
    description:
      "Real-time SKU inventory checks requiring live warehouse lookup",
    matches: matchAll(RE_STOCK_ENTITY, RE_STOCK_AVAILABILITY_ATTRIBUTES),
  },
  {
    intent: "PERSONALIZED_DISCOUNT",
    description: "Customer-specific discount eligibility inquiries",
    matches: matchAll(RE_DISCOUNT_ENTITY, RE_DISCOUNT_ELIGIBILITY_ATTRIBUTES),
  },
  {
    intent: "RETURN_EXCHANGE_POLICY",
    description: "Store return, replacement, refund, and exchange guidelines",
    matches: matchAny(RE_RETURN_POLICY),
  },
  {
    intent: "SHIPPING_DELIVERY_CHARGE",
    description:
      "Courier delivery rates, timelines, and zone fees (Dhaka inside/outside)",
    matches: matchAny(RE_SHIPPING_TERMS),
  },
  {
    intent: "SIZING_FIT_GUIDE",
    description:
      "Apparel measurement charts, chest, length, and fitting advice",
    matches: matchAny(RE_SIZING_GUIDE),
  },
  {
    intent: "PAYMENT_TERMS",
    description: "Payment methods, COD availability, and advance requirements",
    matches: matchAny(RE_PAYMENT_TERMS),
  },
  {
    intent: "ORDER_INQUIRY",
    description: "General order guidance or unparsed tracking queries",
    matches: matchAny(RE_ORDER_INQUIRY),
  },
]);

export function banglaSubQuery(query: string): string | undefined {
  if (!/[\u0980-\u09FF]/u.test(query)) return undefined;
  const terms = BANGLA_POLICY_TERMS.filter(([re]) => re.test(query)).map(
    ([, en]) => en,
  );
  return terms.length ? [...new Set(terms)].join(" ") : undefined;
}

export class AgenticRagController {
  private static readonly CONFIDENCE_HIGH = RELEVANCE_HIGH;
  private static readonly CONFIDENCE_LOW = RELEVANCE_LOW;

  /**
   * Main entrypoint for Agentic RAG execution loop.
   */
  public static async execute(
    tenantId: string,
    query: string,
    options: AgenticRagControllerOptions = {},
  ): Promise<AgenticRagResult> {
    const startTime = Date.now();
    const traces: AgenticRagStepTrace[] = [];

    const topK = options.topK ?? 3;
    const thresholdLow = options.confidenceThresholdLow ?? this.CONFIDENCE_LOW;
    // A caller's stricter cutoff lifts the default HIGH bar with it instead of making the options invalid
    const thresholdHigh =
      options.confidenceThresholdHigh ?? Math.max(this.CONFIDENCE_HIGH, thresholdLow);
    if (
      !Number.isInteger(topK) ||
      topK < 1 ||
      topK > 20 ||
      !Number.isFinite(thresholdHigh) ||
      !Number.isFinite(thresholdLow) ||
      thresholdLow < 0 ||
      thresholdHigh > 1 ||
      thresholdLow > thresholdHigh
    ) {
      throw new Error("Invalid RAG controller options.");
    }
    const enableExpansion = options.enableQueryExpansion !== false;
    const resolveParent = options.resolveParentContext !== false;

    // ────────────────────────────────────────────────────────────
    // STEP 1: QUERY ANALYSIS & INTENT CLASSIFICATION
    // ────────────────────────────────────────────────────────────
    const step1Start = Date.now();
    const intent = this.classifyIntent(query, options.customIntentRules);
    const isGreeting = intent === "GREETING";
    const cannotAnswerFromKnowledge =
      intent === "OFF_TOPIC" ||
      intent.startsWith("LIVE_") ||
      intent === "PERSONALIZED_DISCOUNT";
    const requiresRetrieval = !isGreeting && !cannotAnswerFromKnowledge;

    traces.push({
      step: "QUERY_ANALYSIS",
      timestamp: new Date().toISOString(),
      details: { intent, requiresRetrieval },
      latency_ms: Date.now() - step1Start,
    });

    if (!requiresRetrieval) {
      const mustAbstain = cannotAnswerFromKnowledge;
      return {
        query,
        expanded_queries: [query],
        intent,
        requires_retrieval: false,
        citations: [],
        grounded_context: "",
        confidence_score: mustAbstain ? 0 : 1.0,
        confidence_level: mustAbstain ? "LOW" : "HIGH",
        is_fallback: mustAbstain,
        suggested_escalation:
          intent.startsWith("LIVE_") || intent === "PERSONALIZED_DISCOUNT",
        retrieval_outcome: mustAbstain ? "UNKNOWN_NO_MATCH" : undefined,
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
      HybridSearchService.searchWithDiagnostics(tenantId, subQuery, {
        topK: 15,
        denseLimit: 25,
        sparseLimit: 25,
        onlyChildChunks: true,
      }),
    );

    const allSubResults = await Promise.all(hybridSearchPromises);

    // The question and its Bangla→English sub-query are scored in full; topic phrases from expansion widen retrieval
    // but their match strength is discounted, or a document's title section outranks the section that answers
    const bnSubQuery = banglaSubQuery(query);
    const primaryQueries = new Set(
      [expandedQueries[0], bnSubQuery].filter((v): v is string => Boolean(v)),
    );
    const strength = (subQuery: string, value: number | undefined) =>
      value === undefined
        ? undefined
        : primaryQueries.has(subQuery)
          ? value
          : value * EXPANSION_DISCOUNT;
    const maxOf = (a: number | undefined, b: number | undefined) =>
      a === undefined ? b : b === undefined ? a : Math.max(a, b);

    // Merge and deduplicate candidates across all sub-queries
    const candidateMap = new Map<
      string,
      (typeof allSubResults)[0]["results"][number]
    >();
    const seenCounts = new Map<string, number>();
    allSubResults.forEach((searchRun, runIndex) => {
      const subQuery = expandedQueries[runIndex];
      for (const found of searchRun.results) {
        const cand = {
          ...found,
          vector_similarity: strength(subQuery, found.vector_similarity),
          bm25_score: strength(subQuery, found.bm25_score),
        };
        if (!candidateMap.has(cand.chunk.id)) {
          candidateMap.set(cand.chunk.id, cand);
          seenCounts.set(cand.chunk.id, 1);
        } else {
          const existing = candidateMap.get(cand.chunk.id)!;
          const count = (seenCounts.get(cand.chunk.id) || 1) + 1;
          const score =
            (existing.rrf_score * (count - 1)) / count + cand.rrf_score / count;
          candidateMap.set(cand.chunk.id, {
            ...existing,
            rrf_score: Number(score.toFixed(5)),
            vector_rank: existing.vector_rank ?? cand.vector_rank,
            vector_similarity: maxOf(existing.vector_similarity, cand.vector_similarity),
            bm25_rank: existing.bm25_rank ?? cand.bm25_rank,
            bm25_score: maxOf(existing.bm25_score, cand.bm25_score),
          });
          seenCounts.set(cand.chunk.id, count);
        }
      }
    });

    const aggregatedCandidates = Array.from(candidateMap.values());

    traces.push({
      step: "HYBRID_RETRIEVAL",
      timestamp: new Date().toISOString(),
      details: {
        subQueryCount: expandedQueries.length,
        totalUniqueCandidates: aggregatedCandidates.length,
        channels: {
          dense: this.summarizeChannel(
            allSubResults.map((run) => run.diagnostics.dense),
          ),
          sparse: this.summarizeChannel(
            allSubResults.map((run) => run.diagnostics.sparse),
          ),
        },
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
        topK: options.rerankTopK ?? topK,
        minRerankScore: options.minRerankScore ?? RELEVANCE_FLOOR,
        resolveParentContext: resolveParent,
        deduplicateParents: true,
        queryVariants: [bnSubQuery].filter((v): v is string => Boolean(v)),
        expansionVariants: options.rerankOnTranslationsOnly
          ? []
          : expandedQueries.filter((v) => !primaryQueries.has(v)),
      },
    );

    traces.push({
      step: "RERANKING",
      timestamp: new Date().toISOString(),
      details: {
        rerankedCount: rerankedResults.length,
        topScore: rerankedResults[0]?.rerank_score || 0,
        // Evaluation/debug manifest only. These remain internal and are not used as answer citations
        // unless the confidence gate releases the corresponding evidence below.
        rankedEvidence: rerankedResults.map((result) => ({
          documentId: result.chunk.document_id,
          chunkId: result.chunk.id,
          version: result.chunk.metadata.version,
          section:
            result.chunk.section_heading ||
            result.parent_chunk?.section_heading ||
            "Store Policy",
          heuristicRelevanceScore: result.rerank_score,
        })),
      },
      latency_ms: Date.now() - step4Start,
    });

    // ────────────────────────────────────────────────────────────
    // STEP 5: CORRECTIVE RAG (CRAG) & CONFIDENCE GATE
    // ────────────────────────────────────────────────────────────
    const step5Start = Date.now();
    const topScore = rerankedResults[0]?.rerank_score || 0;

    let confidenceLevel: "HIGH" | "MODERATE" | "LOW" = "LOW";
    const retrievalUnavailable = allSubResults.every((run) =>
      [run.diagnostics.dense.status, run.diagnostics.sparse.status].every(
        (status) => status === "UNAVAILABLE" || status === "INCOMPATIBLE_INDEX",
      ),
    );
    let isFallback = retrievalUnavailable || topScore < thresholdLow;
    let suggestedEscalation = isFallback;

    if (retrievalUnavailable) {
      confidenceLevel = "LOW";
    } else if (topScore >= thresholdHigh) {
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
        retrievalUnavailable,
      },
      latency_ms: Date.now() - step5Start,
    });

    // A strong top result must not lend its score to weak neighboring chunks. Apply the
    // configured low evidence threshold to every released citation independently.
    const releasedEvidence = isFallback
      ? []
      : rerankedResults.filter((result) => result.rerank_score >= thresholdLow);

    // ────────────────────────────────────────────────────────────
    // STEP 6: CONTEXT ASSEMBLY & CITATION STAMPING
    // ────────────────────────────────────────────────────────────
    const step6Start = Date.now();
    const citations: RetrievalCitation[] = releasedEvidence.map((r) => ({
      document_id: r.chunk.document_id,
      document_title: r.chunk.metadata.document_title,
      section:
        r.chunk.section_heading ||
        r.parent_chunk?.section_heading ||
        "Store Policy",
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
      groundedContext = releasedEvidence
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
        rankedEvidenceCount: rerankedResults.length,
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
      retrieval_outcome: retrievalUnavailable
        ? "RETRIEVAL_UNAVAILABLE"
        : citations.length > 0
          ? "ANSWERABLE_WITH_EVIDENCE"
          : "UNKNOWN_NO_MATCH",
      traces,
      total_latency_ms: Date.now() - startTime,
    };
  }

  private static summarizeChannel(
    items: Array<{
      status: string;
      candidate_count: number;
      latency_ms: number;
      error_code?: string;
    }>,
  ) {
    return {
      statuses: items.map((item) => item.status),
      totalCandidates: items.reduce(
        (sum, item) => sum + item.candidate_count,
        0,
      ),
      latencyMs: items.reduce((sum, item) => sum + item.latency_ms, 0),
      errors: items.flatMap((item) =>
        item.error_code ? [item.error_code] : [],
      ),
    };
  }

  /**
   * Classifies user intent to determine query type and retrieval routing.
   * Functional, dynamic table-driven classifier with pre-compiled matchers and O(1) early exit.
   */
  public static classifyIntent(
    query: string,
    customRules?: readonly RagIntentRule[],
  ): string {
    const raw = query?.trim();
    if (!raw) return "GENERAL_COMMERCE_POLICY";
    const normalized = raw.toLowerCase();

    const rules =
      customRules && customRules.length > 0
        ? [...customRules, ...DEFAULT_INTENT_RULES]
        : DEFAULT_INTENT_RULES;

    const matched = rules.find((rule) => rule.matches(raw, normalized));
    return matched ? matched.intent : "GENERAL_COMMERCE_POLICY";
  }

  /**
   * Expands colloquial Bangladeshi E-commerce queries into multiple targeted search phrases.
   */
  private static expandQueryForBanglaCommerce(query: string): string[] {
    const q = query.toLowerCase().trim();
    const expansions: Set<string> = new Set([q]);

    // Bangla script → English policy words (FX-82)
    const bn = banglaSubQuery(query);
    if (bn) expansions.add(bn);

    // Shipping & Delivery expansions
    if (
      /delivery|shipping|charge|fee|khoroch|pathao|steadfast|courier|parcel|pouch|ডেলিভারি|খরচ|কুরিয়ার|কুরিয়ার|চার্জ|বিতরণ|দিন.*(পার্সেল|কুরিয়ার|কুরিয়ার|পৌঁছ)|ঢাকা.*(বাইরে|ভিতরে|খরচ|চার্জ|ডেলিভারি|কুরিয়ার|কুরিয়ার)/i.test(
        q,
      ) ||
      // "koy din" / "din lage" are time phrases that also appear in return questions ("ferot dite parbo koy diner
      // moddhe"); without a delivery word they must not pull delivery documents ahead of the return policy
      (!/return|ferot|badla|exchange|refund/i.test(q) && /din lage|koy din/i.test(q))
    ) {
      expansions.add("delivery charge inside and outside dhaka");
      expansions.add("shipping fees courier charges");
      if (/baire|outside|gram|বাইরে|বাহিরে|ঢাকার বাইরে/i.test(q)) {
        expansions.add("outside dhaka delivery charge");
      }
      if (/vetore|vitore|inside|dhakar moddhe|ভিতরে|মধ্যে/i.test(q)) {
        expansions.add("inside dhaka delivery charge");
      }
    }

    // Return & Exchange expansions
    if (
      /return|ferot|badla|exchange|refund|রিটার্ন|রিটার্নের|ফেরত|বদল|এক্সচেঞ্জ|এক্সচেঞ্জের/i.test(
        q,
      )
    ) {
      expansions.add("return and exchange policy terms conditions");
      expansions.add("parcel return timeframe delivery refund");
      expansions.add("damaged product exchange guidelines");
    }

    // Size & Fit expansions
    if (/size|chart|measurement|map|fit|সাইজ|মাপ|বুক|লম্বা/i.test(q)) {
      expansions.add("apparel size chart measurement guide");
      expansions.add("chest length waist dimensions inches");
    }

    // Payment & COD expansions
    if (
      /cod|cash on delivery|bkash|advance|payment|বিকাশ|নগদ|পেমেন্ট/i.test(q)
    ) {
      expansions.add("cash on delivery payment policy");
      expansions.add("advance payment requirements bkash nagad");
    }

    // Support hours expansions: "does the team reply at night", "kokhon khola thake" (the policy says "replies every day")
    if (
      /\b(reply|replies|respond|support|office hours|business hours|opening hours|open hours)\b|khola thake|kokhon khola|কখন খোলা|উত্তর দেন|রিপ্লাই|সাপোর্ট/i.test(
        q,
      )
    ) {
      expansions.add("support hours team replies every day");
    }

    // Banglish words with no English look-alike in the policy text (2026-10-29)
    // "koto din" also asks about return windows and guarantees; only without those words is it a delivery-time question
    if (
      /koto din|din lag|kobe pabo|kobe asbe|how long|how many days/i.test(q) &&
      !/return|ferot|badla|exchange|refund|warranty|guarantee|replace/i.test(q)
    ) {
      expansions.add("delivery time days");
    }
    if (/\b(dhub|dhoy|dhoa)\w*|ধো|ধুই|ধুতে/i.test(q)) {
      expansions.add("washing guide wash care");
    }
    if (/\b(dokan|shop|outlet|showroom|branch)\b|দোকান|শোরুম|আউটলেট/i.test(q)) {
      expansions.add("outlet store location");
      if (/khola|open|bondho|close|কখন|খোলা|বন্ধ/i.test(q)) expansions.add("outlet opening hours");
    }

    // Keep a hard upper bound while preserving targeted variants after the original query.
    return Array.from(expansions).slice(0, 7);
  }
}
