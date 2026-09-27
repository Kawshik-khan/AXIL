# CommerceOS Multi-Agent Architecture & Orchestration

> **Status:** PARTIAL. Agents, tool registry, and policy service exist in `src/domains/ai/`; the LLM is a keyword mock (H14). Agent behaviour specs: `runtime-agents/`.

## 1. Multi-Agent Orchestrator Model

CommerceOS implements a deterministic, multi-agent orchestrator that decomposes user requests and routes them to specialized agents.

```
                  Incoming User / Customer Interaction
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │      AGENT ORCHESTRATOR     │
                    │  - Intent Classification    │
                    │  - Language Detection (BN)  │
                    │  - Context Aggregation      │
                    └──────────────┬──────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 ┌──────────────┐           ┌──────────────┐           ┌──────────────┐
 │CUSTOMER SUPP.│           │ SALES AGENT  │           │ ORDER AGENT  │
 │ - FAQ & RAG  │           │ - Lead Qual. │           │ - Order Stat.│
 │ - Policies   │           │ - Catalog Rec│           │ - Cancel Req.│
 └──────┬───────┘           └──────┬───────┘           └──────┬───────┘
        │                          │                          │
        └──────────────────────────┼──────────────────────────┘
                                   │ Tool Call Invocation
                                   ▼
                    ┌─────────────────────────────┐
                    │        POLICY ENGINE        │
                    │ - Permission Validation     │
                    │ - Human-in-the-Loop Check   │
                    │ - Rate & Budget Enforcer    │
                    └──────────────┬──────────────┘
                                   │ Approved Tool
                                   ▼
                    ┌─────────────────────────────┐
                    │      COMMERCE CORE API      │
                    │ - Inventory / Product Look  │
                    │ - Orders / Payments Core    │
                    └─────────────────────────────┘
```

---

## 2. Specialized Agents Catalog

| Agent Name | Primary Responsibility | Permitted Tools | Forbidden Tools |
| :--- | :--- | :--- | :--- |
| **1. Customer Support Agent** | FAQ answering, shipping policies, return guidelines, business hours. | `knowledge.search`, `order.lookup`, `policy.get` | `order.cancel`, `refund.issue`, `product.update` |
| **2. Sales Agent** | Buying intent identification, lead qualification, product recommendations. | `product.search`, `inventory.check`, `lead.create` | `discount.create_arbitrary`, `order.create_direct` |
| **3. Product Agent** | Attribute extraction, catalog tagging, product performance insights. | `product.list`, `product.get_metrics`, `category.list` | `price.bulk_update` (without approval) |
| **4. Inventory Agent** | Stockout forecasting, restock alerts, dead stock detection. | `inventory.get_status`, `inventory.forecast` | `inventory.write_off`, `po.auto_purchase` |
| **5. Order Agent** | Order lookup, delivery address update proposal, cancellation intake. | `order.get_status`, `order.propose_update` | `order.hard_delete`, `refund.execute` |
| **6. Payment Agent** | Transaction matching assistance, MFS verification status explanation. | `payment.check_status`, `transaction.lookup` | `payment.mark_verified_manually` |
| **7. Delivery Agent** | Courier tracking interpretation, delivery exception alerts. | `courier.track`, `courier.get_eta` | `shipment.cancel_in_transit` |
| **8. Marketing Agent** | Abandoned cart copy generation, customer segment analysis. | `customer.get_segments`, `campaign.draft` | `campaign.send_mass` (requires Human approval) |
| **9. SEO Agent** | Product title/description generation, meta tag suggestions. | `product.get`, `seo.generate_metadata` | `site.publish_direct` |
| **10. Finance Agent**| Revenue analysis, COD discrepancy detection, daily summaries. | `finance.get_summary`, `cod.reconcile_report`| `ledger.alter_records` |
| **11. Analytics Agent**| GMV, AOV, RTO rate, and cohort calculation summaries. | `analytics.get_kpis`, `analytics.run_cohort` | Direct SQL generation |
| **12. Social Commerce Agent**| Multi-channel comment-to-lead routing, social greeting. | `conversation.route`, `message.send_reply` | Public pricing fabrication |
| **13. Knowledge Agent**| Semantic search retrieval over uploaded PDFs and policies. | `rag.retrieve_chunks`, `rag.get_citations` | Data insertion |
| **14. Automation Agent**| Triggers n8n workflows based on approved operational events. | `workflow.trigger`, `workflow.get_status` | Direct workflow modification |

---

## 3. Tool Calling Protocol & Schemas

Every tool exposed to the Agent Runtime is strictly defined with Zod schemas:
```typescript
export const ProductSearchToolSchema = z.object({
  query: z.string().describe("Search term in English, Bangla, or Banglish"),
  category: z.string().optional(),
  max_price: z.number().positive().optional(),
  in_stock_only: z.boolean().default(true)
});
```

---

## 4. Policy Engine & Human-in-the-Loop (HITL) Gate

When an agent proposes an action with business or financial implications:
1. **Low-Risk Actions** (e.g. searching products, looking up tracking, drafting a message): Executed immediately by the Policy Engine.
2. **High-Risk Actions** (e.g. issuing a refund, modifying a confirmed order, launching a broadcast campaign, applying discounts $> 10\%$):
   - Policy Engine marks the tool call status as `PENDING_HUMAN_APPROVAL`.
   - Generates an actionable notification in the operator dashboard.
   - Execution is suspended until an operator approves or rejects the action via the UI.

---

## 5. Model Routing & Cost Management

To optimize cost and latency, requests are routed based on task complexity:
- **Tier 0: System One Decision Engine** (TypeSafe AI Jev): Sub-20ms parallel evaluation for intent classification, urgency probability, AutoMode tool risk gating, and Bangladesh COD/RTO risk scoring.
- **Tier 1: Fast / Low-Cost Model** (e.g. Gemini 1.5 Flash / Claude 3.5 Haiku / GPT-4o mini): Conversational customer greetings, sentiment tagging, FAQ retrieval, routine customer dialog.
- **Tier 2: Reasoning Model** (e.g. Claude 3.5 Sonnet / GPT-4o): Complex sales objections, order dispute resolution, marketing campaign drafting, financial anomaly analysis.
- **Tier 3: Embedding Model** (e.g. `text-embedding-3-small` or open-source multilingual embedding): Document chunk vectorization and query embedding.

