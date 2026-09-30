/**
 * End-to-end check of knowledge ingestion and retrieval against the configured embedding provider and Qdrant:
 * ingests one small document under a throwaway tenant id, searches it, checks another tenant sees nothing, then
 * deletes the document and its vectors. Prints no keys.
 *
 * Run with the store in test mode so NOTHING is written to the app's database (only Qdrant is touched, and cleaned up):
 *   NODE_ENV=test node tests/ts-runner.cjs ./scripts/check-rag.ts
 */
import { db } from "@/infrastructure/db";
import { KnowledgeService } from "@/domains/ai/rag/knowledge.service";
import { getCollectionStats, isQdrantConfigured, resolveQdrantCredentials, searchVectors } from "@/infrastructure/qdrant/client";
import { EmbeddingService } from "@/domains/ai/rag/embedding.service";
import { modelRouter } from "@/domains/ai/providers/model-router";
import type { RequestContext } from "@/lib/context";
import { ROLE_PERMISSIONS } from "@/lib/permissions";

const stamp = Date.now();
const contextFor = (tenantId: string): RequestContext => ({
  requestId: `req_rag_check_${stamp}`,
  traceId: `trace_rag_check_${stamp}`,
  timestamp: new Date().toISOString(),
  role: "OWNER",
  permissions: ROLE_PERMISSIONS["OWNER"],
  tenant: { id: tenantId, name: "RAG check", slug: tenantId, currency: "BDT", timezone: "Asia/Dhaka", language: "en", settings: {}, status: "ACTIVE" },
  user: { id: "usr_rag_check", email: "rag-check@example.invalid", name: "RAG check", status: "ACTIVE" },
});

async function collectionSize(): Promise<number | null> {
  const v = (await getCollectionStats())?.result.config?.params?.vectors;
  return v?.size ?? v?.[""]?.size ?? null;
}

async function pointCount(): Promise<number | string> {
  const stats = await getCollectionStats();
  return stats?.result.points_count ?? "collection not created yet";
}

async function main(): Promise<void> {
  await db.ready();
  const out = (line: string) => process.stdout.write(`${line}\n`);

  const status = modelRouter.getStatus();
  out(`embedding: ${status.embedding_provider ?? status.provider} / ${status.models.TIER_3_EMBEDDING}`);
  const creds = resolveQdrantCredentials();
  if (!isQdrantConfigured() || !creds) {
    out("FAIL: Qdrant is not configured (QDRANT_URL).");
    process.exit(1);
  }
  out(`qdrant collection: ${creds.collection}  points before: ${await pointCount()}`);

  const dims = (await EmbeddingService.embedText("delivery inside Dhaka")).length;
  const size = await collectionSize();
  out(`embedding dimensions: ${dims}   collection vector size: ${size ?? "n/a (not created yet)"}`);
  if (size !== null && size !== dims) {
    out(`FAIL: the collection holds ${size}-dim vectors but the embedding model returns ${dims}. Set LLM_EMBEDDING_DIMENSIONS=${size}, or use a new QDRANT_COLLECTION.`);
    process.exit(1);
  }

  const tenantA = `ten_rag_check_${stamp}`;
  const tenantB = `ten_rag_check_other_${stamp}`;
  const ctx = contextFor(tenantA);
  let failed = false;
  const check = (label: string, ok: boolean, detail = "") => {
    out(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
    if (!ok) failed = true;
  };

  let docId = "";
  try {
    const doc = await KnowledgeService.ingestDocument(ctx, {
      title: "RAG connectivity check",
      document_type: "SHIPPING_POLICY",
      raw_content: "Standard delivery charge is 60 BDT inside Dhaka and 120 BDT outside Dhaka via Steadfast. Cash on delivery is available.",
      file_format: "MARKDOWN",
    });
    docId = doc.id;
    check("ingest: document ACTIVE", doc.status === "ACTIVE", `status=${doc.status}`);
    out(`      points after ingest: ${await pointCount()}`);

    // Straight to Qdrant: the app silently falls back to local vectors on a Qdrant error, which would hide a failure
    const question = await EmbeddingService.embedText("What is the delivery charge inside Dhaka?");
    const direct = await searchVectors(tenantA, question, 3, 0.3);
    check("qdrant: the chunk is stored and found by vector search", direct.length > 0 && direct[0].metadata.content.includes("60 BDT"), `hits=${direct.length} top score=${direct[0]?.score ?? "n/a"}`);
    check("qdrant: another tenant gets nothing directly", (await searchVectors(tenantB, question, 3, 0.3)).length === 0);

    const hits = await KnowledgeService.searchKnowledge(tenantA, "What is the delivery charge inside Dhaka?", 3, 0.3);
    const text = hits.map((h) => `${h.content_snippet} ${h.parent_content ?? ""}`).join(" ");
    check("search: owner finds the delivery policy", hits.length > 0 && text.includes("60 BDT"), `hits=${hits.length} top score=${hits[0]?.similarity_score ?? "n/a"}`);

    const other = await KnowledgeService.searchKnowledge(tenantB, "What is the delivery charge inside Dhaka?", 3, 0.3);
    check("isolation: another tenant sees nothing", other.length === 0, `hits=${other.length}`);
  } catch (err) {
    check("ingest/search ran without error", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (docId) {
      await KnowledgeService.deleteDocument(ctx, docId);
      const question = await EmbeddingService.embedText("What is the delivery charge inside Dhaka?");
      const after = await searchVectors(tenantA, question, 3, 0.3).catch(() => []);
      check("cleanup: vectors deleted from qdrant", after.length === 0, `hits=${after.length}  points now: ${await pointCount()}`);
    }
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`check failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
