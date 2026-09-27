# CommerceOS Production n8n Workflow Automation Hub

Welcome to the **CommerceOS n8n Workflow Automation Hub**. This directory provides production-ready, exportable, and importable n8n workflow definitions connecting CommerceOS to partner services, notification networks, and scheduled jobs.

---

## 1. Prime Directive: n8n Orchestrates, CommerceOS Owns Truth

```
┌────────────────────────────────────────────────────────┐
│ CommerceOS Core (State, Transactions, ACID Invariants) │
│                       │                                │
│                       ▼                                │
│            Automation Router                           │
│                       │                                │
│                       ▼                                │
│                   n8n Hub                              │
│         (Orchestration, Retries, Adapters)             │
│                       │                                │
│                       ▼                                │
│     External Services (Couriers, MFS, Meta)            │
│                       │                                │
│                       ▼                                │
│      Webhook Gateway (HMAC Crypto Verification)        │
│                       │                                │
│                       ▼                                │
│            CommerceOS Domain API                       │
│    (State Machine Transitions, Verification, Audit)    │
└────────────────────────────────────────────────────────┘
```

### Strict Architectural Separation
- **n8n IS**:
  - An external visual workflow orchestrator.
  - A webhook ingestion and fan-out engine.
  - An event transformation and notification dispatcher.
- **n8n is NEVER**:
  - The authoritative database or persistence engine.
  - An authorization bypass.
  - A location for critical business logic or direct database mutations.
- **No Direct DB Connections**: n8n workflows MUST NEVER connect to PostgreSQL directly or run arbitrary SQL. All state changes are submitted through authenticated CommerceOS REST APIs.
- **Authoritative Idempotency**: All side-effecting actions require an `Idempotency-Key` header and are enforced by CommerceOS (`tenant_id + idempotency_key + operation`).
- **Context Preservation**: Every trigger and HTTP call strictly preserves `X-Tenant-ID`, `X-Correlation-ID`, `X-Causation-ID`, and `Idempotency-Key`.

---

## 2. Tested & Pinned n8n Version

- **Tested Version**: `n8n v1.76.0+`
- **Workflow Schema**: Version 1 (supports modern node declarations and expressions)
- **Supported Core Node Types**:
  - `n8n-nodes-base.webhook` (v2)
  - `n8n-nodes-base.code` (v2)
  - `n8n-nodes-base.httpRequest` (v4.2)
  - `n8n-nodes-base.if` (v2)
  - `n8n-nodes-base.respondToWebhook` (v1.1)
  - `n8n-nodes-base.scheduleTrigger` (v1.2)

---

## 3. Directory Structure

```
/n8n
├── README.md                                  # This architecture and operational guide
├── deployment/
│   ├── environment.example                    # Sample production environment variables
│   └── import.md                              # Step-by-step import and credential setup guide
└── workflows/
    ├── commerceos-order-created-notification.json # WF-ORD-01: Order Created Notification
    ├── commerceos-courier-status-sync.json        # WF-DEL-02: Courier Webhook & Status Sync
    ├── commerceos-payment-verification.json       # WF-PAY-01: Payment Gateway Webhook Ingestion
    ├── commerceos-inventory-low-stock-alert.json  # WF-INV-01: Low Stock Merchant Alert
    ├── commerceos-abandoned-checkout-recovery.json# WF-MKT-01: Abandoned Cart WhatsApp Recovery
    ├── commerceos-social-message-automation.json  # WF-SOC-01: Social Message Ingestion & AI Routing
    └── commerceos-facebook-comment-to-lead.json   # WF-SOC-02: Facebook Comment to Lead Nudge
```

---

## 4. Standard Node Flow

Each production workflow strictly adheres to the standard node flow:
```
[ Webhook / Cron Trigger ]
         │
         ▼
[ Step 1: Validate Event Envelope & Headers ]
         │
         ▼
[ Step 2: Prepare Tenant, Correlation & Idempotency Context ]
         │
         ▼
[ Step 3: Call CommerceOS API via HTTP Request (Bearer Credential) ]
         │
         ▼
[ Step 4: Verify Result (data.verified === true) ]
         │
    ┌────┴────┐
    ▼         ▼
[ Success ] [ Failure ]
```

---

## 5. Security & Zero-Leakage Policy

1. **Zero Hardcoded Secrets**: No API keys, passwords, bearer tokens, or webhook secrets exist in exported workflow JSON.
2. **Generic Credential Mapping**: All HTTP Request nodes reference the documented n8n credential named `"CommerceOS API"` (`httpHeaderAuth`).
3. **Fail-Closed Verification**: Tampered payloads, timestamp clock drift (> 300s), and invalid signatures are rejected immediately.
4. **Bounded Retries**: Transient failures (429, 5xx, timeouts) use exponential backoff with a maximum of 3 attempts. Infinite loops are strictly prevented.
