// @ts-nocheck
import assert from "assert";
declare const process: { exit(code?: number): void };

import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { RequestContext } from "@/lib/context";
import { PERMISSIONS } from "@/lib/permissions";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { ParentChildChunkingService } from "@/domains/ai/rag/parent-child-chunking.service";
import { BM25Service } from "@/domains/ai/rag/bm25.service";
import { HybridSearchService } from "@/domains/ai/rag/hybrid-search.service";
import { RerankerService } from "@/domains/ai/rag/reranker.service";
import { AgenticRagController } from "@/domains/ai/rag/agentic-rag.controller";

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

let passedCount = 0;
let failedCount = 0;

async function runTest(testName: string, testFn: () => Promise<void> | void) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${testName}`);
    console.error(err);
    failedCount++;
  }
}

export async function runAgenticRagTests() {
  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS: AGENTIC RAG & HYBRID RETRIEVAL TEST SUITE        ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   (BM25 + pgvector + Reranker + Parent-Child Chunking)         ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();

  // 1. Setup isolated tenants
  const now = Date.now();
  const tenantA = await AuthService.registerTenantWithOwner({
    workspaceName: `Fabrilife Fashion ${now}`,
    name: "Fabrilife Admin",
    email: `fabrilife-${now}@example.com`,
    password: "SecurePassword2026!",
    currency: "BDT",
  });

  const tenantB = await AuthService.registerTenantWithOwner({
    workspaceName: `Sailor Retail ${now}`,
    name: "Sailor Admin",
    email: `sailor-${now}@example.com`,
    password: "SecurePassword2026!",
    currency: "BDT",
  });

  const contextA: RequestContext = {
    requestId: "req_rag_test_a",
    traceId: "tr_rag_test_a",
    user: { id: tenantA.user.id, email: tenantA.user.email, name: tenantA.user.name, status: "ACTIVE" },
    tenant: { id: tenantA.tenant.id, name: tenantA.tenant.name, slug: tenantA.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  };

  const contextB: RequestContext = {
    requestId: "req_rag_test_b",
    traceId: "tr_rag_test_b",
    user: { id: tenantB.user.id, email: tenantB.user.email, name: tenantB.user.name, status: "ACTIVE" },
    tenant: { id: tenantB.tenant.id, name: tenantB.tenant.name, slug: tenantB.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  };

  const samplePolicyDocument = `# Store Shipping & Delivery Charges

We deliver nationwide across all 64 districts in Bangladesh through Steadfast Courier and Pathao Express.

### Delivery Charges & Timelines
| Destination | Standard Delivery Charge | Estimated Time | Cash on Delivery (COD) |
| :--- | :--- | :--- | :--- |
| Inside Dhaka City | 60 BDT | 24 - 48 Hours | Available (No advance needed) |
| Dhaka Suburbs (Savar, Gazipur) | 100 BDT | 48 - 72 Hours | Available |
| Outside Dhaka (Chittagong, Sylhet, Rajshahi, Barisal, Khulna, Rangpur) | 120 BDT | 3 - 5 Days | Available |

For parcel deliveries outside Dhaka, an advance courier booking charge of 120 BDT via bKash may be requested for first-time buyers.

---

# Return & Exchange Policy

Customer satisfaction is our utmost priority. If you encounter any defects or sizing mismatch, you can request an exchange within 7 days.

### Return Eligibility & Rules
1. Returns must be requested within 7 calendar days of parcel receipt from the courier.
2. The product SKU (e.g. POLO-NVY-XL or DENIM-SLIM-32) must be in original condition with unremoved tags.
3. For wrong size exchanges, customer only covers return delivery charge of 60 BDT inside Dhaka or 120 BDT outside Dhaka.
4. Refunds for approved returns are processed through bKash, Nagad, or Bank Transfer within 3 to 5 business days.

---

# Apparel Sizing Chart Guide

Please consult our chest and length specifications before placing your order.

