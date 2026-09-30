/**
 * CommerceOS — Qdrant RAG Vector Integration Tests
 * Runs the client against an in-process fake of Qdrant's REST API (no network, no real cluster): checks collection
 * bootstrap, that every search/delete carries the tenant filter, tenant-scoped point ids, and the ingest → search path.
 */

import assert from "assert";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/infrastructure/db";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import {
  clearQdrantCache,
  deleteDocumentVectors,
  healthCheck,
  isQdrantConfigured,
  resolveQdrantCredentials,
  searchVectors,
  upsertChunks,
} from "@/infrastructure/qdrant/client";
import { RequestContext } from "@/lib/context";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ PASS - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL - ${name}: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ── Fake Qdrant ────────────────────────────────────────────────
interface FakePoint { id: string; vector: number[]; payload: Record<string, unknown> }
interface FilterBody { must?: Array<{ key: string; match: { value: string } }> }

const points = new Map<string, FakePoint>();
const seen: Array<{ method: string; path: string; body: unknown; apiKey?: string }> = [];
let collectionExists = false;

function matches(p: FakePoint, filter?: FilterBody): boolean {
  return (filter?.must ?? []).every((c) => p.payload[c.key] === c.match.value);
}
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    const path = (req.url ?? "").split("?")[0];
    seen.push({ method: req.method ?? "", path, body, apiKey: req.headers["api-key"] as string | undefined });
    const send = (status: number, json: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(json)); };

    if (req.method === "GET" && /^\/collections\/[^/]+$/.test(path)) return collectionExists ? send(200, { result: { status: "green", points_count: points.size } }) : send(404, {});
    if (req.method === "PUT" && /^\/collections\/[^/]+$/.test(path)) { collectionExists = true; return send(200, { result: true }); }
    if (req.method === "PUT" && path.endsWith("/index")) return send(200, { result: {} });
    if (req.method === "PUT" && path.endsWith("/points")) {
      for (const p of body.points as FakePoint[]) points.set(p.id, p);
      return send(200, { result: { status: "completed" } });
    }
    if (req.method === "POST" && path.endsWith("/points/search")) {
      const hits = [...points.values()]
        .filter((p) => matches(p, body.filter))
        .map((p) => ({ score: cosine(p.vector, body.vector), payload: p.payload }))
        .filter((h) => h.score >= (body.score_threshold ?? -1))
        .sort((a, b) => b.score - a.score)
        .slice(0, body.limit);
      return send(200, { result: hits });
    }
    if (req.method === "POST" && path.endsWith("/points/delete")) {
      for (const [id, p] of points) if (matches(p, body.filter)) points.delete(id);
      return send(200, { result: { status: "completed" } });
    }
    return send(400, {});
  });
});

