---
trigger: always_on
description: Tenant data boundary across storage, cache, queues, RAG, n8n
---

# Tenant Isolation & Data Boundary Rules

## 1. Prime Isolation Invariant
Multi-tenant isolation is absolute and non-negotiable. Tenant data is isolated by default across storage, memory, caches, queues, and API surfaces:

```
┌────────────────────────────────────────────────────────┐
│              TENANT ISOLATION BARRIER                  │
├────────────────────────────────────────────────────────┤
│ 1. Storage: All queries indexed/filtered by tenant_id │
│ 2. Memory: Contexts bound to request lifecycle only   │
│ 3. Cache: Redis keys prefixed: tenant:{tenant_id}:*    │
│ 4. Queues: Every job message carries tenant_id claim   │
│ 5. AI/RAG: Vectors filtered by tenant_id in pgvector   │
│ 6. n8n: Outbound payloads cryptographically scoped    │
└────────────────────────────────────────────────────────┘
```

---

## 2. Inviolable Tenancy Rules
1. **Server-Side Context Resolution**:
   - Every tenant-scoped database query must resolve `tenant_id` server-side from the authenticated, cryptographically signed token.
   - **NEVER** trust client-provided `tenant_id` in request bodies, URL params, or query parameters.
   - **NEVER** accept arbitrary `tenant_id` from client payloads as evidence of access rights.

2. **Platform Access is Not Raw Database Access**:
   - Possessing `SUPER_ADMIN` platform privileges does **NOT** grant a license to issue raw, un-scoped SQL queries or browse unmasked tenant records.
   - Platform dashboards must operate through domain services that return aggregated telemetry, metadata, and operational health signals rather than raw tenant records.

3. **Zero Cross-Tenant Leakage in Aggregations**:
   - Platform aggregate queries (e.g. cross-tenant MRR, system error rates) must return the minimum necessary summary information.
   - Cross-tenant queries must never expose raw customer PII, phone numbers, addresses, or order details across tenant boundaries.

4. **Impersonation Boundary Integrity**:
   - Impersonating a tenant user creates a tenant-scoped session containing only that tenant user's permissions.
   - Impersonation does **NOT** allow cross-tenant hopping. The session is strictly bound to the target `tenant_id`.
   - Impersonation does **NOT** grant platform privileges.

5. **Cache & Queue Isolation**:
   - All Redis cache keys, locks, and counters for tenant resources must be namespaced: `tenant:{tenant_id}:{resource}:{id}`.
   - Every background job and queue message (`events.domain`, `webhooks.outbound`, `shipments.sync`) must carry an explicit, immutable `tenant_id`. Workers must re-verify tenant active status prior to processing.

6. **Structured Logging & Masking**:
   - Operational logs must capture `tenant_id` for traceability without leaking sensitive customer PII or raw secrets.
