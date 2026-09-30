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
   * Ingest and index new store policy or guide into Qdrant
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
    const docId = `kdoc_${Date.now()}_${randomSuffix()}`;

    // 1. Create Document in PROCESSING state
    const document: KnowledgeDocument = {
      id: docId,
      tenant_id: tenantId,
      title: payload.title.trim(),
      document_type: payload.document_type,
      file_format: payload.file_format || "MARKDOWN",
      raw_content: payload.raw_content,
      status: "PROCESSING",
      version: 1,
      chunk_count: 0,
      language: payload.language || "mixed",
      tags: payload.tags || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.createKnowledgeDocument(document);

    try {
      // 2. Hierarchical Parent-Child Chunking
      const { parentChunks, childChunks } = ParentChildChunkingService.chunkDocumentHierarchically(
        tenantId,
        docId,
        payload.raw_content,
        {
          document_title: payload.title.trim(),
          document_type: payload.document_type,
          version: 1,
          language: payload.language || "mixed",
        }
      );

      // 3. Dense Vector Embeddings for Child Chunks
      const childTexts = childChunks.map((c) => `${c.section_heading}\n${c.content}`);
      const childEmbeddings = await EmbeddingService.embedBatch(childTexts);
      childChunks.forEach((c, idx) => {
        c.embedding = childEmbeddings[idx] || new Array(1536).fill(0);
      });

      // 4. Save both Parent and Child Chunks locally in DB
      const allChunks = [...parentChunks, ...childChunks];
      db.saveKnowledgeChunks(tenantId, docId, allChunks);

      // 5. Upsert child chunks to Qdrant if configured
      try {
        const { isQdrantConfigured, upsertChunks } = await import("@/infrastructure/qdrant/client");
        if (isQdrantConfigured(tenantId)) {
          await upsertChunks(
            tenantId,
            childChunks.map((c) => ({
              id: c.id,
              values: c.embedding,
              metadata: {
                tenant_id: tenantId,
                document_id: docId,
                document_title: payload.title,
                document_type: payload.document_type,
                section_heading: c.section_heading || "General",
                chunk_index: c.chunk_index,
                version: 1,
                language: payload.language || "mixed",
                content: c.content,
                parent_chunk_id: c.parent_chunk_id || "",
              },
            }))
          );
        }
      } catch (pcErr) {
        console.warn("[Qdrant] Ingestion warning, fallback used:", pcErr);
      }

      // 6. Transition to ACTIVE
      const updated = db.updateKnowledgeDocument(tenantId, docId, {
        status: "ACTIVE",
        chunk_count: allChunks.length,
      });

      return updated || document;
    } catch (err: any) {
      db.updateKnowledgeDocument(tenantId, docId, {
        status: "DRAFT",
        processing_error: err.message || "Failed to process and embed document.",
      });
      throw err;
    }
  }

  /**
   * Reindex existing document using Hierarchical Parent-Child Chunking
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

    const newVersion = doc.version + 1;
    const { parentChunks, childChunks } = ParentChildChunkingService.chunkDocumentHierarchically(
      context.tenant.id,
      doc.id,
      doc.raw_content,
      {
        document_title: doc.title,
        document_type: doc.document_type,
        version: newVersion,
        language: doc.language,
      }
    );

    const childTexts = childChunks.map((c) => `${c.section_heading}\n${c.content}`);
    const childEmbeddings = await EmbeddingService.embedBatch(childTexts);
    childChunks.forEach((c, idx) => {
      c.embedding = childEmbeddings[idx] || new Array(1536).fill(0);
    });

    const allChunks = [...parentChunks, ...childChunks];
    db.saveKnowledgeChunks(context.tenant.id, doc.id, allChunks);

    // 5. Upsert child chunks to Qdrant if configured
    try {
      const { isQdrantConfigured, upsertChunks } = await import("@/infrastructure/qdrant/client");
      if (isQdrantConfigured(context.tenant.id)) {
        await upsertChunks(
          context.tenant.id,
          childChunks.map((c) => ({
            id: c.id,
            values: c.embedding,
            metadata: {
              tenant_id: context.tenant.id,
              document_id: doc.id,
              document_title: doc.title,
              document_type: doc.document_type,
              section_heading: c.section_heading || "General",
              chunk_index: c.chunk_index,
              version: newVersion,
              language: doc.language || "mixed",
              content: c.content,
              parent_chunk_id: c.parent_chunk_id || "",
            },
          }))
        );
      }
    } catch (pcErr) {
      console.warn("[Qdrant] Reindex warning:", pcErr);
    }

    const updated = db.updateKnowledgeDocument(context.tenant.id, doc.id, {
      version: newVersion,
      chunk_count: allChunks.length,
      status: "ACTIVE",
      processing_error: undefined,
    });

    return updated!;
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