### Men Premium T-Shirt Sizing
| Size Code | Chest (Inches) | Length (Inches) | Recommended Weight |
| :--- | :--- | :--- | :--- |
| M | 38 - 39 | 27 | 55 - 65 kg |
| L | 40 - 41 | 28 | 65 - 75 kg |
| XL | 42 - 43 | 29 | 75 - 85 kg |
| XXL | 44 - 45 | 30 | 85 - 95 kg |
`;

  // -------------------------------------------------------------
  // TEST 1: Parent-Child Chunking Service
  // -------------------------------------------------------------
  await runTest("Parent-Child Chunking: Segments into Parent and Child chunks preserving tables", () => {
    const res = ParentChildChunkingService.chunkDocumentHierarchically(
      tenantA.tenant.id,
      "doc_sample_1",
      samplePolicyDocument,
      {
        document_title: "Store Guidelines & Policies",
        document_type: "POLICY",
        version: 1,
        language: "mixed",
      }
    );

    assert(res.parentChunks.length >= 3, `Expected at least 3 parent chunks, got ${res.parentChunks.length}`);
    assert(res.childChunks.length >= res.parentChunks.length, `Child count (${res.childChunks.length}) must be >= parent count (${res.parentChunks.length})`);

    // Verify parent chunk structure
    const p1 = res.parentChunks[0];
    assert.strictEqual(p1.chunk_type, "PARENT");
    assert(p1.child_chunk_ids && p1.child_chunk_ids.length > 0, "Parent must track child_chunk_ids");

    // Verify child chunk structure and parent linkage
    const c1 = res.childChunks[0];
    assert.strictEqual(c1.chunk_type, "CHILD");
    assert.strictEqual(c1.parent_chunk_id, p1.id, "Child must reference parent chunk ID");
    assert(c1.bm25_tokens && c1.bm25_tokens.length > 0, "Child must have pre-computed BM25 tokens");

    // Verify table structure in child chunks
    const hasTableChild = res.childChunks.some((c) => c.content.includes("|"));
    assert(hasTableChild, "At least one child chunk must preserve markdown table format");
  });

  // -------------------------------------------------------------
  // TEST 2: BM25 Lexical Service
  // -------------------------------------------------------------
  await runTest("BM25: Correctly tokenizes Bengali, Banglish, and alphanumeric SKUs", () => {
    const text = "POLO-NVY-XL টি-শার্ট ডেলিভারি চার্জ ৬০ টাকা inside Dhaka";
    const tokens = BM25Service.tokenize(text);

    assert(tokens.includes("polo-nvy-xl"), "BM25 tokenizer must preserve hyphenated product SKU");
    assert(tokens.includes("টি-শার্ট") || tokens.includes("টি") || tokens.includes("শার্ট"), "Must tokenize Bengali words");
    assert(tokens.includes("৬০") || tokens.includes("60") || tokens.includes("টাকা"), "Must retain Bengali numerals or terms");
    assert(tokens.includes("inside") && tokens.includes("dhaka"), "Must retain English keywords");
  });

  await runTest("BM25: Retrieves exact SKU match at Rank #1", () => {
    const chunk1 = {
      id: "chk_1",
      tenant_id: "tenant_t1",
      document_id: "doc_1",
      chunk_index: 0,
      content: "Regular cotton apparel for men and women.",
      embedding: [],
      token_count: 10,
      metadata: { document_title: "General", document_type: "FAQ", version: 1, language: "en" },
      created_at: new Date().toISOString(),
    };

    const chunk2 = {
      id: "chk_2",
      tenant_id: "tenant_t1",
      document_id: "doc_1",
      chunk_index: 1,
      content: "Official specs for product SKU POLO-NVY-XL: 100% combed cotton navy polo.",
      embedding: [],
      token_count: 15,
      metadata: { document_title: "Catalog", document_type: "FAQ", version: 1, language: "en" },
      created_at: new Date().toISOString(),
    };

    const results = BM25Service.search("tenant_t1", "POLO-NVY-XL", [chunk1, chunk2], 5);
    assert.strictEqual(results.length, 1, "Only chunk with matching SKU should match");
    assert.strictEqual(results[0].chunk.id, "chk_2");
    assert.strictEqual(results[0].rank, 1);
  });

  // -------------------------------------------------------------
  // TEST 3: Ingestion with Hierarchical Storage in DB
  // -------------------------------------------------------------
  await runTest("KnowledgeService.ingestDocument: Hierarchically ingests document into DB", async () => {
    const doc = await KnowledgeService.ingestDocument(contextA, {
      title: "Fabrilife Store Policies & Size Chart",
      document_type: "POLICY",
      raw_content: samplePolicyDocument,
      file_format: "MARKDOWN",
      language: "mixed",
    });

    assert(doc.id, "Document must have generated ID");
    assert.strictEqual(doc.status, "ACTIVE");
    assert(doc.chunk_count > 3, `Expected multiple chunks, got ${doc.chunk_count}`);

    // Verify DB contains both parent and child chunks
    const allChunks = db.getKnowledgeChunks(contextA.tenant.id, doc.id);
    const parentChunks = allChunks.filter((c) => c.chunk_type === "PARENT");
    const childChunks = allChunks.filter((c) => c.chunk_type === "CHILD");

    assert(parentChunks.length >= 3, `Expected >= 3 parent chunks in DB, got ${parentChunks.length}`);
    assert(childChunks.length >= parentChunks.length, `Expected child chunks >= parent chunks in DB, got ${childChunks.length}`);

    // Verify parent lookup helper
    const testChild = childChunks[0];
    const parent = db.findParentKnowledgeChunk(contextA.tenant.id, testChild.parent_chunk_id!);
    assert(parent, "findParentKnowledgeChunk must return parent chunk");
    assert.strictEqual(parent.id, testChild.parent_chunk_id);
  });

  // -------------------------------------------------------------
  // TEST 4: Hybrid Search & Reciprocal Rank Fusion
  // -------------------------------------------------------------
  await runTest("HybridSearchService: Executes dense + sparse search with RRF scoring", async () => {
    const results = await HybridSearchService.search(
      contextA.tenant.id,
      "delivery charge outside dhaka",
      { topK: 5, onlyChildChunks: true }
    );

    assert(results.length > 0, "Hybrid search must return candidates");
    assert(results[0].rrf_score > 0, "Results must have computed RRF score");
    assert(results[0].chunk.content.toLowerCase().includes("dhaka") || results[0].chunk.content.toLowerCase().includes("delivery"), "Top candidate should match query topics");
  });

  // -------------------------------------------------------------
  // TEST 5: Cross-Encoder Reranker & Parent Context Resolution
  // -------------------------------------------------------------
  await runTest("RerankerService: Reranks candidates and resolves child to full parent context", async () => {
    const hybridResults = await HybridSearchService.search(
      contextA.tenant.id,
      "return eligibility 7 days",
      { topK: 10, onlyChildChunks: true }
    );

    const reranked = RerankerService.rerank(
      contextA.tenant.id,
      "return eligibility 7 days",
      hybridResults,
      { topK: 3, resolveParentContext: true, deduplicateParents: true }
    );

    assert(reranked.length > 0, "Reranker must return top candidates");
    assert(reranked[0].rerank_score > 0.40, `Top rerank score must be strong, got ${reranked[0].rerank_score}`);

    // Verify parent resolution
    const topMatch = reranked[0];
    assert(topMatch.parent_chunk !== undefined, "Reranked child chunk must have resolved parent_chunk");
    assert(topMatch.resolved_content.length >= topMatch.chunk.content.length, "Resolved content should be the richer parent context");
    assert(
      topMatch.resolved_content.includes("Return Eligibility") || topMatch.resolved_content.includes("Return & Exchange"),
      "Parent context must contain the return policy section heading"
    );
  });

  // -------------------------------------------------------------
  // TEST 6: Top-Level Agentic RAG Controller End-to-End
  // -------------------------------------------------------------
  await runTest("AgenticRagController: Colloquial Banglish query expansion and grounded citation", async () => {
    // User asks in colloquial Banglish: "vai dhakar baire delivery charge koto?"
    const result = await AgenticRagController.execute(
      contextA.tenant.id,
      "vai dhakar baire delivery charge koto?",
      { topK: 3 }
    );

    assert.strictEqual(result.intent, "SHIPPING_DELIVERY_CHARGE");
    assert.strictEqual(result.requires_retrieval, true);
    assert(result.expanded_queries.length >= 2, `Expected query expansions, got ${result.expanded_queries.length}`);
    assert(result.citations.length > 0, "Must return verified citations");

    // Verify top citation details
    const topCitation = result.citations[0];
    assert(topCitation.similarity_score > 0.50, `Expected solid similarity score, got ${topCitation.similarity_score}`);
    assert(topCitation.parent_content !== undefined, "Citation must include full parent content");
    assert(
      topCitation.content_snippet.includes("120") || topCitation.parent_content?.includes("120"),
      "Must accurately locate outside Dhaka 120 BDT fee in snippet or parent content"
    );

    // Verify confidence level and grounded context
    assert(result.confidence_level === "HIGH" || result.confidence_level === "MODERATE");
    assert(!result.is_fallback, "Valid query must not be flagged as fallback");
    assert(result.grounded_context.length > 0, "Grounded context block must be generated for agent");

    // Verify observability traces
    assert(result.traces.length >= 6, "Must record step-by-step traces");
    assert(result.traces.some((t) => t.step === "QUERY_EXPANSION"));
    assert(result.traces.some((t) => t.step === "HYBRID_RETRIEVAL"));
    assert(result.traces.some((t) => t.step === "RERANKING"));
    assert(result.traces.some((t) => t.step === "CONFIDENCE_GATE"));
  });

  // -------------------------------------------------------------
  // TEST 7: Corrective RAG Confidence Gate & Fallback
  // -------------------------------------------------------------
  await runTest("AgenticRagController: Low confidence query triggers fallback and human escalation", async () => {
    // Completely ungrounded question about space travel or irrelevant topic
    const result = await AgenticRagController.execute(
      contextA.tenant.id,
      "What is the rocket launch schedule for Mars mission?",
      { topK: 3, confidenceThresholdLow: 0.65 }
    );

    assert(result.confidence_level === "LOW", `Expected LOW confidence, got ${result.confidence_level}`);
    assert.strictEqual(result.is_fallback, true, "Must flag low confidence as fallback");
    assert.strictEqual(result.suggested_escalation, true, "Must recommend escalation when information is unknown");
  });

  // -------------------------------------------------------------
  // TEST 8: Strict Multi-Tenant Isolation
  // -------------------------------------------------------------
  await runTest("Security & Isolation: Tenant B cannot retrieve Tenant A's knowledge chunks", async () => {
    // Ingest sensitive proprietary policy for Tenant A
    await KnowledgeService.ingestDocument(contextA, {
      title: "Secret VIP Partner Whitelist",
      document_type: "POLICY",
      raw_content: "# Secret VIP Partner Whitelist\nSecret promotional code is FABRI_SECRET_50PCT_OFF strictly for apex partner.",
      language: "en",
    });

    // Tenant B searches for Tenant A's exact secret code
    const tenantBSearch = await KnowledgeService.searchKnowledge(
      contextB.tenant.id,
      "FABRI_SECRET_50PCT_OFF",
      5,
      0.40
    );

    assert.strictEqual(
      tenantBSearch.length,
      0,
      `Tenant B must receive ZERO citations for Tenant A's private data, got ${tenantBSearch.length}`
    );

    // Tenant B Agentic RAG Controller search
    const tenantBAgentic = await AgenticRagController.execute(
      contextB.tenant.id,
      "FABRI_SECRET_50PCT_OFF promotional code",
      { topK: 5 }
    );

    assert.strictEqual(
      tenantBAgentic.citations.length,
      0,
      "Agentic RAG must return ZERO citations across tenants"
    );
    assert.strictEqual(tenantBAgentic.is_fallback, true);
  });

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}----------------------------------------------------------------${ANSI_RESET}`);
  console.log(`Tests Passed: ${ANSI_GREEN}${passedCount}${ANSI_RESET}`);
  console.log(`Tests Failed: ${failedCount > 0 ? ANSI_RED : ""}${failedCount}${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}----------------------------------------------------------------\n${ANSI_RESET}`);

  if (failedCount > 0) {
    throw new Error(`${failedCount} test(s) failed in Agentic RAG test suite.`);
  }
}

// Execute test suite directly
runAgenticRagTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

