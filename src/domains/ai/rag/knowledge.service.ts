import { randomSuffix } from "@/lib/ids";
/**
 * CommerceOS Phase 4: Knowledge Base & RAG Management Service
 * Multi-tenant semantic retrieval over merchant store policies, FAQs, and sizing guides.
 * Backed by the Qdrant vector database with tenant payload-filter isolation.
 */

import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";
import {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeDocumentType,
  RetrievalCitation,
  AgenticRagResult,
} from "@/types/ai";
import { ParentChildChunkingService } from "./parent-child-chunking.service";
import { ChunkingService } from "./chunking.service";
import { EmbeddingService } from "./embedding.service";
import { AgenticRagController } from "./agentic-rag.controller";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import crypto from "crypto";

const contentHash = (title: string, content: string) =>
  crypto.createHash("sha256").update(`${title.trim()}\n${content.replace(/\r\n/g, "\n").trim()}`).digest("hex");

export class KnowledgeService {
  /**
   * List knowledge documents for tenant
   */
  public static async listDocuments(
    context: RequestContext,
    options?: { document_type?: string; status?: string }
  ): Promise<KnowledgeDocument[]> {
    RbacService.assertCan(context, PERMISSIONS.AI_KNOWLEDGE_READ);
    return db.getKnowledgeDocuments(context.tenant.id, options);
  }

  /**
   * Get single knowledge document with chunk details
   */
  public static async getDocumentById(
    context: RequestContext,
    documentId: string
  ): Promise<{ document: KnowledgeDocument; chunks: KnowledgeChunk[] }> {
    RbacService.assertCan(context, PERMISSIONS.AI_KNOWLEDGE_READ);
    const doc = db.findKnowledgeDocumentById(context.tenant.id, documentId);
    if (!doc) {
      throw new NotFoundError(`Knowledge document '${documentId}' not found.`);
    }
    const chunks = db.getKnowledgeChunks(context.tenant.id, documentId);
    return { document: doc, chunks };
  }

  /**
   * Ingest a store policy or guide (FX-82): the content hash decides what happens.
   * - Same title, same content as an existing document: nothing changes, the existing document comes back.
   * - Same title, changed content: that document's chunks are replaced and its version goes up.
   * - New title: a new document.
   */
  public static async ingestDocument(
    context: RequestContext,
    payload: {
      title: string;
      document_type: KnowledgeDocumentType;
      raw_content: string;
      file_format?: KnowledgeDocument["file_format"];
      tags?: string[];
      language?: "bn" | "en" | "mixed";
      customer_visible?: boolean;
    }
  ): Promise<KnowledgeDocument> {
    RbacService.assertCan(context, PERMISSIONS.AI_KNOWLEDGE_MANAGE);

    if (!payload.title || !payload.title.trim()) {
      throw new BadRequestError("Document title is required.");
    }
    if (!payload.raw_content || !payload.raw_content.trim()) {
      throw new BadRequestError("Document content cannot be empty.");
    }

    const tenantId = context.tenant.id;
    const title = payload.title.trim();
    const hash = contentHash(title, payload.raw_content);
    const existing = db
      .getKnowledgeDocuments(tenantId)
      .find((d) => d.title.trim().toLowerCase() === title.toLowerCase() && d.status !== "ARCHIVED");
    if (existing && existing.content_hash === hash && existing.status === "ACTIVE" && (payload.customer_visible === undefined || existing.customer_visible === payload.customer_visible)) return existing;

    const now = new Date().toISOString();
    let document: KnowledgeDocument;
    if (existing) {
      document = db.updateKnowledgeDocument(tenantId, existing.id, {
        raw_content: payload.raw_content,
        document_type: payload.document_type,
        file_format: payload.file_format || existing.file_format,
        language: payload.language || existing.language,
        tags: payload.tags || existing.tags,
        status: "PROCESSING",
        version: existing.version + 1,
        content_hash: hash,
        ...(payload.customer_visible !== undefined ? { customer_visible: payload.customer_visible } : {}),
        processing_error: undefined,
      })!;
    } else {
      document = {
        id: `kdoc_${Date.now()}_${randomSuffix()}`,
        tenant_id: tenantId,
        title,
        document_type: payload.document_type,
        file_format: payload.file_format || "MARKDOWN",
        raw_content: payload.raw_content,
        status: "PROCESSING",
        version: 1,
        chunk_count: 0,
        language: payload.language || "mixed",
        tags: payload.tags || [],
        content_hash: hash,
        ...(payload.customer_visible !== undefined ? { customer_visible: payload.customer_visible } : {}),
        created_at: now,
        updated_at: now,
      };
      db.createKnowledgeDocument(document);
    }

    try {
      return await this.indexDocument(tenantId, document);
    } catch (err) {
      db.updateKnowledgeDocument(tenantId, document.id, {
        status: "DRAFT",
        processing_error: err instanceof Error ? err.message : "Failed to process and embed document.",
      });
      throw err;
    }
  }

