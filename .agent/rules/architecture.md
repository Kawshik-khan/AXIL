---
trigger: always_on
description: Layer boundaries: Agent -> Policy -> API -> Store; no LLM storage access
---

# Architecture Rules & Boundary Invariants

1. **Strict Layer Decoupling**:
   - Presentation (Frontend Bento) $\rightarrow$ API Layer.
   - API Layer $\rightarrow$ Domain Services.
   - Domain Services $\rightarrow$ Database / Provider Adapters.
   - Agents $\rightarrow$ Policy Engine $\rightarrow$ Commerce API.
   - Under no circumstance may a lower layer depend on a higher layer.

2. **Prohibited Architectural Anti-Patterns**:
   - **No Monolithic AI Service**: Do not centralize unrelated domain logic inside an AI controller.
   - **No Direct Database Querying by Agents or LLMs**: All data access must pass through typed domain APIs.
   - **No Unrestricted External HTTP Execution by Agents**: Tool calling must target internal validated endpoints.
   - **No n8n as Authoritative Database**: Workflows orchestrate events; the PostgreSQL database holds source of truth.

3. **Domain Ownership**:
   - Each business entity (Order, Product, Customer, Payment, Shipment) belongs strictly to its domain service. Cross-domain mutations must use explicit domain service methods or event messages.
