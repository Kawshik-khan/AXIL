# CommerceOS RAG Architecture & Knowledge Retrieval

> **Status:** PARTIAL. Vectors live in Pinecone (not pgvector) and embeddings are fake (H14). Thresholds: see constants in `src/domains/ai/rag/agentic-rag.controller.ts` — numbers below are design intent.

## 1. Retrieval-Augmented Generation (RAG) Pipeline

CommerceOS grounds conversational agents in authoritative merchant knowledge (return policies, shipping charges, delivery timelines, product sizing guides, FAQs).

```
 Merchant Document (PDF, Markdown, Web Text)
                   │
                   ▼
 [ 1. Ingestion & Text Sanitization ]
                   │
                   ▼
 [ 2. Semantic Chunking (300–500 tokens, 50-token overlap) ]
                   │
                   ▼
 [ 3. Multilingual Embedding Generation (1536 dims) ]
                   │
                   ▼
 [ 4. pgvector Storage with mandatory `tenant_id` ]
                   │
                   │  ◄─── Customer Query (Bangla/Banglish/English)
                   ▼
 [ 5. Tenant-Scoped Vector Distance Query (Cosine Similarity) ]
                   │
                   ▼
 [ 6. BM25 + Vector Hybrid Retrieval & Reciprocal Rank Fusion ]
                   │
                   ▼
 [ 7. Relevance Filtering & Confidence Threshold (score >= 0.72) ]
                   │
                   ▼
 [ 8. Grounded Agent Context Injection with Strict Citations ]
```

---

## 2. Document Ingestion & Chunking Strategy

1. **Sources Supported**:
   - Store Policies: Return & refund rules, COD terms, shipping fees inside/outside Dhaka.
   - FAQs: Frequently asked operational questions.
   - Sizing Charts: Chest, length, waist measurements for apparel.
   - Product Manuals & Care Guides.
2. **Chunking Rules**:
   - Preserve markdown tables intact (especially size charts and fee schedules).
   - Chunk size: 300–500 tokens. Overlap: 50 tokens.
   - Every chunk stores structured metadata: `document_id`, `tenant_id`, `category`, `language`, `updated_at`.

---

## 3. Trust Model & Confidence Thresholds

For all customer-facing automated responses:
- **High Confidence ($\ge 0.85$)**: Grounded direct answer with policy citation.
- **Moderate Confidence ($0.70 - 0.84$)**: Grounded answer accompanied by an escalation suggestion if the customer needs further help.
- **Low Confidence ($< 0.70$)**:
  - The agent states clearly that the specific detail is unavailable.
  - Generates an operational alert for human support handoff.
  - **Zero Conversion of UNKNOWN into Fact**: Under no circumstance will the agent guess delivery fees, stock levels, or warranty terms.

---

## 4. Multi-Tenant Vector Security

All vector search queries must include an indexed relational filter:
```sql
SELECT content, metadata, 1 - (embedding <=> :query_embedding) AS similarity
FROM knowledge_chunks
WHERE tenant_id = :authenticated_tenant_id
  AND (1 - (embedding <=> :query_embedding)) >= 0.70
ORDER BY similarity DESC
LIMIT 5;
```
Cross-tenant retrieval is physically prevented at the query formulation layer.