  /**
   * Re-chunks and re-embeds an existing document as a new version.
   */
  public static async reindexDocument(
    context: RequestContext,
    documentId: string
  ): Promise<KnowledgeDocument> {
    RbacService.assertCan(context, PERMISSIONS.AI_KNOWLEDGE_MANAGE);
    const doc = db.findKnowledgeDocumentById(context.tenant.id, documentId);
    if (!doc) {
      throw new NotFoundError(`Knowledge document '${documentId}' not found.`);
    }
    if (!doc.raw_content) {
      throw new BadRequestError("Document has no raw content to reindex.");
    }
    const bumped = db.updateKnowledgeDocument(context.tenant.id, doc.id, { version: doc.version + 1, processing_error: undefined })!;
    return this.indexDocument(context.tenant.id, bumped);
  }

  /**
   * Chunks, embeds and stores one document at its current version; every chunk is stamped with the version's time,
   * the source and the embedding model (FX-82). Replaces the document's previous chunks.
   */
  private static async indexDocument(tenantId: string, doc: KnowledgeDocument): Promise<KnowledgeDocument> {
    const { parentChunks, childChunks } = ParentChildChunkingService.chunkDocumentHierarchically(tenantId, doc.id, doc.raw_content ?? "", {
      document_title: doc.title,
      document_type: doc.document_type,
      version: doc.version,
      language: doc.language,
    });
    const childEmbeddings = await EmbeddingService.embedBatch(childChunks.map((c) => `${c.section_heading}\n${c.content}`));
    const stamp = EmbeddingService.currentStamp();
    const versionAt = new Date().toISOString();
    childChunks.forEach((c, idx) => {
      c.embedding = childEmbeddings[idx];
    });
    const allChunks = [...parentChunks, ...childChunks].map((c) => ({
      ...c,
      metadata: {
        ...c.metadata,
        updated_at: versionAt,
        source: `${doc.document_type}:${doc.title}`,
        ...(c.chunk_type === "PARENT" ? {} : { embedding_model: stamp.embedding_model, dimensions: stamp.dimensions ?? c.embedding.length }),
      },
    }));
    db.saveKnowledgeChunks(tenantId, doc.id, allChunks);

    try {
      const { isQdrantConfigured, upsertChunks, deleteDocumentVectors } = await import("@/infrastructure/qdrant/client");
      if (isQdrantConfigured(tenantId)) {
        await deleteDocumentVectors(tenantId, doc.id); // a changed document leaves no stale vectors behind
        await upsertChunks(
          tenantId,
          allChunks
            .filter((c) => c.chunk_type !== "PARENT")
            .map((c) => ({
              id: c.id,
              values: c.embedding,
              metadata: {
                tenant_id: tenantId,
                document_id: doc.id,
                document_title: doc.title,
                document_type: doc.document_type,
                section_heading: c.section_heading || "General",
                chunk_index: c.chunk_index,
                version: doc.version,
                language: doc.language || "mixed",
                content: c.content,
                parent_chunk_id: c.parent_chunk_id || "",
              },
            }))
        );
      }
    } catch (err) {
      logger.warn("rag.qdrant_upsert_failed", { tenant_id: tenantId, document_id: doc.id, error: err instanceof Error ? err.message : "error" });
    }

    return db.updateKnowledgeDocument(tenantId, doc.id, { status: "ACTIVE", chunk_count: allChunks.length, processing_error: undefined })!;
  }

  /**
   * Re-index job (FX-82): re-embeds chunks whose embedding model or vector size differs from the current configuration,
   * in batches with a pause between them. Every workspace, or one. Returns what it did.
   */
  public static async reembedStaleChunks(options: { tenantId?: string; batchSize?: number; pauseMs?: number; maxChunks?: number } = {}): Promise<{ checked: number; reembedded: number; failed: number }> {
    const stamp = EmbeddingService.currentStamp();
    const batchSize = options.batchSize ?? 20;
    const tenants = options.tenantId ? [options.tenantId] : db.getTenants().map((t) => t.id);
    const stats = { checked: 0, reembedded: 0, failed: 0 };
    for (const tenantId of tenants) {
      const stale = db
        .getAllTenantKnowledgeChunks(tenantId)
        .filter((c) => c.chunk_type !== "PARENT")
        .filter((c) => c.metadata.embedding_model !== stamp.embedding_model || (stamp.dimensions !== undefined && c.metadata.dimensions !== stamp.dimensions));
      stats.checked += stale.length;
      for (let i = 0; i < stale.length; i += batchSize) {
        for (const c of stale.slice(i, i + batchSize)) {
          if (options.maxChunks !== undefined && stats.reembedded + stats.failed >= options.maxChunks) return stats;
          try {
            const vector = await EmbeddingService.embedText(`${c.section_heading}\n${c.content}`);
            db.updateKnowledgeChunkEmbedding(tenantId, c.id, vector, stamp);
            stats.reembedded++;
          } catch {
            stats.failed++; // counted by EmbeddingService too
          }
        }
        if (options.pauseMs && i + batchSize < stale.length) await new Promise((r) => setTimeout(r, options.pauseMs));
      }
    }
    return stats;
  }

