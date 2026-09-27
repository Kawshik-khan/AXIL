---
name: rag-engineering
description: Work on CommerceOS knowledge retrieval — ingestion, chunking, embeddings, Pinecone vectors, BM25 hybrid search, reranking, confidence thresholds and citations. Use for changes under src/domains/ai/rag or knowledge tools.
---

# RAG Engineering

Rules: `.agent/rules/rag.md`. Target design: `.agent/RAG_ARCHITECTURE.md` (partly TARGET).

## Map
| Stage | File |
|---|---|
| Ingestion / knowledge API | `src/domains/ai/rag/knowledge.service.ts` |
| Chunking | `chunking.service.ts`, `parent-child-chunking.service.ts` |
| Embeddings | `embedding.service.ts` (**fake today**, audit H14) |
| Vector store | `src/infrastructure/pinecone/client.ts` |
| Lexical | `bm25.service.ts` |
| Hybrid + fusion | `hybrid-search.service.ts` |
| Rerank | `reranker.service.ts` |
| Confidence routing | `agentic-rag.controller.ts` (`CONFIDENCE_HIGH` / `CONFIDENCE_LOW`) |
| Agent tool | `src/domains/ai/tools/implementations/knowledge-tools.ts` |

## Rules of thumb
- Every Pinecone call carries the tenant (namespace or metadata filter); every BM25 index is per tenant.
- Keep tables, fee schedules, and size charts whole; store `document_id`, `tenant_id`, `category`, `language`, `updated_at` per chunk.
- Thresholds are constants in code; if you change one, add eval cases and report before/after results.
- Below the low threshold → `UNKNOWN` → escalate; never generate an answer from weak context.
- Server-side document parsing only; client `readAsText` on PDF/DOCX produces garbage (audit M16).

## Verify
`node tests/ts-runner.cjs ./tests/agentic-rag-tests.ts`; add a cross-tenant retrieval test (tenant B query must not return tenant A chunks). `tests/pinecone-rag-tests.ts` hits live Pinecone — ask first.
