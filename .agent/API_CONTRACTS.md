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
- `GET /api/v1/platform/health`: Multi-cluster health status (Database pool, Redis cluster, provider circuit breakers).

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



### 3.3 As implemented: super-admin console routes (ADR-116, 2026-10-12)

The catalog above is the target design. The routes below exist. All use `extractPlatformContext`, strict Zod bodies and `withStore`. Privileged ones go through `PrivilegedActionGate` (`src/domains/platform/privileged-actions.ts` lists each action's permission, risk, step-up, reason/ticket and approval policy). Step-up travels in `x-step-up-token`. A gated call without a required approval returns 403 `APPROVAL_REQUIRED` with `details.payload`, the exact input to request approval for.

| Route | Purpose |
|---|---|
| `GET /platform/attention` | Control Tower inbox, computed on read |
| `GET /platform/impact?action=&scope=&target=` | Read-only impact preview for privileged actions |
| `GET/POST /platform/approvals`, `POST /platform/approvals/:id/decision`, `POST /platform/approvals/:id/cancel` | Two-person approval requests |
| `GET/POST /platform/tenants` | List (Zod query) / provision (`start_trial` optional) |
| `GET/DELETE /platform/tenants/:id` | Detail / archive (reason + ticket) |
| `POST /platform/tenants/:id/suspend`, `/activate` | Lifecycle (suspend: ticket; approval when the tenant is older than 30 days) |
| `POST/DELETE /platform/tenants/:id/purge` | Schedule (two-person, `CONFIRM_PURGE_<SLUG>`) / cancel a purge; 14-day tombstone, nothing deleted. Replaces `/platform/compliance/purge` |
| `GET/POST /platform/tenants/:id/entitlements` | Effective entitlements report / `SET_OVERRIDE` (optional expiry) / `CLEAR_OVERRIDE` |
| `POST /platform/tenants/:id/subscription` | `CHANGE_PLAN` / `START_TRIAL` / `EXTEND_TRIAL` |
| `GET/POST /platform/tenants/:id/addons` | Grants / `GRANT` (complimentary) / `REVOKE` |
| `GET /platform/entitlements` | Entitlement catalog with defaults (no `tenantId`, no POST any more) |
| `GET/POST /platform/plans`, `GET/PATCH /platform/plans/:id` | Plans with versions / create (empty draft) / edit details |
| `POST /platform/plans/:id/versions` | Save the draft version |
| `POST /platform/plans/versions/:versionId` | `PUBLISH` / `RETIRE` |
| `GET /platform/plans/impact`, `POST /platform/plans/migrate` | Migration preview / move tenants between versions |
| `GET/POST /platform/addons` | Add-on definitions (`CREATE` / `RETIRE`) |
| `GET /platform/subscriptions` | Subscriptions with MRR contribution (POST removed: use tenants/:id/subscription) |
| `GET/POST /platform/safety/kill-switch` | `ACTIVATE` / `DEACTIVATE` (GLOBAL is two-person with a typed phrase) |
| `GET/POST /platform/feature-flags` | Only keys in `feature-flag-registry.ts` |
| `GET/POST /platform/settings` | Registry settings with the value in force / update (registered, read-by-code keys only) |
| `GET/POST /platform/maintenance`, `GET/POST /platform/announcements` | Informational windows / announcement drafts, publish, unpublish |
| `GET /platform/analytics/funnel` | Activation funnel and weekly cohorts |
| `GET/POST /platform/users` | Operators / assign role (CRITICAL, two-person, never your own) |
| `PATCH /platform/ai/budget` | Now requires `reason` |
| `POST /platform/ai/hitl/takeover` | Now requires `ai.hitl.manage` (was `support.read`) |
| `GET /api/v1/announcements` (tenant scope) | Published announcements and nearby maintenance for the caller's workspace |
