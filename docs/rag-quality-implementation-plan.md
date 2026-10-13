# RAG Quality Implementation Plan

**Status:** In progress. The initial retrieval-integrity and diagnostics slice is implemented; the complete quality plan is not yet done.  
**Scope:** Improve CommerceOS knowledge retrieval quality, honest abstention, citations, and measurement for Bengali, Banglish, and English commerce questions.  
**Constraints:** Preserve tenant isolation; keep confidence thresholds in code; do not call heuristic reranker output calibrated confidence; no live-provider or external database test without the repo's approval rules.

## 1. Current state and observed quality risks

The current path is document ingestion → parent/child chunking → configured-provider embeddings → Qdrant when configured plus local vector search fallback → BM25 → reciprocal-rank fusion → heuristic reranking → confidence gate → parent context and citations. The code and tests provide a useful baseline, but do not yet demonstrate stable retrieval quality against a representative relevance-labeled dataset.

Observed implementation risks to address:

1. **Embedding identity/dimensions are implicit.** `EmbeddingService` describes 1536 dimensions, while runtime providers may return configured dimensions. Ingestion writes zero vectors on missing batch results, and Qdrant failures can be logged and ingestion can still mark a document active. Reindexing writes a new version before proving that the new vector index is usable.
2. **Index activation is not atomic.** A failed or partial upsert can leave local and remote indexes inconsistent, and old remote points can survive a changed chunk set. Search does not expose which document/index versions were searched.
3. **Dense/sparse failures are hidden.** Hybrid search catches retrieval errors and returns an empty channel; callers cannot distinguish “no relevant evidence” from provider outage, embedding mismatch, or Qdrant failure. This can produce a misleading LOW confidence answer without a useful diagnostic.
4. **RRF merge across query expansions keeps one best score instead of aggregating ranks across subqueries.** Query expansion, channel outcomes, candidate counts, and latency are only partially visible in traces.
5. **Reranking is lexical heuristics.** It can be useful, but its score is not a calibrated probability and has no independent relevance ground truth. Its current thresholds and controller thresholds must not be tuned to make the benchmark green without evidence.
6. **Current tests prove selected examples, not broad quality.** Tests include useful table, Banglish, fallback, citation, and tenant-isolation cases, but no versioned retrieval qrels dataset or channel-by-channel measurements. An earlier live eval failure included embedding-provider HTTP 429, so provider reliability and retrieval quality must be reported separately.
7. **Grounding correctness needs claim-level measurement.** A retrieved citation does not prove that every generated factual claim follows from it; evidence freshness and source versions also need to be visible.

## 2. Goals and non-goals

### Goals

- Measure retrieval relevance and answer grounding on a versioned, balanced dataset before changing ranking behavior.
- Make embedding/index compatibility explicit and prevent zero/invalid vectors from becoming active evidence.
- Make ingestion and reindex safe under partial failures, with a verifiable active index version and rollback path.
- Attribute retrieval outcomes and latency to dense, sparse, fusion, reranking, confidence/abstention, and provider health.
- Improve Bengali/Banglish normalization and exact identifier retrieval while keeping document tables, fees, and size charts intact.
- Return UNKNOWN/escalation when evidence is weak, stale, conflicting, or unavailable; never synthesize unsupported prices, fees, eligibility, or payment/order facts.
- Preserve strict tenant filtering and add regression tests for all relevant data planes.

### Non-goals for the first delivery

- Enabling model-generated query rewriting or LLM-generated answers as a substitute for evidence.
- Replacing Qdrant or adding a heavy reranker dependency before the baseline identifies a need.
- Treating a single successful live-model run or a heuristic score as proof of production quality.
- Automatically merging conflicting merchant documents or deciding policy authority using the model.

## 3. Quality measurement contract

