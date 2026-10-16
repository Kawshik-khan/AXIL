export type RagAnswerability = "ANSWERABLE" | "UNANSWERABLE" | "CONFLICTING" | "STALE" | "RETRIEVAL_UNAVAILABLE";

export interface RagQualityCase {
  id: string;
  query: string;
  language: "bn" | "banglish" | "en" | "mixed";
  category?: string;
  answerability: RagAnswerability;
  relevant_sections: string[];
  critical_facts?: string[];
}

export interface RagQualityObservation {
  case_id: string;
  ranked_sections: string[];
  released_sections?: string[];
  abstained: boolean;
  retrieval_unavailable?: boolean;
  supported_citations?: number;
  total_citations?: number;
  factual_claims?: number;
  supported_claims?: number;
  critical_facts_exact?: boolean;
  cross_tenant_results?: number;
  archived_version_citations?: number;
}

export interface RagQualityMetrics {
  cases: number;
  recall_at_5: number;
  precision_at_5: number;
  mrr: number;
  ndcg_at_5: number;
  answerable_coverage: number;
  correct_abstention_rate: number;
  citation_support_rate: number;
  critical_fact_exactness: number;
  false_answer_count: number;
  cross_tenant_leak_count: number;
  archived_version_citation_count: number;
  provider_unavailable_cases: number;
  citation_precision: number;
  citation_recall: number;
  denominators: { cases: number; answerable_cases: number; abstention_cases: number; critical_facts: number; released_citations: number; citation_qrels: number };
  by_language: Record<string, { cases: number; answerable_cases: number; abstention_cases: number; recall_at_5: number | null; answerable_coverage: number | null; correct_abstention_rate: number | null }>;
  by_category: Record<string, { cases: number; answerable_cases: number; abstention_cases: number; recall_at_5: number | null; answerable_coverage: number | null; correct_abstention_rate: number | null }>;
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 1;
}

function dcg(relevances: number[]): number {
  return relevances.reduce((sum, relevance, index) => sum + ((2 ** relevance - 1) / Math.log2(index + 2)), 0);
}

