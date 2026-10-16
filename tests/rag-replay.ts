/** Offline/live opt-in RAG MVP replay. Executed through tests/ts-runner.cjs. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { AgenticRagController } from "@/domains/ai/rag/agentic-rag.controller";
import { modelRouter } from "@/domains/ai/providers/model-router";
import { evaluateRagQuality, RagQualityObservation } from "@/domains/ai/eval/rag-evaluation";
import { ragQualityCases, RAG_QUALITY_DATASET_VERSION, validateRagQualityDataset } from "@/domains/ai/eval/rag-quality-dataset";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { isQdrantConfigured } from "@/infrastructure/qdrant/client";

interface RagMvpThresholds {
  schema_version: number;
  dataset_version: string;
  min_cases: number;
  min_recall_at_5: number;
  min_answerable_coverage: number;
  min_citation_support_rate: number;
  min_citation_precision: number;
  min_critical_fact_exactness: number;
  min_correct_abstention_rate: number;
  min_answerable_cases_per_language: number;
  min_language_answerable_coverage: number;
  min_answerable_cases_per_category: number;
  min_category_answerable_coverage: number;
  max_false_answer_count: number;
  max_cross_tenant_leak_count: number;
  max_archived_version_citation_count: number;
}

function traceLatency(result: Awaited<ReturnType<typeof AgenticRagController.execute>>): Record<string, number> {
  return Object.fromEntries(result.traces.map((trace) => [trace.step, trace.latency_ms]));
}

function readThresholds(): RagMvpThresholds {
  const filename = path.join(process.cwd(), "evals", "rag-mvp-thresholds.json");
  const value = JSON.parse(fs.readFileSync(filename, "utf8")) as RagMvpThresholds;
  const numericFields: Array<keyof RagMvpThresholds> = [
    "min_cases", "min_recall_at_5", "min_answerable_coverage", "min_citation_support_rate", "min_citation_precision",
    "min_critical_fact_exactness", "min_correct_abstention_rate", "max_false_answer_count",
    "min_answerable_cases_per_language", "min_language_answerable_coverage", "min_answerable_cases_per_category",
    "min_category_answerable_coverage", "max_cross_tenant_leak_count", "max_archived_version_citation_count",
  ];
  if (value.schema_version !== 1 || numericFields.some((field) => !Number.isFinite(value[field]))) {
    throw new Error("RAG MVP threshold file is invalid.");
  }
  const rates: Array<keyof RagMvpThresholds> = [
    "min_recall_at_5", "min_answerable_coverage", "min_citation_support_rate", "min_citation_precision",
    "min_critical_fact_exactness", "min_correct_abstention_rate", "min_language_answerable_coverage", "min_category_answerable_coverage",
  ];
  const counts: Array<keyof RagMvpThresholds> = [
    "min_cases", "min_answerable_cases_per_language", "min_answerable_cases_per_category",
    "max_false_answer_count", "max_cross_tenant_leak_count", "max_archived_version_citation_count",
  ];
  if (rates.some((field) => Number(value[field]) < 0 || Number(value[field]) > 1) ||
      counts.some((field) => !Number.isInteger(Number(value[field])) || Number(value[field]) < 0) || value.min_cases < 1) {
    throw new Error("RAG MVP thresholds contain out-of-range rates or counts.");
  }
  if (value.dataset_version !== RAG_QUALITY_DATASET_VERSION) throw new Error("RAG threshold dataset version does not match the selected dataset.");
  return value;
}

function revision(): string | null {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

function hasWorkingTreeChanges(): boolean | null {
  try { return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0; }
  catch { return null; }
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

async function main(): Promise<void> {
  const live = process.env.RAG_REPLAY_LIVE === "1";
  const runStartedAt = new Date().toISOString();
  const requestedDataset = process.env.RAG_REPLAY_DATASET || RAG_QUALITY_DATASET_VERSION;
  if (requestedDataset !== RAG_QUALITY_DATASET_VERSION) throw new Error(`Unknown RAG dataset '${requestedDataset}'. Available: ${RAG_QUALITY_DATASET_VERSION}.`);
  if (live) {
    const status = modelRouter.getStatus();
    if (status.mode !== "LIVE" && !status.embedding_provider) throw new Error("Live replay requested but no live embedding provider is configured.");
  } else {
    // Defensive second boundary: the CJS launcher also masks local environment credentials before
    // tests/ts-runner.cjs can load .env.local. This path must never call a live model or Qdrant.
    modelRouter.configure({ ...process.env, AI_DEMO_MODE: "1", LLM_BASE_URL: undefined, LLM_FALLBACK_BASE_URL: undefined, LLM_EMBEDDING_BASE_URL: undefined });
    if (modelRouter.getMode() !== "DEMO" || isQdrantConfigured()) throw new Error("Offline replay refused to start with a live provider or Qdrant configured.");
  }

  validateRagQualityDataset(ragQualityCases);
  const thresholds = readThresholds();
  db.clearAllForTesting();
  const stamp = Date.now();
  const tenantA = await AuthService.registerTenantWithOwner({
    workspaceName: `RAG Replay ${stamp}`, name: "RAG Replay Owner", email: `rag-replay-${stamp}@example.com`,
    password: "SecurePassword2026!", currency: "BDT",
  });
  const tenantB = await AuthService.registerTenantWithOwner({
    workspaceName: `RAG Replay Isolation ${stamp}`, name: "RAG Isolation Owner", email: `rag-isolation-${stamp}@example.com`,
    password: "SecurePassword2026!", currency: "BDT",
  });
  const context: RequestContext = {
    requestId: `req_rag_replay_${stamp}`, traceId: `trace_rag_replay_${stamp}`,
    user: { id: tenantA.user.id, email: tenantA.user.email, name: tenantA.user.name, status: "ACTIVE" },
    tenant: { id: tenantA.tenant.id, name: tenantA.tenant.name, slug: tenantA.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER", permissions: Object.values(PERMISSIONS), timestamp: new Date().toISOString(),
  };

  const replayCorpus = `# Store Shipping & Delivery Charges

We deliver nationwide across all 64 districts in Bangladesh through Steadfast Courier and Pathao Express.

### Delivery Charges & Timelines
| Destination | Standard Delivery Charge | Estimated Time | Cash on Delivery (COD) |
| :--- | :--- | :--- | :--- |
| Inside Dhaka City | 60 BDT | 24 - 48 Hours | Available (No advance needed) |
| Dhaka Suburbs (Savar, Gazipur) | 100 BDT | 48 - 72 Hours | Available |
| Outside Dhaka (Chittagong, Sylhet, Rajshahi, Barisal, Khulna, Rangpur) | 120 BDT | 3 - 5 Days | Available |

For parcel deliveries outside Dhaka, an advance courier booking charge of 120 BDT via bKash may be requested for first-time buyers.

# Return & Exchange Policy
Customer satisfaction is our priority. If a product has defects or sizing mismatch, request an exchange within 7 days.

### Return Eligibility & Rules
1. Returns must be requested within 7 calendar days of parcel receipt from the courier.
2. The product must be in original condition with unremoved tags.
3. For wrong size exchanges, the customer covers return delivery charge of 60 BDT inside Dhaka or 120 BDT outside Dhaka.
4. Approved refunds are processed through bKash, Nagad, or Bank Transfer within 3 to 5 business days.

# Apparel Sizing Chart Guide
### Men Premium T-Shirt Sizing
| Size Code | Chest (Inches) | Length (Inches) | Recommended Weight |
| :--- | :--- | :--- | :--- |
| M | 38 - 39 | 27 | 55 - 65 kg |
| L | 40 - 41 | 28 | 65 - 75 kg |
| XL | 42 - 43 | 29 | 75 - 85 kg |
| XXL | 44 - 45 | 30 | 85 - 95 kg |`;

  await KnowledgeService.ingestDocument(context, {
    title: "MVP replay: Bangladesh commerce policies", document_type: "POLICY", raw_content: replayCorpus,
    file_format: "MARKDOWN", language: "mixed", tags: ["rag-eval-fixture", RAG_QUALITY_DATASET_VERSION],
  });

  const observations: RagQualityObservation[] = [];
  const caseReports: Array<Record<string, unknown>> = [];
  for (const item of ragQualityCases) {
    const startedAt = Date.now();
    const [result, foreignResult] = await Promise.all([
      AgenticRagController.execute(tenantA.tenant.id, item.query, { topK: 5 }),
      AgenticRagController.execute(tenantB.tenant.id, item.query, { topK: 5 }),
    ]);
    const rankedEvidence = result.traces.find((trace) => trace.step === "RERANKING")?.details?.rankedEvidence || [];
    const rankedSections = rankedEvidence.map((evidence: { section: string }) => evidence.section);
    const relevantCitations = result.citations.filter((citation) => item.relevant_sections.some((section) => citation.section.toLowerCase().includes(section.toLowerCase())));
    const citationBodies = relevantCitations.map((citation) => `${citation.content_snippet} ${citation.parent_content || ""}`.toLowerCase());
    const supportedFacts = (item.critical_facts || []).filter((fact) => citationBodies.some((body) => body.includes(fact.toLowerCase())));
    const staleCitations = result.citations.filter((citation) => {
      const document = db.findKnowledgeDocumentById(tenantA.tenant.id, citation.document_id);
      return !document || document.status !== "ACTIVE" || document.version !== citation.version;
    });
    const foreignLeaks = foreignResult.citations.length;
    observations.push({
      case_id: item.id,
      ranked_sections: rankedSections,
      released_sections: result.citations.map((citation) => citation.section),
      abstained: result.is_fallback,
      retrieval_unavailable: result.retrieval_outcome === "RETRIEVAL_UNAVAILABLE",
      supported_citations: relevantCitations.length,
      total_citations: result.citations.length,
      factual_claims: item.critical_facts?.length || 0,
      supported_claims: supportedFacts.length,
      critical_facts_exact: Boolean(item.critical_facts?.length) && supportedFacts.length === item.critical_facts.length,
      cross_tenant_results: foreignLeaks,
      archived_version_citations: staleCitations.length,
    });
    caseReports.push({
      case_id: item.id,
      language: item.language,
      expected: { answerability: item.answerability, relevant_sections: item.relevant_sections, critical_facts: item.critical_facts || [] },
      actual: {
        retrieval_outcome: result.retrieval_outcome || (result.is_fallback ? "UNKNOWN_NO_MATCH" : "ANSWERABLE_WITH_EVIDENCE"),
        abstained: result.is_fallback,
        ranked_evidence: rankedEvidence.map((evidence: { documentId: string; chunkId: string; version: number; section: string; heuristicRelevanceScore: number }) => ({
          document_id: evidence.documentId, chunk_id: evidence.chunkId, version: evidence.version,
          section: evidence.section, heuristic_relevance_score: evidence.heuristicRelevanceScore,
        })),
        released_citations: result.citations.map((citation) => ({ document_id: citation.document_id, version: citation.version, section: citation.section })),
        supported_facts: supportedFacts,
        unsupported_facts: (item.critical_facts || []).filter((fact) => !supportedFacts.includes(fact)),
        fallback_reason: result.retrieval_outcome === "RETRIEVAL_UNAVAILABLE" ? "RETRIEVAL_UNAVAILABLE" : result.is_fallback ? "EVIDENCE_BELOW_HEURISTIC_GATE" : null,
        stale_citation_count: staleCitations.length,
        cross_tenant_citation_count: foreignLeaks,
      },
      stage_latency_ms: traceLatency(result),
      total_latency_ms: Date.now() - startedAt,
    });
  }

  const metrics = evaluateRagQuality(ragQualityCases, observations, 5);
  const checks = [
    ["case_count", metrics.cases >= thresholds.min_cases, `${metrics.cases} >= ${thresholds.min_cases}`],
    ["recall_at_5", metrics.recall_at_5 >= thresholds.min_recall_at_5, `${metrics.recall_at_5} >= ${thresholds.min_recall_at_5}`],
    ["answerable_coverage", metrics.answerable_coverage >= thresholds.min_answerable_coverage, `${metrics.answerable_coverage} >= ${thresholds.min_answerable_coverage}`],
    ["citation_support_rate", metrics.citation_support_rate >= thresholds.min_citation_support_rate, `${metrics.citation_support_rate} >= ${thresholds.min_citation_support_rate}`],
    ["citation_precision", metrics.citation_precision >= thresholds.min_citation_precision, `${metrics.citation_precision} >= ${thresholds.min_citation_precision}`],
    ["critical_fact_exactness", metrics.critical_fact_exactness >= thresholds.min_critical_fact_exactness, `${metrics.critical_fact_exactness} >= ${thresholds.min_critical_fact_exactness}`],
    ["correct_abstention_rate", metrics.correct_abstention_rate >= thresholds.min_correct_abstention_rate, `${metrics.correct_abstention_rate} >= ${thresholds.min_correct_abstention_rate}`],
    ["false_answer_count", metrics.false_answer_count <= thresholds.max_false_answer_count, `${metrics.false_answer_count} <= ${thresholds.max_false_answer_count}`],
    ["cross_tenant_leak_count", metrics.cross_tenant_leak_count <= thresholds.max_cross_tenant_leak_count, `${metrics.cross_tenant_leak_count} <= ${thresholds.max_cross_tenant_leak_count}`],
    ["archived_version_citation_count", metrics.archived_version_citation_count <= thresholds.max_archived_version_citation_count, `${metrics.archived_version_citation_count} <= ${thresholds.max_archived_version_citation_count}`],
  ] as Array<[string, boolean, string]>;
  for (const [language, languageMetrics] of Object.entries(metrics.by_language)) {
    if (languageMetrics.answerable_cases >= thresholds.min_answerable_cases_per_language) {
      checks.push([
        `answerable_coverage_${language}`,
        languageMetrics.answerable_coverage >= thresholds.min_language_answerable_coverage,
        `${languageMetrics.answerable_coverage} >= ${thresholds.min_language_answerable_coverage} (${languageMetrics.answerable_cases} answerable cases)`,
      ]);
    }
  }
  for (const [category, categoryMetrics] of Object.entries(metrics.by_category)) {
    if (categoryMetrics.answerable_cases >= thresholds.min_answerable_cases_per_category) {
      checks.push([
        `answerable_coverage_category_${category.toLowerCase()}`,
        categoryMetrics.answerable_coverage >= thresholds.min_category_answerable_coverage,
        `${categoryMetrics.answerable_coverage} >= ${thresholds.min_category_answerable_coverage} (${categoryMetrics.answerable_cases} answerable cases)`,
      ]);
    }
  }
  const report = {
    schema_version: "1",
    dataset_version: RAG_QUALITY_DATASET_VERSION,
    dataset_review_status: "SEED_NOT_INDEPENDENTLY_REVIEWED",
    mode: live ? "LIVE_EMBEDDINGS" : "DEMO",
    chat_provider_mode: modelRouter.getMode(),
    provider: modelRouter.getStatus().embedding_provider || modelRouter.getStatus().provider,
    embedding_profile: modelRouter.getEmbeddingProfile(),
    code_revision: revision(),
    working_tree_dirty: hasWorkingTreeChanges(),
    started_at: runStartedAt,
    metrics,
    latency_ms: {
      total_p50: percentile(caseReports.map((item) => item.total_latency_ms as number), 0.50),
      total_p95: percentile(caseReports.map((item) => item.total_latency_ms as number), 0.95),
      per_stage_p50: Object.fromEntries(Object.keys(caseReports[0]?.stage_latency_ms as Record<string, number> || {}).map((stage) => [
        stage,
        percentile(caseReports.map((item) => (item.stage_latency_ms as Record<string, number>)[stage]).filter(Number.isFinite), 0.50),
      ])),
      per_stage_p95: Object.fromEntries(Object.keys(caseReports[0]?.stage_latency_ms as Record<string, number> || {}).map((stage) => [
        stage,
        percentile(caseReports.map((item) => (item.stage_latency_ms as Record<string, number>)[stage]).filter(Number.isFinite), 0.95),
      ])),
    },
    gates: { passed: checks.every(([, passed]) => passed), checks: checks.map(([name, passed, detail]) => ({ name, passed, detail })) },
    cases: caseReports,
    live_cost: live ? "NOT_MEASURED" : "NOT_APPLICABLE_OFFLINE",
  };
  console.log(`RAG_REPLAY_JSON ${JSON.stringify(report)}`);
  if (!report.gates.passed) {
    console.error(`RAG MVP GATE FAILED: ${checks.filter(([, passed]) => !passed).map(([name, , detail]) => `${name} (${detail})`).join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(`RAG MVP GATE PASSED (${metrics.cases} cases, ${report.mode})`);
  }
}

main().catch((error) => {
  console.error("RAG replay failed:", error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 2;
});
