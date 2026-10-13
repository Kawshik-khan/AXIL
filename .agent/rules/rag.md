---
trigger: glob
description: Tenant-scoped retrieval, thresholds in code, citations
globs: src/domains/ai/rag/**/*
---

# Retrieval-Augmented Generation (RAG) Rules

1. **Tenant scoping**: every Qdrant vector and BM25 query filters by the context's `tenant_id` (Qdrant tenant payload filter or tenant-scoped store query). Cross-tenant retrieval is a critical vulnerability.

2. **Confidence thresholds live in code**: `CONFIDENCE_HIGH` / `CONFIDENCE_LOW` in `src/domains/ai/rag/agentic-rag.controller.ts` and the `minScore` default in `knowledge.service.ts`. Don't restate numbers in docs or prompts; change the constant (with an eval run) if a threshold must move.
   - Below the low threshold, the context is `UNKNOWN`: the agent says it doesn't know and offers human escalation. Never turn UNKNOWN into a fact.

3. **Citations**: answers built from RAG context carry source metadata (document id/title/section) in the execution trace.

4. **Chunk integrity**: don't split tables, fee schedules, or size charts across chunks; keep markdown structure (`chunking.service.ts`, `parent-child-chunking.service.ts`).

5. **Honesty about embeddings**: embeddings use the configured provider through `ModelRouter`; demo mode may use the mock, and absent configuration must fail closed. Provider wiring alone does not establish semantic quality: report model, dimensions, index version, and evaluation evidence. Do not describe heuristic reranking scores as calibrated confidence.