/** Deterministic qrels evaluator. It computes evidence quality only; it does not grade generated prose. */
export function evaluateRagQuality(cases: RagQualityCase[], observations: RagQualityObservation[], k = 5): RagQualityMetrics {
  if (!Number.isInteger(k) || k < 1 || k > 20) throw new Error("RAG evaluation K must be an integer from 1 to 20.");
  const caseIds = new Set(cases.map((item) => item.id));
  if (caseIds.size !== cases.length) throw new Error("RAG evaluation case IDs must be unique.");
  const byId = new Map(observations.map((item) => [item.case_id, item]));
  if (byId.size !== observations.length || observations.some((item) => !caseIds.has(item.case_id))) {
    throw new Error("RAG observations must contain unique IDs that exist in the evaluation set.");
  }
  if (observations.length !== cases.length) throw new Error("Every RAG case must have exactly one observation.");

  let recallSum = 0, precisionSum = 0, reciprocalRankSum = 0, ndcgSum = 0;
  let answerable = 0, covered = 0, abstainExpected = 0, abstainCorrect = 0;
  let supportedCitations = 0, totalCitations = 0, citationRecallHits = 0, citationRecallTargets = 0;
  let factualClaims = 0, supportedClaims = 0, criticalTotal = 0, criticalExact = 0;
  let falseAnswers = 0, crossTenant = 0, archived = 0, providerUnavailable = 0;

  for (const item of cases) {
    const observed = byId.get(item.id)!;
    const relevant = new Set(item.relevant_sections);
    const ranked = observed.ranked_sections.slice(0, k);
    const hits = ranked.filter((section) => relevant.has(section)).length;
    const canAnswer = item.answerability === "ANSWERABLE";
    const mustAbstain = item.answerability === "UNANSWERABLE" || item.answerability === "CONFLICTING" || item.answerability === "STALE";
    if (canAnswer) {
      answerable++;
      if (!observed.abstained && hits > 0) covered++;
      recallSum += ratio(new Set(ranked.filter((section) => relevant.has(section))).size, relevant.size);
      precisionSum += ratio(hits, k);
      const first = ranked.findIndex((section) => relevant.has(section));
      if (first >= 0) reciprocalRankSum += 1 / (first + 1);
      const gains = ranked.map((section) => relevant.has(section) ? 2 : 0);
      const ideal = Array.from({ length: Math.min(relevant.size, k) }, () => 2);
      ndcgSum += ratio(dcg(gains), dcg(ideal));
    }
    if (mustAbstain) {
      abstainExpected++;
      if (observed.abstained) abstainCorrect++;
      else falseAnswers++;
    }
    if (observed.retrieval_unavailable || item.answerability === "RETRIEVAL_UNAVAILABLE") providerUnavailable++;
    supportedCitations += observed.supported_citations ?? 0;
    totalCitations += observed.total_citations ?? observed.supported_citations ?? 0;
    if (canAnswer) {
      citationRecallHits += Math.min(new Set((observed.released_sections || []).filter((section) => relevant.has(section))).size, relevant.size);
      citationRecallTargets += relevant.size;
    }
    factualClaims += observed.factual_claims ?? 0;
    supportedClaims += observed.supported_claims ?? 0;
    if (item.critical_facts?.length) {
      criticalTotal += item.critical_facts.length;
      if (observed.critical_facts_exact) criticalExact += item.critical_facts.length;
    }
    crossTenant += observed.cross_tenant_results ?? 0;
    archived += observed.archived_version_citations ?? 0;
  }

  const byLanguage: RagQualityMetrics["by_language"] = {};
  for (const language of Array.from(new Set(cases.map((item) => item.language)))) {
    const languageCases = cases.filter((item) => item.language === language);
    const languageAnswerable = languageCases.filter((item) => item.answerability === "ANSWERABLE");
    const languageAbstainable = languageCases.filter((item) => item.answerability === "UNANSWERABLE" || item.answerability === "CONFLICTING" || item.answerability === "STALE");
    const languageRecall = languageAnswerable.map((item) => {
      const ranked = byId.get(item.id)!.ranked_sections.slice(0, k);
      return ratio(new Set(ranked.filter((section) => item.relevant_sections.includes(section))).size, new Set(item.relevant_sections).size);
    });
    byLanguage[language] = {
      cases: languageCases.length,
      answerable_cases: languageAnswerable.length,
      abstention_cases: languageAbstainable.length,
      recall_at_5: languageRecall.length ? Number((languageRecall.reduce((sum, value) => sum + value, 0) / languageRecall.length).toFixed(4)) : null,
      answerable_coverage: languageAnswerable.length ? ratio(languageAnswerable.filter((item) => {
        const observation = byId.get(item.id)!;
        return !observation.abstained && observation.ranked_sections.slice(0, k).some((section) => item.relevant_sections.includes(section));
      }).length, languageAnswerable.length) : null,
      correct_abstention_rate: languageAbstainable.length ? ratio(languageAbstainable.filter((item) => byId.get(item.id)!.abstained).length, languageAbstainable.length) : null,
    };
  }

  const byCategory: RagQualityMetrics["by_category"] = {};
  const categories = Array.from(new Set(cases.map((item) => item.category).filter((value): value is string => Boolean(value))));
  for (const category of categories) {
    const categoryCases = cases.filter((item) => item.category === category);
    const categoryAnswerable = categoryCases.filter((item) => item.answerability === "ANSWERABLE");
    const categoryAbstainable = categoryCases.filter((item) => item.answerability === "UNANSWERABLE" || item.answerability === "CONFLICTING" || item.answerability === "STALE");
    const categoryRecall = categoryAnswerable.map((item) => {
      const ranked = byId.get(item.id)!.ranked_sections.slice(0, k);
      return ratio(new Set(ranked.filter((section) => item.relevant_sections.includes(section))).size, new Set(item.relevant_sections).size);
    });
    byCategory[category] = {
      cases: categoryCases.length,
      answerable_cases: categoryAnswerable.length,
      abstention_cases: categoryAbstainable.length,
      recall_at_5: categoryRecall.length ? Number((categoryRecall.reduce((sum, value) => sum + value, 0) / categoryRecall.length).toFixed(4)) : null,
      answerable_coverage: categoryAnswerable.length ? ratio(categoryAnswerable.filter((item) => {
        const observed = byId.get(item.id)!;
        return !observed.abstained && observed.ranked_sections.slice(0, k).some((section) => item.relevant_sections.includes(section));
      }).length, categoryAnswerable.length) : null,
      correct_abstention_rate: categoryAbstainable.length ? ratio(categoryAbstainable.filter((item) => byId.get(item.id)!.abstained).length, categoryAbstainable.length) : null,
    };
  }

  return {
    cases: cases.length,
    recall_at_5: ratio(recallSum, answerable),
    precision_at_5: ratio(precisionSum, answerable),
    mrr: ratio(reciprocalRankSum, answerable),
    ndcg_at_5: ratio(ndcgSum, answerable),
    answerable_coverage: ratio(covered, answerable),
    correct_abstention_rate: ratio(abstainCorrect, abstainExpected),
    citation_support_rate: ratio(supportedClaims, factualClaims),
    critical_fact_exactness: ratio(criticalExact, criticalTotal),
    false_answer_count: falseAnswers,
    cross_tenant_leak_count: crossTenant,
    archived_version_citation_count: archived,
    provider_unavailable_cases: providerUnavailable,
    denominators: {
      cases: cases.length,
      answerable_cases: answerable,
      abstention_cases: abstainExpected,
      critical_facts: criticalTotal,
      released_citations: totalCitations,
      citation_qrels: citationRecallTargets,
    },
    citation_precision: ratio(supportedCitations, totalCitations),
    citation_recall: ratio(citationRecallHits, citationRecallTargets),
    by_language: byLanguage,
    by_category: byCategory,
  };
}
