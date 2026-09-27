/**
 * CommerceOS — Pinecone RAG Vector Integration Tests
 * Validates document ingestion, embedding generation, namespace isolation,
 * and dynamic tenant connector credential resolution.
 */

import assert from "assert";
import { db } from "@/infrastructure/db";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { EmbeddingService } from "@/domains/ai/rag/embedding.service";
import { ChunkingService } from "@/domains/ai/rag/chunking.service";
import { ConnectorService } from "@/domains/connectors/service";
import {
  resolvePineconeCredentials,
  isPineconeConfigured,
  clearPineconeCache,
} from "@/infrastructure/pinecone/client";
import { RequestContext } from "@/lib/context";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ PASS - ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ FAIL - ${name}: ${err.message}`);
    failed++;
  }
}

async function run() {
  console.log("\n====================================================");
  console.log("   COMMERCEOS PINECONE RAG INTEGRATION TESTS        ");
  console.log("====================================================\n");

  db.clearAllForTesting();
  clearPineconeCache();

  const contextA: RequestContext = {
    requestId: "req_test_rag_a",
    traceId: "trace_test_rag_a",
    timestamp: new Date().toISOString(),
    role: "OWNER",
    permissions: ROLE_PERMISSIONS["OWNER"],
    tenant: {
      id: "ten_pinecone_alpha",
      name: "Alpha Fashion",
      slug: "alpha-fashion",
      currency: "BDT",
      timezone: "Asia/Dhaka",
      language: "en",
      settings: {},
      status: "ACTIVE",
    },
    user: {
      id: "usr_pinecone_01",
      email: "admin@alpha.com",
      name: "Alpha Admin",
      status: "ACTIVE",
    },
  };

  const contextB: RequestContext = {
    ...contextA,
    requestId: "req_test_rag_b",
    traceId: "trace_test_rag_b",
    tenant: {
      ...contextA.tenant,
      id: "ten_pinecone_beta",
      name: "Beta Tech",
      slug: "beta-tech",
    },
  };

  console.log("[1. Dynamic Connector Credential Resolution]");
  await test("isPineconeConfigured returns false when no connector or env key exists", async () => {
    delete process.env.PINECONE_API_KEY;
    const isConfigured = isPineconeConfigured(contextA.tenant.id);
    assert.strictEqual(isConfigured, false, "Should be false when no connector or env exists");
  });

  let savedConnectorId = "";
  await test("ConnectorService saves encrypted Pinecone credentials to DB", async () => {
    const saved = await ConnectorService.saveConnector(contextA, {
      provider_id: "pinecone",
      name: "Alpha Pinecone Index",
      endpoint_url: "https://alpha-knowledge.svc.pinecone.io",
      credentials: {
        api_key: "pcsk_alpha_secret_key_999888",
        index_host: "https://alpha-knowledge.svc.pinecone.io",
        index_name: "alpha-catalog-index",
        vector_dimension: 1536,
        metric: "cosine",
      },
    });

    assert.ok(saved.id);
    assert.strictEqual(saved.status, "ACTIVE");
    assert.strictEqual(saved.credentials_masked.api_key.includes("••••"), true, "Must mask secret");
    savedConnectorId = saved.id;
  });

  await test("resolvePineconeCredentials dynamically decrypts credentials from DB", async () => {
    const creds = resolvePineconeCredentials(contextA.tenant.id);
    assert.ok(creds, "Must resolve credentials for Tenant Alpha");
    assert.strictEqual(creds.source, "CONNECTOR");
    assert.strictEqual(creds.apiKey, "pcsk_alpha_secret_key_999888");
    assert.strictEqual(creds.indexName, "alpha-catalog-index");
    assert.strictEqual(creds.indexHost, "https://alpha-knowledge.svc.pinecone.io");
    assert.strictEqual(isPineconeConfigured(contextA.tenant.id), true);

    // Tenant Beta should NOT have credentials
    assert.strictEqual(isPineconeConfigured(contextB.tenant.id), false);
  });

  console.log("\n[2. Chunking & Embedding Generation]");
  await test("ChunkingService decomposes Markdown policy into structured chunks", async () => {
    const rawContent = `
# Return and Refund Policy
Dhaka customers can exchange clothing items within 7 days of delivery.
Items must be unworn with tags attached.

## Courier Delivery Timelines
Delivery inside Dhaka takes 24 to 48 hours. Outside Dhaka takes 3 to 5 business days.
    `.trim();

    const chunks = ChunkingService.chunkDocument(rawContent, "Return & Delivery Policy");
    assert.ok(chunks.length >= 1);
    assert.ok(chunks[0].content.length > 0);
  });

  await test("EmbeddingService produces 1536-dimensional float vector", async () => {
    const vector = await EmbeddingService.embedText("How long does delivery take inside Dhaka?");
    assert.strictEqual(vector.length, 1536);
    assert.ok(typeof vector[0] === "number");
  });

  console.log("\n[3. Knowledge Base Ingestion & Semantic Retrieval]");
  let docId = "";
  await test("KnowledgeService ingests policy document and builds index with dynamic Pinecone support", async () => {
    const doc = await KnowledgeService.ingestDocument(contextA, {
      title: "Store Shipping Policy",
      document_type: "SHIPPING_POLICY",
      raw_content: "Standard delivery charge is 60 BDT inside Dhaka and 120 BDT outside Dhaka via Steadfast.",
      file_format: "MARKDOWN",
    });

    assert.ok(doc.id);
    assert.strictEqual(doc.status, "ACTIVE");
    docId = doc.id;
  });

  await test("KnowledgeService performs semantic retrieval with score threshold", async () => {
    const results = await KnowledgeService.searchKnowledge(
      contextA.tenant.id,
      "What is the delivery charge inside Dhaka?",
      3,
      0.5
    );

    assert.ok(results.length > 0);
    assert.ok(results[0].similarity_score >= 0.5);
    assert.ok(results[0].content_snippet.includes("60 BDT") || results[0].parent_content?.includes("60 BDT"));
  });

  await test("Strict Tenant Isolation: Tenant Beta cannot retrieve Tenant Alpha vectors", async () => {
    const results = await KnowledgeService.searchKnowledge(
      contextB.tenant.id,
      "What is the delivery charge inside Dhaka?",
      3,
      0.5
    );

    assert.strictEqual(results.length, 0, "Cross-tenant vector search must return zero results");
  });

  console.log("\n[4. Connector Deletion & Cache Invalidation]");
  await test("Deleting connector invalidates credentials and reverts isPineconeConfigured", async () => {
    await ConnectorService.deleteConnector(contextA, savedConnectorId);
    assert.strictEqual(isPineconeConfigured(contextA.tenant.id), false, "Should revert to false after connector deletion");
    assert.strictEqual(resolvePineconeCredentials(contextA.tenant.id), null);
  });

  await test("Fallback to PINECONE_API_KEY from environment when no connector in DB", async () => {
    process.env.PINECONE_API_KEY = "pcsk_env_fallback_key_111222";
    process.env.PINECONE_INDEX = "env-global-knowledge";

    const creds = resolvePineconeCredentials(contextA.tenant.id);
    assert.ok(creds);
    assert.strictEqual(creds.source, "ENV");
    assert.strictEqual(creds.apiKey, "pcsk_env_fallback_key_111222");
    assert.strictEqual(creds.indexName, "env-global-knowledge");

    // Clean up env
    delete process.env.PINECONE_API_KEY;
    delete process.env.PINECONE_INDEX;
  });

  console.log("\n====================================================");
  console.log(`  PINECONE RAG TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("====================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