  /**
   * The customer agent's policy search (FX-82, audit F13): the top 2 distinct ACTIVE documents, each as its best chunk
   * plus that chunk's parent section, with no score cutoff. The agent decides what is relevant; the text is untrusted.
   */
  public static async searchPolicyDocuments(
    tenantId: string,
    query: string,
    maxDocuments = 2
  ): Promise<Array<{ document_id: string; title: string; section: string; updated_at?: string; text: string }>> {
    const res = await AgenticRagController.execute(tenantId, query, {
      topK: 10,
      rerankTopK: 10,
      minRerankScore: 0,
      resolveParentContext: true,
      enableQueryExpansion: true,
    });
    const out: Array<{ document_id: string; title: string; section: string; updated_at?: string; text: string }> = [];
    const seen = new Set<string>();
    for (const c of res.citations) {
      if (seen.has(c.document_id)) continue;
      const doc = db.findKnowledgeDocumentById(tenantId, c.document_id);
      if (!doc || doc.status !== "ACTIVE" || doc.customer_visible === false) continue; // staff-only documents never reach customers
      seen.add(c.document_id);
      const parent = c.parent_content && !c.parent_content.includes(c.content_snippet) ? `${c.content_snippet}\n\n${c.parent_content}` : c.parent_content || c.content_snippet;
      out.push({ document_id: doc.id, title: doc.title, section: c.section, updated_at: db.findKnowledgeChunkById(tenantId, c.chunk_id)?.metadata.updated_at ?? doc.updated_at, text: parent });
      if (out.length >= maxDocuments) break;
    }
    return out;
  }

  /**
   * Search knowledge base using Agentic RAG Controller (Hybrid Search + Reranking + Parent Context Resolution)
   */
  public static async searchKnowledge(
    tenantId: string,
    query: string,
    topK: number = 3,
    minScore: number = 0.60
  ): Promise<RetrievalCitation[]> {
    const result = await AgenticRagController.execute(tenantId, query, {
      topK,
      confidenceThresholdLow: minScore,
      resolveParentContext: true,
      enableQueryExpansion: true,
    });

    return result.citations;
  }

  /**
   * Full Agentic RAG execution with complete step traces, expanded queries, and confidence metrics.
   */
  public static async queryAgenticRag(
    tenantId: string,
    query: string,
    options?: { topK?: number; confidenceThresholdLow?: number }
  ): Promise<AgenticRagResult> {
    return AgenticRagController.execute(tenantId, query, {
      topK: options?.topK || 3,
      confidenceThresholdLow: options?.confidenceThresholdLow || 0.60,
      resolveParentContext: true,
      enableQueryExpansion: true,
    });
  }

  /**
   * Archive document
   */
  public static async archiveDocument(
    context: RequestContext,
    documentId: string
  ): Promise<KnowledgeDocument> {
    RbacService.assertCan(context, PERMISSIONS.AI_KNOWLEDGE_MANAGE);
    const updated = db.updateKnowledgeDocument(context.tenant.id, documentId, {
      status: "ARCHIVED",
    });
    if (!updated) {
      throw new NotFoundError(`Knowledge document '${documentId}' not found.`);
    }
    return updated;
  }

  /**
   * Delete document and its chunks
   */
  public static async deleteDocument(
    context: RequestContext,
    documentId: string
  ): Promise<boolean> {
    RbacService.assertCan(context, PERMISSIONS.AI_KNOWLEDGE_MANAGE);

    try {
      const { isQdrantConfigured, deleteDocumentVectors } = await import("@/infrastructure/qdrant/client");
      if (isQdrantConfigured(context.tenant.id)) {
        await deleteDocumentVectors(context.tenant.id, documentId);
      }
    } catch (pcErr) {
      console.warn("[Qdrant] Delete vectors warning:", pcErr);
    }

    return db.deleteKnowledgeDocument(context.tenant.id, documentId);
  }
}
