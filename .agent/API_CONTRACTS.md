# CommerceOS REST API Contracts & Endpoint Specifications

> **Status:** Design reference. The authoritative contract is the route handler in `src/app/api/v1/**/route.ts`; update this file when you change one.

## 1. Global API Conventions

All CommerceOS endpoints are versioned under `/api/v1/`.

### 1.1 Headers
- `Authorization: Bearer <jwt_or_api_key>` (Required for all non-public routes).
- `X-Correlation-ID: <uuid>` (Optional; generated if missing).
- `Idempotency-Key: <unique_string>` (Required on mutating requests: orders, payments, refunds).

### 1.2 Standard Success Envelope
```json
{
  "success": true,
  "data": {},
  "meta": {
    "request_id": "req_01J8K9L0M1N2P3",
    "timestamp": "2026-09-19T09:35:00.000Z",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 142,
      "total_pages": 8
    }
  }
}
```

### 1.3 Standard Error Envelope
Stack traces are never exposed to clients.
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Only 2 units of SKU 'TSHIRT-BLK-XL' are available.",
    "details": {
      "sku": "TSHIRT-BLK-XL",
      "available": 2,
      "requested": 3
    },
    "request_id": "req_01J8K9L0M1N2P3"
  }
}
```

---

## 2. Core API Endpoint Catalog

### Authentication & Tenants (`/api/v1/auth`, `/api/v1/tenants`)
- `POST /api/v1/auth/login`: Authenticate operator; return session JWT.
- `POST /api/v1/auth/refresh`: Refresh expired token.
- `GET /api/v1/tenants/current`: Retrieve active tenant profile and settings.
- `PATCH /api/v1/tenants/current`: Update tenant delivery rates, currencies, business hours.

### Catalog & Inventory (`/api/v1/products`, `/api/v1/inventory`)
- `GET /api/v1/products`: List products (filters: category, status, search).
- `POST /api/v1/products`: Create a new product with variants.
- `GET /api/v1/products/:id`: Get detailed product specs and stock.
- `PATCH /api/v1/products/:id`: Update product title, price, or media.
- `GET /api/v1/inventory`: List stock levels, reserved units, and low-stock alerts.
- `POST /api/v1/inventory/adjust`: Authoritatively adjust physical stock (requires Manager role).

### Orders & Fulfillment (`/api/v1/orders`, `/api/v1/shipments`)
- `GET /api/v1/orders`: Paginated orders with status filtering.
- `POST /api/v1/orders`: Create an order (validates stock, calculates delivery fees, locks inventory).
- `GET /api/v1/orders/:id`: Full order details, line items, and audit timeline.
- `PATCH /api/v1/orders/:id/status`: Update order state (`CONFIRMED`, `CANCELLED`).
- `POST /api/v1/shipments`: Create courier shipment booking (Steadfast/Pathao).
- `GET /api/v1/shipments/:id/track`: Fetch real-time courier tracking events.

### Payments & Financials (`/api/v1/payments`)
- `POST /api/v1/payments/verify`: Verify an MFS transaction ID (bKash/Nagad).
- `POST /api/v1/payments/refund`: Request or execute a refund (HITL policy gated).
- `POST /api/v1/payments/webhooks/:provider`: Public ingress for payment gateway callbacks.

### Social Commerce & Omnichannel API (`/api/v1/social/*`)
- `GET /api/v1/social/channels`: List connected channels with encrypted credentials masked.
- `POST /api/v1/social/channels`: Connect a new channel (Facebook, Instagram, WhatsApp, Website Chat).
- `POST /api/v1/social/channels/:id/test`: Verify provider credential handshake and health status.
- `GET /api/v1/social/conversations`: Unified inbox list across all channels with status, unread, tag, and search filtering.
- `GET /api/v1/social/conversations/:id/messages`: Paginated message thread history (cursor-based).
- `POST /api/v1/social/conversations/:id/messages`: Send outbound customer message with token-bucket rate limiting and idempotency.
- `POST /api/v1/social/conversations/:id/notes`: Add internal operator note (strictly isolated from customer delivery).
- `POST /api/v1/social/conversations/:id/assign`: Assign conversation to team or user with audit logging.
- `POST /api/v1/social/conversations/:id/resolve`: Mark conversation as RESOLVED.
- `POST /api/v1/social/conversations/:id/reopen`: Reopen resolved conversation.
- `POST /api/v1/social/conversations/:id/read`: Reset unread counter for conversation.
- `POST /api/v1/social/conversations/:id/tags`: Tag conversation (e.g., VIP, HIGH_INTENT).
- `GET /api/v1/social/leads`: List captured social leads and qualification scores.
- `POST /api/v1/social/leads`: Capture or update lead buying intent.
- `GET /api/v1/social/quick-replies`: List quick-reply canned templates.
- `GET /api/v1/social/business-hours`: Retrieve tenant operational business hours.
- `GET /api/v1/social/analytics`: Real-time aggregated social commerce KPIs and channel health telemetry.
- `POST /api/v1/social/orders/draft`: Controlled social order creation delegating to Commerce Core `OrderService.createOrder`.
- `GET /api/v1/social/customers/:id/identities`: List linked customer social profiles and identities.
- `GET|POST /api/v1/social/webhooks/:channel`: Inbound webhook ingress with HMAC signature verification (`X-Hub-Signature-256`, Meta `hub.challenge`).
- `GET|POST /api/v1/social/widget/*`: First-party website live chat widget session, config, and messaging.

### Agent Runtime Gateway (`/api/v1/agents`)
- `POST /api/v1/agents/run`: Submit a task or conversation context to the Agent Orchestrator.
- `GET /api/v1/agents/runs/:id`: Fetch execution trace, tools used, and status.
- `POST /api/v1/agents/approvals/:id`: Operator approval or rejection of a pending high-risk tool call.

### Knowledge Base & RAG (`/api/v1/knowledge`)
- `GET /api/v1/knowledge/documents`: List uploaded merchant knowledge files.
- `POST /api/v1/knowledge/upload`: Upload policy PDF or markdown guide for ingestion and embedding.
- `POST /api/v1/knowledge/query`: Semantic test query with similarity scores and citations.

### Automations Hub & n8n Integration (`/api/v1/automation/*`, `/api/v1/automations/*`)
- `GET /api/v1/automations`: List tenant automations with category, status, trigger, and search filters.
- `POST /api/v1/automations`: Create new automation rule.
- `GET /api/v1/automations/:id`: Retrieve automation rule specification and recent executions.
- `PATCH /api/v1/automations/:id`: Update automation parameters, triggers, conditions, or actions.
- `DELETE /api/v1/automations/:id`: Soft-delete automation rule.
- `POST /api/v1/automations/:id/:action`: Dispatch automation actions (`execute`, `dry-run`, `toggle`, `duplicate`).
- `GET /api/v1/automation/workflows`: List multi-step workflow graphs and semantic versions.
- `POST /api/v1/automation/workflows`: Create multi-step workflow graph.
- `GET /api/v1/automation/templates`: List 39 standard pre-built workflow templates across 8 domains.
- `POST /api/v1/automation/templates/:id/install`: Install template into tenant environment with custom params.
- `GET /api/v1/automation/executions`: Paginated execution history with status, trigger, duration, and dry-run filters.
- `GET /api/v1/automation/failures`: Real-time operational failure feed with error codes.
- `GET /api/v1/automation/dead-letters`: Dead letter queue (DLQ) entries with root cause categorization.
- `POST /api/v1/automation/dead-letters/:id/:action`: DLQ operations (`replay`, `resolve`, `discard`).
- `GET /api/v1/automation/providers`: Provider registry status and circuit breaker states (`NORMAL`, `DEGRADED`, `OPEN`, `HALF_OPEN`).
- `GET /api/v1/automation/health`: Platform automation health, queue depth, DLQ count, and breaker summary.
- `POST /api/v1/automation/events`: Ingest domain event into automation router for rule evaluation.
- `POST /api/v1/automation/webhooks/:provider`: Public inbound webhook gateway with HMAC verification, replay defense, and status translation.

### Authoritative Automation Actions (`/api/v1/automation/actions/*`)
- `POST /api/v1/automation/actions/orders/:id/:action`: Atomic order transitions (`confirm`, `cancel`, `status`, `tag`) strictly enforcing state machine and idempotency.
- `POST /api/v1/automation/actions/inventory/adjust`: Authoritative inventory stock adjustment with movement audit logs.
- `POST /api/v1/automation/actions/shipments/:id/create`: Courier parcel booking dispatch.
- `POST /api/v1/automation/actions/notifications/send`: Multi-channel notification delivery (SMS, WhatsApp, Email, In-App).

---

## 3. Platform Control Plane API Contracts (`/api/v1/platform/*`)

Platform routes are segregated from merchant tenant routes. All platform endpoints require authenticated `PlatformSessionToken` with appropriate `platformRole` and granular permissions.

### 3.1 Platform Ingress Conventions
- **Authentication**: `Authorization: Bearer <platform_session_jwt>`.
- **Step-Up Verification**: `X-Step-Up-Token: <short_lived_totp_proof>` (Required on `HIGH` and `CRITICAL` risk operations).
- **Audit Justification**: `X-Audit-Reason: <mandatory_text_explanation>` (Required on all mutating platform requests).
- **Rate Limits**: Max 120 requests/minute per platform operator; burst 30.

### 3.2 Platform Endpoint Catalog

#### Platform Overview & Health
- `GET /api/v1/platform/overview`: High-level aggregated SaaS metrics (total tenants, active MRR, system health, active incidents).
- `GET /api/v1/platform/health`: Multi-cluster health status (Database pool, Redis cluster, n8n instances, provider circuit breakers).

#### Tenant Governance (`/api/v1/platform/tenants`)
- `GET /api/v1/platform/tenants`: Paginated list of tenants with status, plan, creation date, and search filter.
- `POST /api/v1/platform/tenants`: Provision new tenant workspace with owner assignment and initial plan.
- `GET /api/v1/platform/tenants/:id`: Detailed tenant diagnostics (metadata, subscription, usage aggregates, audit summary).
- `POST /api/v1/platform/tenants/:id/suspend`: Suspend tenant operations with mandatory justification.
- `POST /api/v1/platform/tenants/:id/activate`: Reactivate suspended tenant.
- `POST /api/v1/platform/tenants/:id/archive`: Soft-archive tenant workspace (read-only tombstone).

#### SaaS Plans, Subscriptions & Entitlements
- `GET /api/v1/platform/plans`: List public and private SaaS tiers.
- `POST /api/v1/platform/plans`: Create new plan or version.
- `GET /api/v1/platform/subscriptions`: List subscriptions with status, trial, and renewal filters.
- `PATCH /api/v1/platform/subscriptions/:id`: Modify subscription plan, grace period, or renewal flags.
- `GET /api/v1/platform/entitlements`: Catalog of feature entitlements and default quotas.
- `PUT /api/v1/platform/tenants/:id/entitlements/:key`: Apply custom entitlement override for a tenant.
- `GET /api/v1/platform/usage`: Aggregated and per-tenant usage records against quota ceilings.

#### Platform Automation & n8n Cluster Administration
- `GET /api/v1/platform/automations`: Cross-tenant automation metrics, failure rates, and throughput.
- `GET /api/v1/platform/n8n`: Status of connected n8n worker nodes, versions, queue depth, and health.
- `POST /api/v1/platform/n8n/restart`: Governed rolling restart of n8n worker instances.
- `GET /api/v1/platform/providers`: Global status of third-party integration gateways and circuit breaker states.
- `POST /api/v1/platform/providers/:id/reset-breaker`: Reset tripped circuit breaker after provider recovery.
- `GET /api/v1/platform/dlq`: Global view of unresolved dead letter executions across tenants.
- `POST /api/v1/platform/dlq/:id/retry`: Trigger platform-level retry of dead-letter event.

#### Support Impersonation (`/api/v1/platform/impersonate`)
- `POST /api/v1/platform/impersonate`: Initiate time-limited impersonation session (`READ_ONLY` by default; requires ticket ID, reason, and step-up auth).
- `GET /api/v1/platform/impersonate/active`: List currently active impersonation sessions.
- `POST /api/v1/platform/impersonate/:id/revoke`: Immediately terminate an active impersonation session.

#### Security, Kill-Switches & Incidents
- `GET /api/v1/platform/security/events`: Live feed of platform security events (failed logins, step-up failures, rate-limit blocks).
- `POST /api/v1/platform/security/kill-switch`: Activate emergency kill-switch (`GLOBAL`, `TENANT`, `WORKFLOW`, `PROVIDER`).
- `DELETE /api/v1/platform/security/kill-switch/:id`: Deactivate kill-switch after remediation.
- `GET /api/v1/platform/incidents`: Active and historical platform incidents.
- `POST /api/v1/platform/incidents`: Create incident declaration and broadcast status.
- `PATCH /api/v1/platform/incidents/:id`: Update incident status (`INVESTIGATING`, `MITIGATED`, `RESOLVED`).
- `GET /api/v1/platform/maintenance`: Scheduled platform maintenance windows.
- `POST /api/v1/platform/maintenance`: Schedule new maintenance window with user notifications.

#### Platform Audit & Governance
- `GET /api/v1/platform/audit`: Paginated immutable platform audit log with actor, action, tenant, and date filters.
- `POST /api/v1/platform/audit/export`: Generate signed, tamper-evident audit report export.
- `GET /api/v1/platform/settings`: Platform-wide configuration settings (AI routing, storage quotas).
- `PATCH /api/v1/platform/settings/:key`: Update platform setting (generates versioned history record).
- `GET /api/v1/platform/feature-flags`: List global feature flags, percentage rollouts, and tenant allowlists.
- `POST /api/v1/platform/feature-flags`: Create or update feature flag rules.


