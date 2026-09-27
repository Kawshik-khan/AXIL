# CommerceOS System Design & Distributed Topology

> **Status:** TARGET. No Redis locks/queues, Postgres row locks, workers, backups, or failover exist yet; persistence is a single JSON file.

## 1. System Topology & Infrastructure Layout

CommerceOS is structured as a resilient, multi-tenant distributed system designed to scale smoothly from single-instance setups to high-availability multi-node deployments.

```
[ Customer Traffic ]      [ Webhook Traffic ]        [ Operator Web ]
  (FB, IG, WA, Web)        (bKash, Steadfast)         (Bento Dashboard)
         │                         │                          │
         ▼                         ▼                          ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │               Cloudflare / Reverse Proxy & TLS                  │
 └────────────────────────────────┬────────────────────────────────┘
                                  │
                                  ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                 CommerceOS Core Server (Next.js / Node)         │
 │  ┌─────────────────────────┐     ┌───────────────────────────┐  │
 │  │      Frontend UI        │     │       REST API v1         │  │
 │  │   (Bento + Dock Shell)  │     │   (Modular Domain Engine) │  │
 │  └─────────────────────────┘     └─────────────┬─────────────┘  │
 │                                                │                │
 │  ┌─────────────────────────┐     ┌─────────────▼─────────────┐  │
 │  │    Agent Orchestrator   │◄───►│       Policy Engine       │  │
 │  └───────────┬─────────────┘     └───────────────────────────┘  │
 └──────────────┼─────────────────────────────────┼────────────────┘
                │                                 │
                ▼                                 ▼
   ┌───────────────────────────┐   ┌───────────────────────────────┐
   │     Redis 7 Cluster       │   │    PostgreSQL 16 + pgvector   │
   │  - Event Pub/Sub & Queues │   │  - Authoritative Relational DB│
   │  - Distributed Locks      │   │  - Tenant-Partitioned Tables  │
   │  - Rate-Limiting Counters │   │  - Vector Knowledge Chunks    │
   └────────────┬──────────────┘   └───────────────────────────────┘
                │
                ▼
   ┌───────────────────────────┐   ┌───────────────────────────────┐
   │    n8n Workflow Hub       │   │     External Integrations     │
   │  - Background Workers     │◄──┤  - bKash, Nagad, SSLCommerz   │
   │  - Scheduled Cron Syncs   │   │  - Steadfast, Pathao, RedX    │
   │  - Long-running Retries   │   │  - Meta Graph & WA Cloud API  │
   └───────────────────────────┘   └───────────────────────────────┘
```

---

## 2. Distributed State Management & Concurrency Control

### 2.1 Concurrency & Inventory Race Conditions
During high-traffic flash sales or festival seasons (e.g., Eid collections), multiple customers on WhatsApp, Facebook, and Web may attempt to purchase the same inventory item simultaneously.
- **Mechanism**: Redis distributed locks (`redlock` pattern) combined with PostgreSQL row-level locking:
  ```sql
  SELECT stock, reserved_stock 
  FROM inventory 
  WHERE tenant_id = :tenant_id AND product_variant_id = :variant_id 
  FOR UPDATE;
  ```
- An order reservation holds an atomic lock for 15 minutes. If checkout is abandoned, the reservation automatically lapses and releases back to available stock.

### 2.2 Idempotency & Webhook Deduplication
Every incoming external webhook (Meta, bKash, Steadfast) must pass an idempotency filter:
1. Extract or generate an `idempotency_key` (e.g. `bkash:trx:ABC1234567` or `steadfast:consignment:ST78910`).
2. Verify in Redis with `SETNX idempotency:<key> 1 EX 86400`.
3. If the key already exists, return HTTP 200 immediately with the previously cached acknowledgement without reprocessing.

---

## 3. Asynchronous Processing & Queue Topology

Long-running and high-latency operations must never block customer interactions or synchronous HTTP requests.

| Queue Name | Worker | Concurrency | Retry Strategy | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `events.domain` | Core Event Consumer | High (20) | 3 retries, exponential backoff | Distribute domain events across listeners |
| `webhooks.outbound` | Webhook Dispatcher | Moderate (10) | 5 retries, 1m/5m/15m/1h backoff | Push notifications to n8n or partner endpoints |
| `rag.ingestion` | Document Worker | Low (2) | 2 retries | PDF parsing, chunking, OpenAI/local embeddings |
| `shipments.sync` | Courier Poller | Moderate (5) | Linear backoff | Periodic sync of active in-transit tracking statuses |
| `campaigns.dispatch`| Marketing Worker | Rate-limited | Strictly capped to provider limits | WhatsApp / Messenger batch message dispatch |

---

## 4. Disaster Recovery, Backups & Reliability

- **Database Backups**: Continuous WAL archiving + daily automated physical snapshots with point-in-time recovery (PITR) up to 30 days.
- **Failover**: Multi-AZ primary-replica configuration with automated health detection and replica promotion.
- **Degraded Operation Mode**: If the LLM provider experiences an outage, the system gracefully shifts to deterministic keyword matching and human escalation without affecting core order placement, payments, or courier booking.

---

## 5. Dual-Plane Topology: Platform Control Plane vs Tenant Data Plane

To ensure tenant isolation, high availability, and operational resilience, CommerceOS implements a dual-plane architecture:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   COMMERCEOS DUAL-PLANE ARCHITECTURE                   │
│                                                                        │
│  [ PLATFORM CONTROL PLANE ]               [ TENANT COMMERCE PLANE ]    │
│  - Super Admin Bento UI                   - Merchant Bento Dashboard   │
│  - /api/v1/platform/*                     - /api/v1/* (Tenant-Scoped)  │
│  - PlatformAuthorizationService           - RbacService                │
│  - PlatformContext                        - RequestContext             │
│  - SaaS Plans & Entitlements              - Catalog, Orders, Inventory │
│  - Cross-Tenant Fleet Telemetry           - Store-level Analytics      │
│  - n8n Cluster Health & DLQ               - Store Automation Triggers  │
│  - Governed Support Impersonation         - Merchant Customer Support  │
│  - Emergency Global Kill Switch           - Store-level Settings       │
│                                                                        │
│                      AUTH & BOUNDARY FIREWALL                          │
│  - Platform Membership ≠ Tenant Role                                   │
│  - Impersonation downgrades to Target User Perms (READ_ONLY by default) │
│  - Zero raw SQL exposure to browser / UI                               │
│  - Dual-Attribution Immutable Platform Audit Trail                     │
└────────────────────────────────────────────────────────────────────────┘
```