Add a versioned dataset under `tests/fixtures/rag/` (or the repository's existing eval-fixture convention), with a documented schema and license/source provenance. Each case should include:

- stable case ID; tenant fixture ID; query; language/script (`bn`, `banglish`, `en`, mixed); intent/category; expected answerability (`ANSWERABLE`, `UNANSWERABLE`, `CONFLICTING`, `STALE`, `RETRIEVAL_UNAVAILABLE`);
- relevant document IDs and versioned section/chunk qrels with graded relevance; exact critical facts/entities (BDT amount, district, time window, size, SKU, policy exception) and acceptable aliases;
- required and forbidden citations; expected abstention/escalation behavior; query type such as semantic paraphrase, exact SKU, numeric/fee lookup, policy eligibility, multi-hop, typo/noise, or adversarial injection;
- tags for table/chart source, document freshness, conflicting sources, multilingual transliteration, and tenant boundary.

Dataset curation targets: begin with 120 cases, at least 30 per language/script class and at least 15 cases in each high-risk category (money/fees, returns/refunds, payment, fulfillment/order status, size/stock facts). Include answerable and unanswerable examples and tenant-isolation attacks. At least two reviewers label relevance and critical facts; adjudicate disagreements and store dataset version/change notes. Avoid using model-generated labels as gold without review.

Report metrics for each retriever stage and overall:

- `Recall@K`, `Precision@K`, `MRR`, and `nDCG@K` on qrels; exact-identifier/SKU recall separately.
- Correct-answerable coverage and correct-abstention rate; false-answer rate on unanswerable, stale, conflicting, and retrieval-outage cases.
- Critical-fact exactness (including number, currency, district, unit, eligibility window); citation precision/recall and claim-to-source support rate.
- Cross-tenant leakage count (gate is exactly zero); citations to archived/old versions (gate is exactly zero unless explicitly queried as history).
- p50/p95 latency and failure/empty rates per dense, sparse, embedding, Qdrant, fusion, and rerank stage; model/provider identity and embedding dimension/index version.

Initial offline quality gates after the baseline is established: overall `nDCG@5 >= 0.80`, `Recall@5 >= 0.90`, exact-identifier recall `>= 0.98`, critical-fact exactness `>= 0.98`, answerable citation support `>= 0.95`, and correct abstention `>= 0.95`. Any false price/fee/refund/payment/order-state claim, cross-tenant result, or archived-version leakage is a hard failure regardless of aggregate score. These are retrieval/eval targets, not confidence-score values. Set final targets only after adjudicated baseline results and risk review; never lower a gate to conceal a regression.

## 4. Delivery phases

### Phase A — Reproducible baseline and eval harness

**Files:** `tests/fixtures/rag/**`, new `tests/rag-evaluation-tests.ts` or integrated `tests/agentic-rag-tests.ts`, `src/domains/ai/eval/`, `package.json`.

1. Define and validate the dataset schema; reject duplicate IDs, missing qrels, malformed answerability labels, invalid tenant references, and unreviewed cases.
2. Add a deterministic evaluator that runs BM25-only, dense-only, RRF, post-rerank, and end-to-end retrieval against a controlled corpus. Emit machine-readable JSON and a compact human report.
3. Freeze current pipeline settings and record baseline metrics by query class and language. Store code revision, dataset version, model/provider, dimensions, index build ID, and test mode with every report.
4. Ensure offline evaluations use deterministic fixed embeddings or a checked-in small vector fixture, never a mock whose output changes with test order. Clearly mark demo mode separately from real embeddings.
5. Add regression fixtures for prior production-like failures, including 429/unavailable embedding providers. Provider failure is reported as `RETRIEVAL_UNAVAILABLE`, not counted as ordinary relevance failure or successful abstention.

**Exit:** dataset validation passes; baseline can be reproduced; every metric has a defined denominator; outage cases are not conflated with irrelevant-query cases.

### Phase B — Ingestion integrity and embedding/index versioning

**Files:** `src/domains/ai/rag/embedding.service.ts`, `knowledge.service.ts`, `parent-child-chunking.service.ts`, `src/types/ai.ts`, `src/infrastructure/qdrant/client.ts`, store persistence/migrations only if required.

1. Introduce explicit embedding metadata: provider, model, dimension, normalized preprocessing version, distance metric, and index/schema version. Store it on documents/chunks or an index-generation record; never infer identity from vector length alone.
2. Validate every embedding is finite, non-empty, expected dimension, and non-zero where zero is not a valid model output. A batch with missing/invalid vectors fails ingestion; remove the zero-vector fallback.
3. Batch embedding calls within provider limits, preserve response-to-input ordering, validate response cardinality, and retry only safe transient provider errors with bounded attempts/backoff. Surface 429/quota as ingestion failure with sanitized diagnostic state.
4. Build new document/index versions in a staging generation. Verify chunk count, parent-child links, vector count/dimensions, payload tenant/document/version fields, and sample retrieval before changing the active generation pointer.
5. Activate the new generation atomically only after validation. Retain the previous generation for rollback; garbage-collect old Qdrant vectors only after activation and a bounded grace period. Failed staging generations stay inactive and do not replace the previous searchable version.
6. Ensure archive/delete removes or filters all remote generations for that tenant/document. All Qdrant fetch/search/delete filters stay tenant-scoped and document/version scoped where applicable.

**Exit:** malformed embeddings never enter the active index; simulated interruption at each ingest/reindex stage leaves either the old complete version active or the new complete version active, never a partial blend.

### Phase C — Retrieval correctness and channel diagnostics

**Files:** `src/domains/ai/rag/hybrid-search.service.ts`, `bm25.service.ts`, `agentic-rag.controller.ts`, `src/infrastructure/qdrant/client.ts`, retrieval trace types.

1. Return a typed per-channel result: `SUCCESS`, `EMPTY`, `UNAVAILABLE`, `INCOMPATIBLE_INDEX`, or `SKIPPED`, plus latency, candidate count, active index/model identity, and sanitized error class. Keep tenant IDs and secrets out of logs.
2. Make fallback policy explicit. Dense outage with functioning BM25 may continue only if evidence quality gates pass for that query class; no channels available means `RETRIEVAL_UNAVAILABLE` plus safe handoff. Do not collapse an outage to an empty result.
3. Validate and normalize search options (finite positive K/limits, legal weight range and weight sum, similarity range) rather than silently replacing zero/invalid values through `||` defaults.
4. Aggregate evidence across query expansions deterministically (rank-based fusion across subqueries, not “keep maximum RRF score”); deduplicate by tenant/document/version/chunk identity. Prevent expanded variants from multiplying the same result unfairly.
5. Add exact identifier path for SKUs, order-independent product codes, Bengali/Arabic numerals and known fee amounts: exact normalized match gets a deterministic lexical feature, while tokenization preserves code boundaries and numerals.
6. Keep BM25 tenant filtering explicit before scoring and test no cross-tenant candidates at the intermediate channel, not only after final citation generation.
7. Expose stage traces with channel success/failure, expansion count, candidate counts, fusion contributions/ranks, rerank count, chosen sources and latency. Avoid logging raw user text or raw document body; use redacted/hashed query diagnostics as allowed by retention policy.

**Exit:** channel outage cannot masquerade as “no facts found”; ranking is reproducible from trace metadata; exact codes and high-risk numeric facts meet dataset gates.

### Phase D — Reranking and confidence/abstention calibration

**Files:** `src/domains/ai/rag/reranker.service.ts`, `agentic-rag.controller.ts`, eval harness and thresholds config.

1. Rename/document current reranker score as heuristic relevance score. Do not label it probability/confidence or use it as calibrated confidence without a calibration study.
2. Establish per-class ranking performance and error examples before modifying heuristic weights. Compare no reranker, current heuristic, and any candidate alternative on the same fixed dataset.
3. Tune ranker weights/threshold constants only via held-out set, record before/after per-language and high-risk performance, and keep the test set separate from tuning data.
4. Evaluate score calibration separately from ranking: measure reliability curves/Brier score only when labels and sample counts support it. If calibration is not defensible, use conservative categorical evidence sufficiency rules rather than claiming probability.
5. Define outcomes distinctly: `ANSWERABLE_WITH_EVIDENCE`, `UNKNOWN_NO_MATCH`, `CONFLICTING_EVIDENCE`, `STALE_EVIDENCE`, and `RETRIEVAL_UNAVAILABLE`. Only the first may form grounded answer context. Preserve abstention/escalation for others.
6. Detect conflicting active authoritative documents and avoid selecting one silently. Return conflict metadata and route to human policy review. Prefer document authority/freshness only from explicit metadata/rules, never LLM judgment.

**Exit:** critical false-answer and leakage gates remain zero; abstention quality passes; ranking improvement is shown on held-out qrels rather than inferred from score values.

### Phase E — Grounded context, citations, and answer verification

**Files:** `src/domains/ai/context/context-builder.ts`, agent response validation/policy, `src/types/ai.ts`, `src/domains/ai/eval/`.

1. Include source ID/title/section/version/index generation/language and retrieval outcome in the internal context manifest; include only selected evidence and bounded parent context.
2. Keep table rows and semantic scope together (fee destination, currency, unit, range, conditions). Ensure parent resolution verifies same-tenant and same-active-document-version linkage before use.
3. Require citation provenance for RAG-sourced factual claims. Verify citations resolve to active source evidence; do not permit a citation to be attached merely because retrieval returned some chunk.
4. Add deterministic checks for high-risk numeric and policy claims (amount/currency, district scope, days, return eligibility, size/unit). Claims must be supported by the source span or abstain/escalate.
5. Treat retrieved text as untrusted data. Prompt injection inside knowledge documents cannot change tools, policy, tenant, system instructions, or approval state. Add hostile-document eval cases.
6. Redact PII before trace persistence; distinguish customer query, retrieval evidence, and system instructions in manifest boundaries.

**Exit:** all answerable factual cases have supported claims and valid citations; unanswerable/conflicting/stale/outage cases produce the expected safe fallback; hostile corpus instructions cannot alter policy or tool access.

### Phase F — Operational rollout and monitoring

**Files:** AI status/health route, RAG admin status and ingest/reindex result surfaces, telemetry/runbook, `.agent/STATUS.md`.

1. Report configured embedding model/provider/dimensions, active index generation, indexed/failed document counts, last successful ingest/reindex, channel health, and eval dataset/revision. Do not report semantic quality as LIVE solely because Qdrant responds.
2. Add alerts for embedding quota/failure, dimension mismatch, partial/stale index, rising empty/unavailable channels, citation support regression, p95 latency regression, and tenant-isolation gate failure.
3. Run offline eval on every relevant change in CI; run provider-backed evaluation only when explicitly configured and approved, record cost/provider/model, and separate provider reliability from semantic quality.
4. Shadow new retrieval/reranker versions against production-like traffic only after PII controls and retention approval; do not show shadow output to customers. Compare candidate IDs/rank changes and reviewed quality samples.
5. Roll out index/model generation to a non-production tenant, then a small allowlist in read-only shadow mode, then retrieval-backed responses with abstention enabled. Retain rollback to prior index generation and thresholds.

**Exit:** operational owner can detect/rollback index and provider failures; staged evaluation remains green across repeat runs and supported languages; status is updated only with evidence.

## 5. Suggested sequencing and dependencies

```text
A: dataset + evaluator + baseline
  → B: ingestion/index integrity
  → C: channel diagnostics + fusion and exact-match correctness
  → D: held-out reranker/abstention evaluation
  → E: citations + claim support + hostile-document safety
  → F: monitoring + shadow/allowlisted rollout
```

Do not tune RAG thresholds before Phase A labels the baseline. Do not migrate embedding models or dimensions before Phase B can stage, validate, atomically activate, and roll back index generations. Do not make RAG answers customer-facing as “grounded” until Phase E claim-level gates pass. Reranker/model changes must be evaluated independently from embedding-provider availability.

## 6. Verification matrix

| Area | Required verification |
|---|---|
| Dataset/evaluator | schema failures, duplicate cases, qrels correctness, reproducible report and denominators |
| Language coverage | Bengali script, Banglish transliteration variants, English, mixed text, spelling/noise, Bengali numerals |
| Retrieval relevance | per-stage Recall/Precision/MRR/nDCG and exact SKU/numeric lookup |
| Chunking | markdown tables, fee rows, size charts, headings, long sections, parent-child linkage and no orphan children |
| Embeddings/index | wrong dimension, NaN/Infinity, zero/missing vectors, batch cardinality mismatch, provider 429, interrupted upsert, activation/rollback |
| Fusion/ranking | dense-only, sparse-only, both, either unavailable, duplicate expansion hits, rank ties and deterministic ordering |
| Grounding | supported exact fact, unsupported fact, stale/archived version, conflicting documents, source citation validity |
| Security | tenant B cannot retrieve tenant A at dense, sparse, fused, reranked, parent-resolution, trace and citation stages |
| Safety | hostile query/document prompt injection, money/stock/order claims, unknown and retrieval outage abstention |
| Persistence | ingest/reindex/archive/delete on in-memory and PGlite with record-for-record reload where store/index metadata changes |
| Live quality | explicitly requested/configured live run; report provider/model, embedding model, dataset revision, cost, latency, failures and scores separately |

## 7. Ownership and release artifacts

Each phase should produce: code and focused tests; a versioned dataset/eval report; an ADR when persisted shape, index lifecycle, or compatibility changes; runbook updates for provider and index recovery; and a status update distinguishing offline evidence, real-provider evidence, and unverified items. Any live test that reaches Neon, Qdrant Cloud, or a paid model must follow repo approval instructions and must not run implicitly from ordinary CI.

## 8. Definition of done

- A reviewed, versioned bilingual/multilingual relevance dataset and repeatable evaluator exists.
- Quality gates pass by language and risk class, with hard-zero gates for tenant leakage and unsupported critical factual claims.
- Embeddings and index generations are explicit, validated and atomically switched; reindex failure preserves the previous active generation.
- Retrieval outages, empty evidence, conflicts and stale content have distinct observable outcomes and safe user behavior.
- Every RAG factual answer can be traced to active, tenant-matched, versioned evidence; high-risk claims pass deterministic support checks.
- Status and docs report only verified model/index/provider and evaluation evidence; RAG remains PARTIAL until repeatable offline and authorized live evidence justify a stronger status.

## 9. Implementation tracking (2026-10-03)

Implemented in the current working tree:

- Embeddings now fail closed for empty, non-finite, zero, wrong-dimension, and inconsistent batch outputs; batches are sent in bounded groups and provider/model/dimension/preprocessing/index identity is attached to indexed chunks and documents.
- Qdrant indexing validates vectors and collection dimensions, filters profile-compatible points, and versions remote point IDs. Reindex writes a new remote generation before switching the local document version. Parent/child chunk IDs now include document version so old local generations are not overwritten during reindex.
- Hybrid retrieval exposes dense/sparse outcomes and latency, filters inactive and stale local generations, validates search limits/weights, and distinguishes channel outages from empty results. Expansion retrieval is aggregated deterministically; the controller trace records internal ranked evidence separately from evidence released as citations.
- Bengali/Banglish delivery and return expansion was broadened; BM25 normalizes Bengali and Arabic-Indic numerals to ASCII. Reranker parent resolution checks tenant, document, version, and parent type.
- A 30-case code-curated Bengali/Banglish/English seed set and deterministic metric evaluator exist. The focused offline suite reports retrieval, citation support, critical fact checks, abstention, tenant leaks, archived citations, and provider-unavailable cases. Transient embedding provider errors (429/408/5xx/network/timeout) receive at most two bounded retries; non-retryable configuration/data errors fail immediately. Current evidence is demo/offline only.
- An isolated replay CLI is wired as `npm run rag:replay:offline`; it masks local provider/database/Qdrant configuration, reports per-case expectations and stage latency, emits denominator-aware aggregate metrics by language/category, writes an ignored JSON artifact, and returns a failing exit code when a gate fails. CI runs it on each PR/push and uploads the JSON report as a 14-day artifact. `npm run rag:replay:live -- --confirm-live-cost` is a separate explicit opt-in; it was not run during this implementation. `npm run test:eval:rag` covers evaluator validation and ensures provider outages do not count as correct abstentions.
- Qdrant delete failure is now surfaced instead of acknowledging document deletion while remote cleanup failed.

Verification on this date: `npm run type-check` passed; `npm run test:eval:rag` passed 3/3; `node tests/ts-runner.cjs ./tests/agentic-rag-tests.ts` passed 11/11; and `node tests/ts-runner.cjs ./tests/qdrant-rag-tests.ts` passed 10/10 with the local fake transport. Two `npm run rag:replay:offline` runs produced identical metrics and both passed the seed regression gate: Recall@5 1.0, answerable coverage 1.0, correct abstention 1.0, claim support/critical-fact exactness 0.9697, citation recall 1.0, citation precision 0.3433, and zero false answers, tenant leaks, or stale citations. The citation-precision floor is only 0.30 to detect regressions from this weak seed baseline; passing is not evidence that citations are sufficiently selective. These are DEMO-only seed results, not representative quality claims or live semantic quality evidence.

Remaining before the plan is complete: grow and independently review the qrels dataset to the documented target; measure dense-only/BM25-only/RRF/post-rerank separately; improve citation precision beyond the weak seed floor; add reproducible fixed-vector fixtures and provider-429 retry execution tests; test interrupted generations and complete atomic generation activation/rollback plus bounded old-vector garbage collection; improve exact identifier and numeric qrels; calibrate/revise abstention from held-out data; detect conflict/stale evidence; claim-to-source answer verification and hostile-document tests; add RAG operational status/alerts and authorized shadow/live rollout evidence. Do not treat this status section as a production-readiness claim.
