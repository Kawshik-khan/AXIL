# CommerceOS High-Level Architecture

> **Status:** Target architecture. Today: JSON-file persistence, mocked LLM, simulated integrations, unenforced platform gates — see STATUS.md §2.

## 1. System Topology

CommerceOS decouples conversational frontends, AI reasoning, workflow automation, and authoritative commerce records into clean, isolated subsystems.

```
                    COMMERCEOS PLATFORM
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
 CUSTOMER CHANNELS      AGENT RUNTIME        SCHEDULED JOBS
        │                     │                     │
 Facebook Messenger     Support Agent        Order Sync
 Facebook Comments      Sales Agent          Payment Verif.
 Instagram DMs          Product Agent        Courier Booking
 WhatsApp Business      Inventory Agent      Customer Alerts
 Website Live Chat      Order Agent          Abandoned Cart
                        Payment Agent               │
                        Delivery Agent              │
                        Finance Agent               │
                        Marketing Agent             │
                        Analytics Agent             │
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                        AGENT GATEWAY
                              │
                        POLICY ENGINE
          (RBAC, Tenant Scoping, Human Approval)
                              │
                        COMMERCE API
          (Auth, Catalog, Orders, Payments, Shipments)
                              │
              ┌───────────────┼───────────────┐
              │               │               │
          DATABASE          REDIS            RAG
         PostgreSQL       Cache/PubSub     pgvector
              │               │               │
        ACID Records     Event Queue      Knowledge
```

---

## 2. Component Responsibilities & Boundaries

### 2.1 Agent Runtime (Reasoning Layer)
- **Role**: Intelligence, user intent classification, query decomposition, context assembly, and tool selection.
- **Rules**:
  - LLMs have **no direct access** to the database or external APIs.
  - LLMs execute actions solely by invoking strongly typed tools exposed by the **Agent Gateway**.
  - All reasoning produces structured JSON outputs adhering to strict Zod schemas.

### 2.2 Policy Engine (Governance Layer)
- **Role**: Validates every tool call before execution.
- **Enforcements**:
  - Validates `tenant_id` cryptographic context.
  - Verifies user/agent role permissions against the RBAC matrix.
  - Intercepts high-risk actions (e.g., refunds $> 1000$ BDT, price overrides, inventory write-offs, bulk notifications) and routes them to the Human-in-the-Loop approval queue.
  - Rejects rate-limit violations and anomalous requests.

### 2.3 Commerce API (Authoritative Business Layer)
- **Role**: Executes business logic, enforces invariant commerce rules, manages transactions, and emits domain events.
- **Boundaries**:
  - Contains domain modules: Auth, Tenants, Products, Inventory, Orders, Payments, Shipments, Customers, Analytics.
  - Only authorized API services perform SQL queries or database transactions.

### 2.4 Database & Cache (Persistence Layer)
- **PostgreSQL 16+**: Authoritative transactional database storing multi-tenant tables, foreign keys, and indexes. Includes `pgvector` for semantic document retrieval.
- **Redis 7+**: Transient state, distributed locks for concurrent inventory reservations, rate-limiting counters, and pub/sub message brokers.

### 2.6 Frontend (Human Control Plane)
- **Role**: Modern Bento Grid dashboard giving operators full visibility and control.
- **Design Language**: Lime (`#C7F900`) accents, Charcoal (`#242529`) surfaces, Off-white (`#F5F6F3`) background, subtle glassmorphism, and a vertical floating navigation dock on desktop (bottom dock on mobile).
- **Automations Hub UI**: Comprehensive 9-tab operations dashboard (`Overview`, `Workflows`, `Templates`, `Executions`, `Dead Letter Queue`, `Providers`, `Webhooks`, `Dry-Run Simulator`, `Safety`).

---

## 3. Communication Patterns

1. **Synchronous HTTP/REST**:
   - Frontend $\leftrightarrow$ Commerce API (authenticated via JWT sessions).
   - Agent Gateway $\rightarrow$ Policy Engine $\rightarrow$ Commerce API.
2. **Asynchronous Event Bus**:
   - Commerce API emits domain events (e.g. `order.created`, `payment.verified`) to Redis Pub/Sub.
   - Workers consume events to run background jobs, courier dispatches, and customer notifications.
3. **Streaming AI Responses**:
   - Server-Sent Events (SSE) stream agent responses to the unified customer inbox and operator command palette.

---

## 4. Multi-Tenant Isolation Guarantee

Every database query, cache key, RAG vector lookup, and event payload must strictly enforce tenant scoping:

```sql
-- Invariant applied across all data access
SELECT * FROM orders 
WHERE tenant_id = :authenticated_tenant_id 
  AND id = :order_id;
```
Direct client submission of `tenant_id` in request bodies is rejected. Tenant context is resolved strictly via the cryptographically verified JWT/API token.

---

## 6. Platform Control Plane Architecture (Super Admin / SaaS Owner)

CommerceOS bifurcates authority into two distinct, non-overlapping domains:

```
                 COMMERCEOS
                     │
          ┌──────────┴──────────┐
          │                     │
     PLATFORM SCOPE        TENANT SCOPE
          │                     │
     Super Admin            Tenant Owner
     Platform Admin         Tenant Admin
     Platform Ops           Manager
     Platform Support       Sales
     Platform Finance       Inventory
     Platform Security      Finance
     Platform Analyst       Support
                            Analyst
          │                     │
          ▼                     ▼
   Platform Control         Commerce Core
        Plane                    │
          │                       ▼
          │                Commerce Events
          │                       │
          ├───────────────┬───────┼───────────────┐
          │               │       │               │
        Billing        Jobs   Intelligence      Growth
          │               │       │               │
          └───────────────┴───────┼───────────────┘
                                  │
                              Agents/
                           Workflows/
                           Automation  
```

### 6.1 Architectural Decoupling & Invariants
1. **Scope Separation**:
   - **Platform Scope**: Governs platform resources (SaaS plans, subscriptions, global entitlements, tenant lifecycles, system-wide circuit breakers, and platform audit logs). Managed via `PlatformContext`.
   - **Tenant Scope**: Governs tenant resources (products, variants, inventory, orders, customer conversations, shipments, payments). Managed via `RequestContext`.
2. **Identity & Authorization Decoupling**:
   - Platform identities reside in `PlatformMembership` records.
   - Tenant identities reside in tenant `Membership` records.
   - `TENANT_OWNER` never possesses or inherits platform authority.
   - Super Admin does not bypass tenant data isolation. When inspecting or assisting a tenant, the operator must initiate a governed, time-limited, audited `ImpersonationSession` that explicitly assumes the target tenant user's permissions in `READ_ONLY` mode by default.
3. **Control Plane Components**:
   - **Platform API Gateway**: Dedicated `/api/v1/platform/*` endpoints isolated from tenant API routes.
   - **Platform Authorization Engine**: Validates platform roles (`SUPER_ADMIN`, `PLATFORM_ADMIN`, `PLATFORM_OPERATIONS`, `PLATFORM_SUPPORT`, `PLATFORM_FINANCE`, `PLATFORM_SECURITY`, `PLATFORM_ANALYST`) and granular platform permissions.
   - **SaaS Entitlement Engine**: Centralized evaluation of plan limits, feature gates, and usage quotas, preventing scattered `if (plan === 'PRO')` conditionals.
   - **Automation Fleet Controller**: Health, telemetry, dead-letter recovery, and global/tenant emergency kill switches.
   - **Immutable Platform Audit Trail**: Append-only tamper-resistant ledger capturing all privileged platform operations with dual attribution (`original_actor_id` and `effective_actor_id`).