async function run() {
  console.log("\n====================================================");
  console.log("   COMMERCEOS QDRANT RAG INTEGRATION TESTS          ");
  console.log("====================================================\n");

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const baseContext: RequestContext = {
    requestId: "req_test_rag_a",
    traceId: "trace_test_rag_a",
    timestamp: new Date().toISOString(),
    role: "OWNER",
    permissions: ROLE_PERMISSIONS["OWNER"],
    tenant: { id: "ten_qdrant_alpha", name: "Alpha Fashion", slug: "alpha-fashion", currency: "BDT", timezone: "Asia/Dhaka", language: "en", settings: {}, status: "ACTIVE" },
    user: { id: "usr_qdrant_01", email: "admin@alpha.com", name: "Alpha Admin", status: "ACTIVE" },
  };
  const contextA = baseContext;
  const contextB: RequestContext = { ...baseContext, requestId: "req_test_rag_b", tenant: { ...baseContext.tenant, id: "ten_qdrant_beta", name: "Beta Tech", slug: "beta-tech" } };

  db.clearAllForTesting();
  clearQdrantCache();
  delete process.env.QDRANT_URL;
  delete process.env.QDRANT_API_KEY;
  delete process.env.QDRANT_COLLECTION;

  console.log("[1. Configuration]");
  await test("Not configured without QDRANT_URL; health check says so", async () => {
    assert.strictEqual(isQdrantConfigured(contextA.tenant.id), false);
    assert.strictEqual(resolveQdrantCredentials(), null);
    assert.strictEqual((await healthCheck()).message, "QDRANT_NOT_CONFIGURED");
  });

  process.env.QDRANT_URL = `http://127.0.0.1:${port}/`;
  process.env.QDRANT_API_KEY = "test-qdrant-key";
  process.env.QDRANT_COLLECTION = "test_collection";

  await test("Resolves URL (trailing slash trimmed), key and collection from the environment", async () => {
    const creds = resolveQdrantCredentials();
    assert.ok(creds);
    assert.strictEqual(creds.url, `http://127.0.0.1:${port}`);
    assert.strictEqual(creds.apiKey, "test-qdrant-key");
    assert.strictEqual(creds.collection, "test_collection");
  });

  await test("Health check tolerates a collection that doesn't exist yet", async () => {
    const h = await healthCheck();
    assert.strictEqual(h.ok, true);
  });

  console.log("\n[2. Upsert, search and tenant isolation]");
  const meta = (tenant: string, doc: string) => ({
    tenant_id: tenant, document_id: doc, document_title: "Doc", document_type: "SHIPPING_POLICY", section_heading: "General",
    chunk_index: 0, version: 1, language: "en", content: "delivery inside Dhaka is 60 BDT", parent_chunk_id: "",
  });

  await test("First upsert creates the cosine collection and keyword indexes, sending the api-key header", async () => {
    await upsertChunks("ten_a", [{ id: "chk_1", values: [1, 0, 0], metadata: meta("ten_a", "doc_1") }]);
    const create = seen.find((r) => r.method === "PUT" && r.path === "/collections/test_collection");
    assert.deepStrictEqual(create?.body, { vectors: { size: 3, distance: "Cosine" } });
    assert.ok(seen.some((r) => r.path.endsWith("/index")));
    assert.ok(seen.every((r) => r.apiKey === "test-qdrant-key"));
  });

  await test("Same chunk id in two tenants yields two points (ids are tenant-scoped)", async () => {
    await upsertChunks("ten_b", [{ id: "chk_1", values: [1, 0, 0], metadata: meta("ten_b", "doc_9") }]);
    assert.strictEqual(points.size, 2);
  });

  await test("A caller-supplied tenant_id in metadata cannot write into another tenant", async () => {
    await upsertChunks("ten_a", [{ id: "chk_evil", values: [0, 1, 0], metadata: meta("ten_b", "doc_x") }]);
    const stored = [...points.values()].find((p) => p.payload.chunk_id === "chk_evil");
    assert.strictEqual(stored?.payload.tenant_id, "ten_a");
  });

  await test("Search sends the tenant filter and only returns that tenant's chunks", async () => {
    const hits = await searchVectors("ten_a", [1, 0, 0], 5, 0.5);
    assert.deepStrictEqual(hits.map((h) => h.id), ["chk_1"]);
    assert.strictEqual(hits[0].metadata.tenant_id, "ten_a");
    const req = [...seen].reverse().find((r) => r.path.endsWith("/points/search"));
    assert.deepStrictEqual((req?.body as { filter: FilterBody }).filter.must?.[0], { key: "tenant_id", match: { value: "ten_a" } });
  });

  await test("Score threshold is applied", async () => {
    assert.strictEqual((await searchVectors("ten_a", [0, 0, 1], 5, 0.65)).length, 0);
  });

  await test("Deleting a document removes only that tenant's vectors for it", async () => {
    await deleteDocumentVectors("ten_a", "doc_1");
    assert.strictEqual((await searchVectors("ten_a", [1, 0, 0], 5, 0.5)).length, 0);
    assert.strictEqual((await searchVectors("ten_b", [1, 0, 0], 5, 0.5)).length, 1);
  });

  console.log("\n[3. Knowledge ingestion and retrieval]");
  points.clear();
  await test("KnowledgeService ingests into Qdrant, retrieves for the owner and returns nothing for another tenant", async () => {
    const doc = await KnowledgeService.ingestDocument(contextA, {
      title: "Store Shipping Policy",
      document_type: "SHIPPING_POLICY",
      raw_content: "Standard delivery charge is 60 BDT inside Dhaka and 120 BDT outside Dhaka via Steadfast.",
      file_format: "MARKDOWN",
    });
    assert.strictEqual(doc.status, "ACTIVE");
    assert.ok(points.size > 0, "chunks must reach Qdrant");
    assert.ok([...points.values()].every((p) => p.payload.tenant_id === contextA.tenant.id));

    const own = await KnowledgeService.searchKnowledge(contextA.tenant.id, "What is the delivery charge inside Dhaka?", 3, 0.5);
    assert.ok(own.length > 0);
    assert.ok(own[0].content_snippet.includes("60 BDT") || own[0].parent_content?.includes("60 BDT"));

    const other = await KnowledgeService.searchKnowledge(contextB.tenant.id, "What is the delivery charge inside Dhaka?", 3, 0.5);
    assert.strictEqual(other.length, 0, "Cross-tenant vector search must return zero results");
  });

  server.close();
  delete process.env.QDRANT_URL;
  delete process.env.QDRANT_API_KEY;
  delete process.env.QDRANT_COLLECTION;

  console.log("\n====================================================");
  console.log(`  QDRANT RAG TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("====================================================\n");

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
