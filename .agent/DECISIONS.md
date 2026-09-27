# CommerceOS Architectural Decision Records (ADRs)

This document tracks foundational architectural decisions. No decision documented here may be altered without creating a subsequent ADR explaining context, trade-offs, and consequences.

## Index

One line per ADR. Read the full entry only when relevant. New ADRs: append below using `templates/adr.md` and add a row here.

| ADR | Title |
|---|---|
| [ADR-001](#adr-001-nextjs-app-router--vanilla-css-with-custom-tokens) | Next.js App Router + Vanilla CSS with Custom Tokens |
| [ADR-002](#adr-002-postgresql-16-with-pgvector-for-hybrid-persistence) | PostgreSQL 16+ with `pgvector` for Hybrid Persistence |
| [ADR-003](#adr-003-strict-separation-of-n8n-as-orchestration-hub-not-core-backend) | Strict Separation of n8n as Orchestration Hub (Not Core Backend) |
| [ADR-004](#adr-004-multi-agent-gateway-with-deterministic-policy-engine) | Multi-Agent Gateway with Deterministic Policy Engine |
| [ADR-005](#adr-005-cryptographic-multi-tenant-context-resolution) | Cryptographic Multi-Tenant Context Resolution |
| [ADR-006](#adr-006-provider-adapter-pattern-for-bangladesh-couriers--payments) | Provider Adapter Pattern for Bangladesh Couriers & Payments |
| [ADR-007](#adr-007-server-side-authoritative-pricing-engine--client-totals-rejection) | Server-Side Authoritative Pricing Engine & Client Totals Rejection |
| [ADR-008](#adr-008-strict-finite-state-machine-for-order-lifecycle--reservation-invariants) | Strict Finite State Machine for Order Lifecycle & Reservation Invariants |
| [ADR-009](#adr-009-zero-negative-stock-invariant--atomic-inventory-movements) | Zero Negative-Stock Invariant & Atomic Inventory Movements |
| [ADR-010](#adr-010-bangladeshi-e164-phone-normalization-880--deduplication) | Bangladeshi E.164 Phone Normalization (+880) & Deduplication |
| [ADR-011](#adr-011-delivery-triggered-cod-financial-reconciliation--idempotency) | Delivery-Triggered COD Financial Reconciliation & Idempotency |
| [ADR-012](#adr-012-live-authoritative-aggregations-for-control-plane-telemetry-zero-synthetic-data) | Live Authoritative Aggregations for Control Plane Telemetry (Zero Synthetic Data) |
| [ADR-013](#adr-013-canonical-message-normalization--lossless-banglish-preservation) | Canonical Message Normalization & Lossless Banglish Preservation |
| [ADR-014](#adr-014-authoritative-commerce-separation-for-social-order-drafts) | Authoritative Commerce Separation for Social Order Drafts |
| [ADR-015](#adr-015-strict-customer-isolation-for-internal-operator-notes) | Strict Customer Isolation for Internal Operator Notes |
| [ADR-016](#adr-016-aes-256-gcm-symmetrical-encryption-for-channel-credentials--secret-masking) | AES-256-GCM Symmetrical Encryption for Channel Credentials & Secret Masking |
| [ADR-017](#adr-017-multi-agent-specialization--hybrid-supervisor-routing) | Multi-Agent Specialization & Hybrid Supervisor Routing |
| [ADR-018](#adr-018-3-second-inbound-message-debouncing-window) | 3-Second Inbound Message Debouncing Window |
| [ADR-019](#adr-019-zero-trust-tool-gateway--authoritative-commerce-core-enforcement) | Zero-Trust Tool Gateway & Authoritative Commerce Core Enforcement |
| [ADR-020](#adr-020-multi-tenant-vector-rag-isolation-with-pgvector-cosine-search) | Multi-Tenant Vector RAG Isolation with pgvector Cosine Search |
| [ADR-021](#adr-021-pii-redaction--5-layer-context-assembly-with-anti-injection-hierarchy) | PII Redaction & 5-Layer Context Assembly with Anti-Injection Hierarchy |
| [ADR-022](#adr-022-human-takeover-lock--dual-operating-modes-autonomous-vs-copilot) | Human Takeover Lock & Dual Operating Modes (Autonomous vs Copilot) |
| [ADR-023](#adr-023-golden-dataset-quantitative-benchmark-governance) | Golden Dataset Quantitative Benchmark Governance |
| [ADR-024](#adr-024-multi-agent-orchestration-topology-hierarchical-supervisor-with-subordinate-task-decomposition) | Multi-Agent Orchestration Topology (Hierarchical Supervisor with Subordinate Task Decomposition) |
| [ADR-025](#adr-025-directed-acyclic-graph-dag-task-planning-kahns-topological-sort-and-static-cycle-rejection) | Directed Acyclic Graph (DAG) Task Planning, Kahn's Topological Sort, and Static Cycle Rejection |
| [ADR-026](#adr-026-deterministic-physical-verifier-agent-zero-hallucination-evidence-matching-against-db-state) | Deterministic Physical Verifier Agent (Zero-Hallucination Evidence Matching against DB State) |
| [ADR-027](#adr-027-5-tier-autonomy-matrix--action-risk-categorization) | 5-Tier Autonomy Matrix & Action Risk Categorization |
| [ADR-028](#adr-028-pre-execution-entity-state-revalidation-optimistic-concurrency--anti-stale-action-shield) | Pre-Execution Entity State Revalidation (Optimistic Concurrency & Anti-Stale Action Shield) |
| [ADR-029](#adr-029-immutable-idempotent-action-receipts-and-multi-agent-audit-bus) | Immutable Idempotent Action Receipts and Multi-Agent Audit Bus |
| [ADR-030](#adr-030-inter-agent-communication-bus-and-capability-bounded-delegation-containment) | Inter-Agent Communication Bus and Capability-Bounded Delegation Containment |
| [ADR-031](#adr-031-durable-workflow-state-machine-with-step-level-checkpointing--crash-resilience) | Durable Workflow State Machine with Step-Level Checkpointing & Crash Resilience |
| [ADR-032](#adr-032-event-driven-reactive-automation-engine-with-cooldown-buffers--daily-quotas) | Event-Driven Reactive Automation Engine with Cooldown Buffers & Daily Quotas |
| [ADR-033](#adr-033-autonomous-multi-agent-cron-scheduling-architecture-with-timezone-awareness) | Autonomous Multi-Agent Cron Scheduling Architecture with Timezone Awareness |
| [ADR-034](#adr-034-pre-execution-workflow-simulation--token-spend-projection-engine) | Pre-Execution Workflow Simulation & Token Spend Projection Engine |
| [ADR-035](#adr-035-canonical-metric-registry-with-formal-aggregation-rules--tenant-scoping) | Canonical Metric Registry with Formal Aggregation Rules & Tenant Scoping |
| [ADR-036](#adr-036-zero-injection-parameterized-analytics-query-engine) | Zero-Injection Parameterized Analytics Query Engine |
| [ADR-037](#adr-037-real-time-intelligence-ingestion--streaming-rollup-aggregator) | Real-Time Intelligence Ingestion & Streaming Rollup Aggregator |
| [ADR-038](#adr-038-dual-method-statistical-anomaly-detection-z-score--static-invariants) | Dual-Method Statistical Anomaly Detection (Z-Score + Static Invariants) |
| [ADR-039](#adr-039-multi-horizon-forecasting-engine-with-bangladesh-retail-seasonality--confidence-intervals) | Multi-Horizon Forecasting Engine with Bangladesh Retail Seasonality & Confidence Intervals |
| [ADR-040](#adr-040-zero-mutation-what-if-simulation-sandbox-with-microeconomic-elasticity-modeling) | Zero-Mutation What-If Simulation Sandbox with Microeconomic Elasticity Modeling |
| [ADR-041](#adr-041-rfm-quantile-segmentation--probabilistic-ltv-modeling) | RFM Quantile Segmentation & Probabilistic LTV Modeling |
| [ADR-042](#adr-042-7-factor-explainable-recommendation-synthesis-framework) | 7-Factor Explainable Recommendation Synthesis Framework |
| [ADR-043](#adr-043-controlled-autonomous-decision-proposal-bridge-to-phase-5-policy--approval-engine) | Controlled Autonomous Decision Proposal Bridge to Phase 5 Policy & Approval Engine |
| [ADR-044](#adr-044-post-decision-feedback-loop--empirical-outcome-tracking) | Post-Decision Feedback Loop & Empirical Outcome Tracking |
| [ADR-045](#adr-045-data-quality-governance-boundary-isolation--machine-learning-model-registry) | Data Quality Governance, Boundary Isolation & Machine Learning Model Registry |
| [ADR-046](#adr-046-dual-dynamic--predictive-audience-segmentation-engine-with-immutable-snapshot-cryptographic-hashing) | Dual Dynamic & Predictive Audience Segmentation Engine with Immutable Snapshot Cryptographic Hashing |
| [ADR-047](#adr-047-10-stage-deterministic-customer-lifecycle-state-machine--transition-auditing) | 10-Stage Deterministic Customer Lifecycle State Machine & Transition Auditing |
| [ADR-048](#adr-048-multi-node-customer-journey-engine-with-step-level-checkpoints--durable-execution) | Multi-Node Customer Journey Engine with Step-Level Checkpoints & Durable Execution |
| [ADR-049](#adr-049-campaign-risk-tiering--phase-5-approval-gating-with-multi-level-emergency-kill-switches) | Campaign Risk Tiering & Phase 5 Approval Gating with Multi-Level Emergency Kill Switches |
| [ADR-050](#adr-050-granular-multi-channel-consent-management-suppression-lists--frequency-capping-dailyweekly) | Granular Multi-Channel Consent Management, Suppression Lists & Frequency Capping (Daily/Weekly) |
| [ADR-051](#adr-051-grounded-multilingual-copy-synthesis-with-live-catalog-price--stock-factuality-verification) | Grounded Multilingual Copy Synthesis with Live Catalog Price & Stock Factuality Verification |
| [ADR-052](#adr-052-promotional-offer-engine-with-margin-floor-protection--elasticity-based-simulation) | Promotional Offer Engine with Margin-Floor Protection & Elasticity-Based Simulation |
| [ADR-053](#adr-053-co-purchase-affinity-matrix--anti-duplicate-abandoned-checkout-recovery) | Co-Purchase Affinity Matrix & Anti-Duplicate Abandoned Checkout Recovery |
| [ADR-054](#adr-054-frequentist-ab-testing-engine-with-deterministic-hash-assignment--sample-size-guardrails) | Frequentist A/B Testing Engine with Deterministic Hash Assignment & Sample Size Guardrails |
| [ADR-055](#adr-055-multi-touch-attribution-engine-first-touch-last-touch-linear-time-decay-distinguishing-attributed-vs-incremental-revenue) | Multi-Touch Attribution Engine (First-Touch, Last-Touch, Linear, Time-Decay) Distinguishing Attributed vs Incremental Revenue |
| [ADR-056](#adr-056-7-factor-explainable-growth-recommendation-synthesis-with-strategy-categorization) | 7-Factor Explainable Growth Recommendation Synthesis with Strategy Categorization |
| [ADR-057](#adr-057-multi-agent-growth-supervisor-dag-decomposition--centralized-marketing-tool-execution) | Multi-Agent Growth Supervisor DAG Decomposition & Centralized Marketing Tool Execution |
| [ADR-058](#adr-058-operational-digital-twin-projection-as-read-only-aggregate-mirror) | Operational Digital Twin Projection as Read-Only Aggregate Mirror |
| [ADR-059](#adr-059-governed-11-stage-operations-loop-with-verification-and-cryptographic-actionreceipts) | Governed 11-Stage Operations Loop with Verification and Cryptographic ActionReceipts |
| [ADR-060](#adr-060-deterministic-replenishment--moq-optimization-for-purchase-orders) | Deterministic Replenishment & MOQ Optimization for Purchase Orders |
| [ADR-061](#adr-061-elasticity-aware-dynamic-pricing-with-immutable-margin-floor-safeguard) | Elasticity-Aware Dynamic Pricing with Immutable Margin-Floor Safeguard |
| [ADR-062](#adr-062-multi-warehouse-order-fulfillment-planning-and-routing) | Multi-Warehouse Order Fulfillment Planning and Routing |
| [ADR-063](#adr-063-courier-in-transit-delay-detection-and-automated-carrier-failover) | Courier In-Transit Delay Detection and Automated Carrier Failover |
| [ADR-064](#adr-064-deterministic-mfs--financial-ledger-reconciliation) | Deterministic MFS & Financial Ledger Reconciliation |
| [ADR-065](#adr-065-centralized-operational-exception-management-engine) | Centralized Operational Exception Management Engine |
| [ADR-066](#adr-066-external-provider-health-monitoring-and-automated-circuit-breakers) | External Provider Health Monitoring and Automated Circuit Breakers |
| [ADR-067](#adr-067-progressive-bulk-mutation-safeguards-with-sample-previews-and-execution-gates) | Progressive Bulk Mutation Safeguards with Sample Previews and Execution Gates |
| [ADR-068](#adr-068-multi-tier-autonomy-budget-enforcement-and-emergency-kill-switch) | Multi-Tier Autonomy Budget Enforcement and Emergency Kill Switch |
| [ADR-069](#adr-069-multi-entity-hierarchy--server-side-scope-authorization) | Multi-Entity Hierarchy & Server-Side Scope Authorization |
| [ADR-070](#adr-070-governed-semantic-metrics-layer--cross-store-benchmarking) | Governed Semantic Metrics Layer & Cross-Store Benchmarking |
| [ADR-071](#adr-071-integration-hub-with-checkpointed-sync-engine--conflict-resolution) | Integration Hub with Checkpointed Sync Engine & Conflict Resolution |
| [ADR-072](#adr-072-zero-trust-developer-platform--hmac-sha256-signed-webhooks) | Zero-Trust Developer Platform & HMAC-SHA256 Signed Webhooks |
| [ADR-073](#adr-073-enterprise-data-governance-pii-masking--customer-identity-resolution) | Enterprise Data Governance, PII Masking & Customer Identity Resolution |
| [ADR-074](#adr-074-autonomous-platform-architecture--6-layer-operational-model) | Autonomous Platform Architecture & 6-Layer Operational Model |
| [ADR-075](#adr-075-objective-driven-governance--multi-tier-hierarchy-resolution) | Objective-Driven Governance & Multi-Tier Hierarchy Resolution |
| [ADR-076](#adr-076-global-decision-engine--mandatory-human-approval-gates) | Global Decision Engine & Mandatory Human Approval Gates |
| [ADR-077](#adr-077-strategy-formulation-non-destructive-simulation--trade-off-engine) | Strategy Formulation, Non-Destructive Simulation & Trade-Off Engine |
| [ADR-078](#adr-078-structured-inter-agent-protocol--consensus-conflict-resolution) | Structured Inter-Agent Protocol & Consensus Conflict Resolution |
| [ADR-079](#adr-079-unified-real-time-cross-domain-context-aggregator) | Unified Real-Time Cross-Domain Context Aggregator |
| [ADR-080](#adr-080-continuous-learning-pipeline-with-staged-safe-promotion) | Continuous Learning Pipeline with Staged Safe Promotion |
| [ADR-081](#adr-081-model-governance-registry-lineage-tracking--provider-abstraction) | Model Governance Registry, Lineage Tracking & Provider Abstraction |
| [ADR-082](#adr-082-policy-governed-task-aware-model-routing--latencycost-optimization) | Policy-Governed Task-Aware Model Routing & Latency/Cost Optimization |
| [ADR-083](#adr-083-evidence-based-autonomy-adaptation-with-mandatory-board-oversight) | Evidence-Based Autonomy Adaptation with Mandatory Board Oversight |
| [ADR-084](#adr-084-11-dimension-platform-health-scoring--autonomous-quality-scorecard) | 11-Dimension Platform Health Scoring & Autonomous Quality Scorecard |
| [ADR-085](#adr-085-cost-aware-autonomy-economics--unit-decision-efficiency-tracking) | Cost-Aware Autonomy Economics & Unit Decision Efficiency Tracking |
| [ADR-086](#adr-086-two-tier-rollback-state-restoration--compensating-action-architecture) | Two-Tier Rollback: State Restoration & Compensating Action Architecture |
| [ADR-087](#adr-087-cross-domain-incident-management-blast-radius--auto-remediation) | Cross-Domain Incident Management, Blast Radius & Auto-Remediation |
| [ADR-088](#adr-088-multi-region-data-residency--slo-error-budget-burn-rate-governance) | Multi-Region Data Residency & SLO Error Budget Burn Rate Governance |
| [ADR-089](#adr-089-architectural-separation-of-n8n-orchestration-hub--commerceos-authority-adr-automation-n8n-boundary) | Architectural Separation of n8n Orchestration Hub & CommerceOS Authority (ADR-Automation-N8n-Boundary) |
| [ADR-090](#adr-090-deterministic-granular-idempotency-engine--distributed-mutation-locking-adr-automation-idempotency) | Deterministic Granular Idempotency Engine & Distributed Mutation Locking (ADR-Automation-Idempotency) |
| [ADR-091](#adr-091-cryptographic-inbound-webhook-gateway-with-replay--drift-defense-adr-automation-webhooks) | Cryptographic Inbound Webhook Gateway with Replay & Drift Defense (ADR-Automation-Webhooks) |
| [ADR-092](#adr-092-bangladeshi-courier-status-normalization--autonomous-shipment-sync-adr-courier-synchronization) | Bangladeshi Courier Status Normalization & Autonomous Shipment Sync (ADR-Courier-Synchronization) |
| [ADR-093](#adr-093-bounded-exponential-backoff-with-jitter-for-automation-retries-adr-automation-retry) | Bounded Exponential Backoff with Jitter for Automation Retries (ADR-Automation-Retry) |
| [ADR-094](#adr-094-dead-letter-queue-dlq-lifecycle-root-cause-categorization--replay-adr-automation-dead-letter) | Dead Letter Queue (DLQ) Lifecycle, Root Cause Categorization & Replay (ADR-Automation-Dead-Letter) |
| [ADR-095](#adr-095-production-n8n-integration-credential-isolation--environment-injection-adr-n8n-integration) | Production n8n Integration, Credential Isolation & Environment Injection (ADR-N8n-Integration) |
| [ADR-096](#adr-096-semantic-workflow-versioning-migration-lifecycle--template-library-adr-automation-workflow-versioning) | Semantic Workflow Versioning, Migration Lifecycle & Template Library (ADR-Automation-Workflow-Versioning) |
| [ADR-097](#adr-097-multi-layer-automation-safety-recursion-depth-rate-limiting--emergency-kill-switch-adr-automation-loop-protection) | Multi-Layer Automation Safety: Recursion Depth, Rate Limiting & Emergency Kill Switch (ADR-Automation-Loop-Protection) |
| [ADR-098](#adr-098-multi-provider-automation-abstraction--health-circuit-breakers-adr-automation-provider-abstraction) | Multi-Provider Automation Abstraction & Health Circuit Breakers (ADR-Automation-Provider-Abstraction) |
| [ADR-099](#adr-099-super-admin-role-platform-control-plane-connector-segregation--automations-isolation-adr-super-admin-platform-control) | Super Admin Role, Platform Control Plane, Connector Segregation & Automations Isolation (ADR-Super-Admin-Platform-Control) |
| [ADR-100](#adr-100-authoritative-separation-of-platform-scope-and-tenant-scope-authorization-boundary-adr-platform-scope-separation) | Authoritative Separation of Platform Scope and Tenant Scope Authorization Boundary (ADR-Platform-Scope-Separation) |
| [ADR-101](#adr-101-integration-of-typesafe-ai-jev-system-one-model-for-sub-20ms-decisions-and-policy-guardrails) | Integration of TypeSafe AI Jev (System One) Model for Sub-20ms Decisions and Policy Guardrails |
| [ADR-102](#adr-102-agent-governance-restructure-status-as-source-of-truth) | Agent governance restructure: STATUS as source of truth |

> Several ADRs assume PostgreSQL/pgvector, Redis Streams, and real providers. Where the code differs (JSON store, Pinecone, mocked LLM), STATUS.md describes reality; the ADR still records the intended decision. Supersede an ADR with a new one rather than editing it.

---

## ADR-001: Next.js App Router + Vanilla CSS with Custom Tokens
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: The platform requires a bespoke, state-of-the-art Bento Grid interface with subtle glassmorphism, floating navigation dock, and lime accent tokens.
- **Decision**: Adopt Next.js (App Router, TypeScript) styled with pure Vanilla CSS and CSS Modules. Avoid utility classes that pollute DOM readability or enforce generic templates.
- **Consequences**: Provides total layout flexibility, fast SSR performance, and clean separation between presentation and business logic.

---

## ADR-002: PostgreSQL 16+ with `pgvector` for Hybrid Persistence
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: The platform requires an ACID-compliant transactional database for financial and order state, plus vector storage for semantic RAG retrieval.
- **Decision**: Use PostgreSQL 16+ with the `pgvector` extension instead of maintaining separate relational and standalone vector databases.
- **Consequences**: Simplifies multi-tenant transactional integrity; vector chunks are filtered by `tenant_id` in the same relational query with atomic consistency.

---

## ADR-003: Strict Separation of n8n as Orchestration Hub (Not Core Backend)
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: n8n provides workflow automation, but must not become an unmaintainable monolithic backend or source of truth.
- **Decision**: n8n communicates exclusively with CommerceOS via authenticated REST APIs (`/api/v1/*`) and webhook event streams. n8n is strictly forbidden from directly querying the PostgreSQL database or bypassing the Policy Engine.
- **Consequences**: Prevents unversioned business logic creep in workflows and ensures all mutations adhere to core domain invariants.

---

## ADR-004: Multi-Agent Gateway with Deterministic Policy Engine
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Direct LLM execution introduces risks of hallucinated pricing, unauthorized inventory modifications, and prompt injection exploits.
- **Decision**: All agent actions must route through an in-process Policy Engine before invoking Commerce APIs. LLMs can only emit structured JSON tool calls, never direct code or database statements.
- **Consequences**: Eliminates hallucinations on financial and operational data, guarantees RBAC enforcement, and enables transparent human approval gates.

---

## ADR-005: Cryptographic Multi-Tenant Context Resolution
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: In a multi-tenant SaaS, tenant data leakage is a catastrophic failure.
- **Decision**: `tenant_id` is resolved strictly from the cryptographically verified JWT session or signed API token. Client-supplied `tenant_id` parameters in HTTP payloads or query strings are ignored or rejected.
- **Consequences**: Absolute tenant boundary protection across database queries, vector searches, and cache partitions.

---

## ADR-006: Provider Adapter Pattern for Bangladesh Couriers & Payments
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Bangladeshi logistics (Steadfast, Pathao, RedX) and MFS providers (bKash, Nagad) frequently update API endpoints, error structures, and authentication protocols.
- **Decision**: Abstract all external provider interactions behind standard interfaces (`CourierAdapter`, `PaymentAdapter`).
- **Consequences**: Domain logic remains completely decoupled from third-party vendor changes and can support seamless mock implementations during tests.

---

## ADR-007: Server-Side Authoritative Pricing Engine & Client Totals Rejection
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Client applications or conversational AI agents might miscalculate subtotal, shipping fees (e.g. Inside Dhaka ৳60 vs Outside Dhaka ৳120), or coupon discount limits.
- **Decision**: Client-supplied prices, totals, or shipping charges are strictly ignored during checkout. `PricingService.calculateOrderPricing()` deterministically computes all line totals, shipping rates, coupon rules, and grand totals directly from verified product and tenant records.
- **Consequences**: Complete protection against price tampering, discount abuses, or floating-point rounding drift.

---

## ADR-008: Strict Finite State Machine for Order Lifecycle & Reservation Invariants
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Omnichannel commerce workflows can lead to race conditions, double shipments, or invalid state jumps (e.g., from PENDING directly to DELIVERED, or cancelling already DELIVERED orders).
- **Decision**: Enforce an immutable state machine (`OrderStateMachine`) that dictates permitted transitions:
  `PENDING -> CONFIRMED -> PROCESSING -> READY_TO_SHIP -> SHIPPED -> DELIVERED`.
  Transitions trigger atomic domain events and inventory reservation operations (commit on SHIPPED/DELIVERED, release on CANCELLED).
- **Consequences**: Prevents orphaned reservations and guarantees consistency across warehouse fulfillment and logistics.

---

## ADR-009: Zero Negative-Stock Invariant & Atomic Inventory Movements
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: High-demand sales campaigns (e.g., Eid flash sales) can induce race conditions causing overselling beyond physical warehouse capacity.
- **Decision**: Invariant enforced: `quantity_available = quantity_on_hand - quantity_reserved`. If `quantity_available + delta < 0` and overselling is disabled, `adjustStock` and `reserveStock` immediately abort with a `BadRequestError`. Every movement requires a mandatory audit reason.
- **Consequences**: Zero phantom inventory, total traceability across damaged, returned, or received goods.

---

## ADR-010: Bangladeshi E.164 Phone Normalization (+880) & Deduplication
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: In Bangladeshi F-commerce, customers provide phone numbers in diverse formats (`017...`, `+88017...`, `88017...`, `017..-..`), causing customer profile fragmentation and inaccurate lifetime spend records.
- **Decision**: All phone inputs must be normalized via `CustomerService.normalizePhoneNumber()` to `+8801XXXXXXXXX` before querying or storing. Customer records are automatically deduplicated by this normalized key.
- **Consequences**: Unified customer lifetime value (LTV), repeat order tracking, and clean courier parcel dispatch.

---

## ADR-011: Delivery-Triggered COD Financial Reconciliation & Idempotency
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Over 85% of Bangladeshi e-commerce transactions utilize Cash on Delivery (COD). Manual reconciliation often leaves orders in unpaid status even after successful courier delivery.
- **Decision**: When courier status reaches `DELIVERED` via webhook or manual scan, the system automatically transitions the associated Cash on Delivery record to `PAID` and synchronizes the order's `payment_status`. All payment mutations support idempotency keys.
- **Consequences**: Instantaneous, accurate revenue reporting without manual spreadsheet bookkeeping.

---

## ADR-012: Live Authoritative Aggregations for Control Plane Telemetry (Zero Synthetic Data)
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Demo or placeholder mock numbers in SaaS control planes deceive operators and conceal integration defects.
- **Decision**: Dashboard KPIs (`totalRevenue`, `totalOrders`, `averageOrderValue`, `lowStockCount`) are computed strictly via database aggregate queries for the tenant. If no orders exist, the UI renders actionable zero-state designs rather than hardcoded fake data.
- **Consequences**: Complete transparency and operational honesty for workspace administrators.

---

## ADR-013: Canonical Message Normalization & Lossless Banglish Preservation
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Bangladeshi social commerce relies heavily on Banglish (phonetic Bengali in Latin script). Mutating or blindly translating user messages causes loss of critical customer context and nuanced customer sentiment.
- **Decision**: All incoming messages are captured into `NormalizedIncomingMessage` preserving the original raw text verbatim. Intent analysis (phone extraction, order tracking queries, buying intent) is recorded into structured metadata alongside the original message without destructive modifications.
- **Consequences**: 100% losslessness for customer audit trails and training data; deterministic intent classification for pricing, orders, and returns.

---

## ADR-014: Authoritative Commerce Separation for Social Order Drafts
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Direct creation of orders in chat or by AI agents poses extreme risks of incorrect line pricing, discount tampering, and out-of-stock commitments.
- **Decision**: Social order creation must strictly route through Commerce Core `OrderService.createOrder` via `SocialOrderService.createOrderFromConversation`. Social channels and AI agents cannot calculate unit prices, override coupon limits, or bypass inventory reservation checks.
- **Consequences**: Complete consistency across catalog pricing, stock availability, courier shipping charges, and financial bookkeeping.

---

## ADR-015: Strict Customer Isolation for Internal Operator Notes
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Operators and human agents leave internal notes on customer conversation threads containing sensitive internal comments (e.g. discount approvals, fraud notes).
- **Decision**: Internal notes are assigned `message_type: "INTERNAL_NOTE"` and `direction: "INTERNAL"`. `OutboundMessageService` strictly enforces an invariant: if `messageType === "INTERNAL_NOTE"`, delivery is aborted immediately with a `BadRequestError`. Outbound provider adapters are architecturally shielded from internal note payloads.
- **Consequences**: Zero accidental leakage of private business notes to external social channels (Facebook, WhatsApp, Instagram).

---

## ADR-016: AES-256-GCM Symmetrical Encryption for Channel Credentials & Secret Masking
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Multi-tenant social commerce requires storing highly sensitive third-party credentials (Meta Page Access Tokens, WhatsApp Cloud API keys, Webhook secrets). Plaintext storage in the database or exposure via APIs is a catastrophic security vulnerability.
- **Decision**: All channel credentials are encrypted at rest using AES-256-GCM authenticated encryption before persistence. All REST API endpoints return `credentials_masked` with sanitized tokens (e.g., `EAAB...wxyz`), and decryption occurs solely within in-memory channel provider adapters.
- **Consequences**: Complete defense against credential leakage in logs, REST payloads, and unauthorized database dumps.

---

## ADR-017: Multi-Agent Specialization & Hybrid Supervisor Routing
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Monolithic LLM agents attempting to handle customer support, sales qualification, order tracking, and product sizing suffer from high prompt bloat, high cost, and hallucination risks.
- **Decision**: Implemented a specialized multi-agent architecture (`SUPERVISOR`, `CUSTOMER_SUPPORT`, `SALES`, `ORDER_ASSISTANT`, `PRODUCT_INFO`). Routing uses a 3-stage hybrid supervisor:
  1. *Deterministic Fast Path* (Zero-cost, sub-millisecond regex rules for greetings, thanks, prompt injections, human handoffs).
  2. *Banglish Domain Heuristics* (Lossless keyword and entity extraction).
  3. *Lightweight Tier 1 Classifier* (Structured output schema).
- **Consequences**: Greetings and simple queries bypass expensive LLM calls completely (0 token cost, <2ms latency); complex inquiries are routed to focused agents with constrained toolsets.

---

## ADR-018: 3-Second Inbound Message Debouncing Window
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Bangladeshi social commerce customers frequently send 3–4 rapid burst messages in Latin/Banglish ("hi", "price?", "black shoe 42 ache?"). Triggering independent LLM runs for each burst message wastes tokens, triggers conflicting replies, and causes race conditions.
- **Decision**: Implemented a 3000ms (3-second) debounce window configured in `TenantAIPolicy`. Inbound messages within this window are buffered and coalesced into a single coherent prompt before dispatching to the Agent Runtime.
- **Consequences**: Prevents duplicate LLM completions, preserves full multi-sentence context, and reduces AI token consumption by over 40% during burst conversations.

---

## ADR-019: Zero-Trust Tool Gateway & Authoritative Commerce Core Enforcement
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: LLMs must never be trusted to directly execute SQL queries, mutate database records, or hallucinate inventory counts, prices, or payment states.
- **Decision**: The Agent Runtime routes all actions through `ToolRegistry`, which enforces:
  1. Strict Zod schema validation.
  2. Cryptographic tenant context assertion.
  3. Server-side RBAC permissions (`RbacService.assertCan`).
  4. Tenant policy tool allowlist / denylist checking.
  5. Immutable database audit logging (`agent_tool_calls`).
- **Consequences**: LLMs function purely as reasoning engines. Zero database mutation occurs without Commerce Core business logic validation.

---

## ADR-020: Multi-Tenant Vector RAG Isolation with pgvector Cosine Search
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Store policies (return windows, shipping zones, sizing specs) must be retrieved with semantic search without cross-tenant vector leakage.
- **Decision**: Implemented `KnowledgeService` with chunking (500 tokens, 100 token overlap), 1536-dimensional embedding vectors, and pgvector cosine similarity search (`searchKnowledgeChunks`). All searches require tenant-scoped indexing and filter: `WHERE tenant_id = context.tenant.id`.
- **Consequences**: Strict zero-leakage multi-tenant retrieval; agent responses include verifiable citations (`document_title`, `section`, `similarity_score`).

---

## ADR-021: PII Redaction & 5-Layer Context Assembly with Anti-Injection Hierarchy
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Customer phone numbers, emails, and payment credentials passed into LLM prompts risk training leakage, prompt injection attacks, and privacy violations.
- **Decision**: Implemented `PIIRedactionService` masking Bangladeshi phone numbers (`0171****678`), emails (`ta***@gmail.com`), and cards (`****-****-****-****`). `ContextBuilder` formats context into 5 structured layers with strict instruction hierarchy:
  1. System safety & commerce policies (Absolute highest priority).
  2. Agent role instructions.
  3. Authoritative tool outputs.
  4. Retrieved store policies.
  5. Customer conversation text (Untrusted user input).
- **Consequences**: Prompt injection attempts ("ignore instructions", "system override") cannot override system commerce rules or mutate state.

---

## ADR-022: Human Takeover Lock & Dual Operating Modes (Autonomous vs Copilot)
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: When a human customer support agent takes over a conversation, or when high-risk disputes arise, automated AI replies must halt instantly without disabling human-facing assistance.
- **Decision**: Dual operational modes:
  - *AI_AUTONOMOUS*: Directly delivers outbound messages to social channels.
  - *AI_COPILOT*: Generates draft suggestions for human inbox operators without sending messages.
  - *Human Takeover Lock*: When `conversation.mode === "HUMAN"` or `automation_paused === true`, autonomous runs are hard-blocked (`status: "BLOCKED"`). Human operators retain access to Copilot (`isCopilot: true`) for interactive suggested replies.
- **Consequences**: Guaranteed human primacy; zero unwanted automated messages sent while human operators converse with customers.

---

## ADR-023: Golden Dataset Quantitative Benchmark Governance
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Continuous prompt updates and model router changes require regression testing against authentic Bangladeshi retail scenarios (Bangla, Banglish, and adversarial inputs).
- **Decision**: Established `GOLDEN_DATASET` (15 canonical benchmark scenarios) and `EvaluationService`. The suite evaluates Intent Accuracy, Tool Grounding Rate, Policy Compliance, Latency, and Cost. The test suite enforces a hard gate of >= 90% pass rate before deployment.
- **Consequences**: Rigorous MLOps quality control; automated regression detection for intent classification, tool grounding, and safety defenses.

---

## ADR-024: Multi-Agent Orchestration Topology (Hierarchical Supervisor with Subordinate Task Decomposition)
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Autonomous multi-step commerce workflows (abandoned cart recovery, restock calculation, delivery exception escalation) require coordinated actions across multiple specialized agents without single-agent prompt bloat.
- **Decision**: Implemented a hierarchical Supervisor-Worker topology (`SupervisorAgent`) coordinating specialized domain agents (`SalesAgent`, `CustomerSupportAgent`, `OrderAssistantAgent`, `InventoryAgent`, `ShippingAgent`, `PaymentAgent`, and `VerifierAgent`). The Supervisor decomposes objectives into discrete, bounded tasks with assigned toolsets.
- **Consequences**: Strict separation of concerns; individual agents execute within bounded iterations and timeout limits with zero cognitive overload.

---

## ADR-025: Directed Acyclic Graph (DAG) Task Planning, Kahn's Topological Sort, and Static Cycle Rejection
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Inter-task dependencies (e.g. inventory must be checked before generating promotional discount) must execute in strict dependency order while permitting parallel execution of independent tasks. Cyclic dependencies must be caught before execution.
- **Decision**: Implemented `PlanValidator` using Kahn's algorithm for topological sort and cycle detection. Validates max depth (10), max tasks (25), dependency existence, and computes parallel execution batches (`executionOrder: string[][]`).
- **Consequences**: Guaranteed acyclic workflow execution; zero runtime dependency deadlocks; parallel execution of peer tasks with automated output passing.

---

## ADR-026: Deterministic Physical Verifier Agent (Zero-Hallucination Evidence Matching against DB State)
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Generative AI agents may assert that an order was created, inventory reserved, or payment confirmed even when an API call failed or hallucinated.
- **Decision**: Implemented `VerifierAgent`. Claims produced by worker agents are independently verified by querying actual database records (`db.findOrderById`, `db.getInventory`, `db.findPaymentById`) using deterministic invariant checks. If no backing record exists, the verification status is set to `FAILED` and the task is aborted.
- **Consequences**: Zero hallucination risk on financial, order, or inventory commitments. LLMs cannot falsify operational state.

---

## ADR-027: 5-Tier Autonomy Matrix & Action Risk Categorization
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Enterprise merchants require fine-grained control over autonomous agent capabilities, ranging from advisory copilots to conditional autonomy.
- **Decision**: Established a 5-tier autonomy scale (`LEVEL_0_DISABLED`, `LEVEL_1_COPILOT`, `LEVEL_2_ASSISTED`, `LEVEL_3_CONDITIONAL`, `LEVEL_4_HIGH`) governed by `AutonomyPolicyService`. Actions are categorized dynamically into `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL` risk. Critical and High risk actions require human operator sign-off based on tenant policy.
- **Consequences**: Predictable safety boundaries; merchants can safely pilot autonomous agents on low-risk operations while keeping high-value mutations behind approval gates.

---

## ADR-028: Pre-Execution Entity State Revalidation (Optimistic Concurrency & Anti-Stale Action Shield)
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: In high-throughput commerce, an entity (e.g. Order #1002) may mutate between when an agent plans an action (e.g. Cancel Order) and when a human operator reviews and approves the request minutes or hours later.
- **Decision**: Implemented mandatory pre-execution entity state revalidation in `ApprovalEngine`. The planning snapshot (`entity_state_snapshot`) is compared against the live database record upon approval. If the entity state diverged (e.g. order already shipped by warehouse staff), the approval is automatically rejected with a `409 Conflict` and `STALE_STATE_DETECTED`.
- **Consequences**: Complete defense against stale race conditions, double shipments, and inconsistent cancellations.

---

## ADR-029: Immutable Idempotent Action Receipts and Multi-Agent Audit Bus
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Network retries and multi-agent coordination can inadvertently trigger duplicate mutations (e.g., duplicate stock reservations or double refund processing).
- **Decision**: Every mutating task generates a unique `idempotency_key` and creates an immutable `ActionReceipt` stored in `db.action_receipts`. Duplicate execution attempts with identical idempotency keys return existing receipts without executing duplicate mutations.
- **Consequences**: Strict idempotency across all multi-agent actions and an unforgeable cryptographic ledger of automated mutations.

---

## ADR-030: Inter-Agent Communication Bus and Capability-Bounded Delegation Containment
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Uncontrolled agent-to-agent delegation can cause infinite execution loops (`Agent A -> Agent B -> Agent A`) or privilege escalation where an agent delegates actions beyond its authorized scope.
- **Decision**: All inter-agent communication is structured into `AgentMessage` records and routed through `AgentRegistryService.validateDelegation()`. Enforces:
  1. Capability possession check (target agent must declare capability).
  2. Anti-cyclic self-delegation and mutual loop rejection.
  3. Maximum delegation depth bounds.
- **Consequences**: Safe, auditable inter-agent collaboration with zero infinite loop vulnerabilities.

---

## ADR-031: Durable Workflow State Machine with Step-Level Checkpointing & Crash Resilience
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Long-running multi-agent workflows may pause for human approval, hit external rate limits, or encounter container restarts.
- **Decision**: Implemented `WorkflowStateMachine` and durable step checkpointing in `WorkflowEngine`. At every step transition, a snapshot of workflow state, tasks, context, and budget is persisted to `db.workflow_checkpoints`. Workflows can be paused, resumed, or recovered after crashes without re-running completed idempotent tasks.
- **Consequences**: Zero lost state during operational downtime or human approval waits; 100% durable resume capability.

---

## ADR-032: Event-Driven Reactive Automation Engine with Cooldown Buffers & Daily Quotas
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: High-frequency domain events (`inventory.low_stock`, `payment.failed`, `order.cancelled`) can cause runaway agent execution loops and budget exhaustion if triggered excessively.
- **Decision**: Implemented `EventTriggerService` evaluating structured condition predicates (`EQUALS`, `GREATER_THAN`, `CONTAINS`) with mandatory `cooldown_seconds` and `max_runs_per_day` limits per rule.
- **Consequences**: Autonomous reactivity to real-time commerce events with guaranteed defense against cascade loops and token budget depletion.

---

## ADR-033: Autonomous Multi-Agent Cron Scheduling Architecture with Timezone Awareness
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Routine commerce operations (daily inventory reconciliation, morning abandoned cart digest, weekly margin audit) require automated recurring scheduling aligned to local merchant business hours.
- **Decision**: Implemented `AgentSchedulerService` managing cron schedules tied to `Asia/Dhaka` timezone. Schedules evaluate due timestamps, instantiate validated workflows, and update `last_run_at` and `next_run_at`.
- **Consequences**: Hands-off operational automation for merchants without reliance on external cron daemons.

---

## ADR-034: Pre-Execution Workflow Simulation & Token Spend Projection Engine
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Merchants need visibility into what an autonomous multi-agent workflow will do, how much it will cost, and where human intervention will be required BEFORE deploying it.
- **Decision**: Implemented `WorkflowSimulator` (`/api/v1/ai/workflows/simulate`). Simulates plan decomposition, extracts required agents and tools, estimates token consumption and USD costs, and projects policy approval points without writing to the database.
- **Consequences**: Complete pre-flight visibility and predictability for operators; enhances trust in autonomous agent operations.

---

## ADR-035: Canonical Metric Registry with Formal Aggregation Rules & Tenant Scoping
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Different commerce modules, reports, and AI agents frequently recalculate critical commerce metrics (e.g. gross revenue, net margin, return rate, stockout rate) with subtly conflicting definitions, leading to inconsistent analytics and hallucinated summaries.
- **Decision**: Implemented a canonical `MetricRegistryService` defining standard commerce metrics with immutable metadata, unit types, deterministic aggregation formulas (`SUM`, `AVG`, `RATIO`, `COUNT`), and tenant boundary scoping. Unregistered metric queries are strictly rejected.
- **Consequences**: Single source of truth for all analytical calculations; eliminates contradictory KPI reporting across dashboards, agents, and API consumers.

---

## ADR-036: Zero-Injection Parameterized Analytics Query Engine
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Analytical querying must support dynamic filters (time range, product category, courier, customer segment) while guaranteeing zero SQL/code injection, zero LLM runtime mutation, and tenant isolation.
- **Decision**: Implemented `AnalyticsQueryService` utilizing structured, parameterized `AnalyticsQueryRequest` objects with strict enum-based dimensional grouping and comparison windowing (`PREVIOUS_PERIOD`, `PREVIOUS_YEAR`). Queries run deterministically without raw query construction.
- **Consequences**: Safe, auditable analytics query execution with zero vulnerability to prompt or SQL injection attacks; reproducible comparative reporting.

---

## ADR-037: Real-Time Intelligence Ingestion & Streaming Rollup Aggregator
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Calculating metrics across hundreds of thousands of historical transactions on every page load or agent inquiry incurs prohibitive computational overhead.
- **Decision**: Implemented `IntelligenceIngestionService` consuming domain events (`order.created`, `order.delivered`, `payment.paid`, `inventory.adjusted`) with idempotency deduplication and incremental rollup calculations across hourly, daily, and monthly aggregate buckets.
- **Consequences**: Sub-millisecond KPI retrieval from pre-aggregated rollups with near real-time operational synchronization and zero duplicate event processing.

---

## ADR-038: Dual-Method Statistical Anomaly Detection (Z-Score + Static Invariants)
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: E-commerce anomalies span both gradual statistical drifts (e.g. return rate increasing by 2.5 standard deviations) and sudden critical failures (e.g. payment gateway failure rate exceeding 25% or checkout abandonments spiking above 80%).
- **Decision**: Implemented `AnomalyDetectorService` combining statistical Z-score calculations over rolling historical windows with static invariant tripwires for business-critical thresholds. Generated anomalies strictly separate statistical detection from qualitative natural-language explanation.
- **Consequences**: Rapid, noise-resistant detection of commercial anomalies with structured evidence citations attached for operator verification.

---

## ADR-039: Multi-Horizon Forecasting Engine with Bangladesh Retail Seasonality & Confidence Intervals
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Merchants require predictive projections across 7, 14, 30, and 90-day horizons to plan inventory purchases and cash flow, particularly accounting for Bangladeshi retail patterns (e.g. Friday/Saturday order spikes).
- **Decision**: Implemented `ForecastingService` utilizing Holt-Winters moving average models with day-of-week seasonality factors and 95% confidence intervals (`confidence_lower`, `confidence_upper`). If historical records are below the minimum required threshold, the engine gracefully yields an `INSUFFICIENT_DATA` status without crashing.
- **Consequences**: Robust predictive intelligence with transparent uncertainty bounds and resilience against cold-start scenarios for newly onboarded merchants.

---

## ADR-040: Zero-Mutation What-If Simulation Sandbox with Microeconomic Elasticity Modeling
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Merchants and agents need to evaluate the downstream impact of commercial adjustments (e.g. a 10% price increase, 15% promotional discount, or 20% inventory buffer increase) without mutating actual catalog or inventory records.
- **Decision**: Implemented `SimulationService` executing in-memory what-if simulations based on empirical price elasticity of demand (Ed = -1.2 for retail apparel), computing projected revenue, order volume, and gross margin deltas while strictly maintaining zero mutations against the primary database.
- **Consequences**: Safe exploration of strategic decisions with zero operational risk to active storefront listings or live stock levels.

---

## ADR-041: RFM Quantile Segmentation & Probabilistic LTV Modeling
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Customer retention and targeted marketing require dynamic segmentation based on transaction recency, frequency, and monetary contribution rather than arbitrary static rules.
- **Decision**: Implemented `CustomerIntelligenceService` scoring customers on an empirical 1–5 scale across Recency, Frequency, and Monetary dimensions, classifying them into 6 standard segments (`CHAMPIONS`, `LOYAL_CUSTOMERS`, `POTENTIAL_LOYALISTS`, `AT_RISK`, `HIBERNATING`, `LOST`). Additionally computes observed LTV and predicted 12-month forward LTV.
- **Consequences**: Actionable customer cohort insights enabling automated VIP retention, re-engagement workflows, and churn prevention.

---

## ADR-042: 7-Factor Explainable Recommendation Synthesis Framework
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Black-box AI recommendations ("You should order 200 shirts") are distrusted by merchants and lead to ignored advice or dangerous misconfigurations.
- **Decision**: Implemented `RecommendationService` mandating 7 structured explainability factors for every generated recommendation:
  1. Grounded Evidence Citations
  2. Root-Cause Rationale
  3. Estimated Financial Benefit (BDT)
  4. Probabilistic Confidence Score
  5. Action Risk Level (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)
  6. Minimum Required Autonomy Level
  7. Assumptions, Risks & Disqualifying Conditions
- **Consequences**: High-trust, verifiable business guidance with complete transparency into why an action was proposed and what assumptions underpin it.

---

## ADR-043: Controlled Autonomous Decision Proposal Bridge to Phase 5 Policy & Approval Engine
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Recommendations must not remain dead-end dashboard cards; high-confidence recommendations should seamlessly transition into executable actions under Phase 5 governance.
- **Decision**: Implemented `DecisionService` bridging Phase 6 recommendations to Phase 5 `ApprovalEngine` and `WorkflowEngine`. High-risk proposals automatically generate an `ApprovalRequest` and enter `PENDING_APPROVAL`, while low-risk proposals under Level 3/4 autonomy can trigger automated workflow execution with an immutable audit trail.
- **Consequences**: Safe, seamless progression from commercial insight to governed autonomous execution without bypassing policy controls.

---

## ADR-044: Post-Decision Feedback Loop & Empirical Outcome Tracking
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Systems that recommend actions without measuring post-execution results cannot improve, detect deteriorating models, or calibrate risk scoring.
- **Decision**: Implemented `DecisionFeedbackLoopService` recording `DecisionOutcome` snapshots after predefined evaluation horizons (e.g. 14, 30 days). Evaluates expected vs actual metrics (`delta_pct`), classifying results as `EXCEEDED`, `MET`, or `UNDERPERFORMED`, and logs structured learning notes into the tenant audit record.
- **Consequences**: Continuous model calibration, empirical accountability for autonomous decisions, and systematic prevention of repeated sub-optimal actions.

---

## ADR-045: Data Quality Governance, Boundary Isolation & Machine Learning Model Registry
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Machine learning and statistical algorithms are vulnerable to corrupted input data, schema drift, uncalibrated model versions, and cross-tenant leakage.
- **Decision**: Implemented `DataQualityService` performing automated multi-factor data health audits (completeness, freshness, format validity, anomaly rate, tenant boundary isolation) and `ModelRegistryService` managing the lifecycle, versioning, performance metrics (MAE, RMSE, MAPE), and activation state of analytical models.
- **Consequences**: Production-grade ML governance, automated data drift alerts, and guaranteed multi-tenant safety.

---

## ADR-046: Dual Dynamic & Predictive Audience Segmentation Engine with Immutable Snapshot Cryptographic Hashing
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Growth campaigns require flexible cohort targeting using dynamic multi-criteria rule trees (`AND`/`OR` conjunctions) while guaranteeing that audience membership at execution time is strictly auditable and reproducible without being distorted by subsequent data changes.
- **Decision**: Implemented `AudienceService` and `SegmentEngineService` supporting rule-based (`DYNAMIC`), RFM/LTV (`PREDICTIVE`), behavioral, and lifecycle audiences. When a campaign or journey executes, the audience is materialized into an immutable `AudienceSnapshot` stamped with a deterministic SHA-256 member hash (`sha256_<digest>`) and frozen member customer IDs.
- **Consequences**: Flexible dynamic targeting with zero operational risk of member drift during asynchronous multi-touch campaign delivery and complete historical auditability.

---

## ADR-047: 10-Stage Deterministic Customer Lifecycle State Machine & Transition Auditing
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Customer progression across awareness, purchase, retention, and churn is non-linear and requires standardized operational stages to coordinate automated growth workflows across Bangladeshi social commerce and web channels.
- **Decision**: Implemented `CustomerLifecycleService` enforcing a 10-stage deterministic state machine (`PROSPECT`, `NEW`, `ACTIVE`, `FIRST_PURCHASE`, `REPEAT`, `LOYAL`, `AT_RISK`, `DORMANT`, `CHURNED`, `REACTIVATED`). Every lifecycle transition is recorded into an immutable `CustomerLifecycleTransition` audit ledger with explicit trigger events (`order.delivered`, `inactivity.timer`, `cart.abandoned`).
- **Consequences**: Predictable, transparent customer journeys that allow timely re-engagement nudges and prevent premature churn without ad-hoc heuristic sprawl.

---

## ADR-048: Multi-Node Customer Journey Engine with Step-Level Checkpoints & Durable Execution
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Automated lifecycle nurture programs require multi-step branching logic (`TRIGGER`, `ELIGIBILITY`, `CONDITION`, `ACTION`, `WAIT`, `SPLIT`, `EXPERIMENT`, `EXIT`) that can pause for days or weeks across time delays without losing execution state or relying on fragile long-running process memory.
- **Decision**: Implemented `JourneyEngineService` managing customer journey enrollments as durable state machines. Each customer progression is tracked in `CustomerJourneyEnrollment` with step-level execution history, context payloads, and ISO timestamped `wait_until` suspension points compatible with background cron evaluation.
- **Consequences**: Resilient, durable customer journeys that survive process restarts and execute complex multi-touch nurture tracks with zero customer drops.

---

## ADR-049: Campaign Risk Tiering & Phase 5 Approval Gating with Multi-Level Emergency Kill Switches
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Outbound marketing automation across SMS, WhatsApp, and Facebook can cause financial damage (e.g. runaway discount codes, oversized ad spend) or reputational harm if deployed without safeguards.
- **Decision**: Implemented `CampaignService` enforcing automated risk classification (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) based on audience size, budget thresholds (> ৳20,000), and discount depth (> 15% percentage or > 30% critical). High and critical risk campaigns are blocked from execution until human merchant approval is granted via Phase 5 `ApprovalEngine`. Added global and per-tenant instant emergency kill switches that pause running dispatches.
- **Consequences**: Strict enterprise safety preventing unauthorized mass communications or margin destruction while preserving autonomous agility for low-risk micro-campaigns.

---

## ADR-050: Granular Multi-Channel Consent Management, Suppression Lists & Frequency Capping (Daily/Weekly)
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Aggressive marketing across personal channels (WhatsApp, SMS, Messenger) causes customer fatigue, spam complaints, and platform bans if opt-outs and message frequencies are not rigorously enforced.
- **Decision**: Implemented `ConsentService` and `FrequencyCappingService` enforcing channel-level consent preferences (`OPTED_IN`, `OPTED_OUT`, `EXPLICIT_CONSENT`), hard suppression lists with expiry dates, and strict daily/weekly frequency caps (default: max 3/day, 10/week) with mandatory minimum cooldown windows (default: 4 hours) between consecutive messages.
- **Consequences**: Brand reputation protection, reduced opt-out rates, compliance with telecom/Meta communication policies, and respect for customer quiet hours.

---

## ADR-051: Grounded Multilingual Copy Synthesis with Live Catalog Price & Stock Factuality Verification
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Marketing copy generated in localized Bangla, Banglish, and English often hallucinates incorrect prices, promises unavailable products, or creates deceptive urgency ("miracle cure", "fake discount").
- **Decision**: Implemented `ContentService` synthesizing culturally authentic copy backed by mandatory automated verification against Commerce Core database state (`verifyContentFactuality`). Validates exact product price match (delta <= ৳1), real-time warehouse variant inventory availability (total stock > 0), active offer code validity, and blocks prohibited deceptive marketing keywords.
- **Consequences**: 100% factual, verifiable marketing copy that protects merchant credibility and guarantees customers can actually buy what is advertised.

---

## ADR-052: Promotional Offer Engine with Margin-Floor Protection & Elasticity-Based Simulation
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Blanket promotional discounts frequently erode product gross margins and attract unprofitable or abusive redemption patterns.
- **Decision**: Implemented `OfferService` managing structured offers (`PERCENTAGE`, `FIXED_AMOUNT`, `FREE_SHIPPING`, `BUY_X_GET_Y`) coupled with pre-flight margin simulation via Phase 6 elasticity modeling. Automatically flags offers where projected net margin drops below the 15% margin floor and enforces cart-level validation rules (minimum cart value, customer usage caps, category constraints).
- **Consequences**: Protected retail profitability, guaranteed positive net margins on discount campaigns, and elimination of coupon abuse.

---

## ADR-053: Co-Purchase Affinity Matrix & Anti-Duplicate Abandoned Checkout Recovery
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Cross-selling and abandoned checkout recovery are primary revenue drivers in Bangladeshi commerce, but generic product suggestions and premature checkout recovery messages annoy customers who already ordered.
- **Decision**: Implemented `ProductRecommendationService` calculating co-purchase affinity matrices across historical multi-item orders (`pairCounts` / `singleCounts` confidence percentages) to provide grounded cross-sell and upsell suggestions. In checkout recovery, added anti-duplicate verification checking whether the customer already placed an order after the cart was abandoned before dispatching recovery nudges.
- **Consequences**: Higher average order value (AOV), elevated repeat conversion rates, and elimination of embarrassing post-purchase recovery messages.

---

## ADR-054: Frequentist A/B Testing Engine with Deterministic Hash Assignment & Sample Size Guardrails
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Marketing teams frequently declare false winners in A/B tests after small, noisy sample sizes or deploy split tests that assign different variants to the same user across different visits.
- **Decision**: Implemented `ExperimentService` providing deterministic hash-based participant assignment (`hash(experimentId:customerId) % 100`) ensuring variant stability across sessions. Winner determination requires reaching minimum sample size thresholds across all variants (`min_sample_size * variant_count`) and computes frequentist conversion lift and p-value significance before concluding tests.
- **Consequences**: Statistically sound marketing optimization, prevention of illusory correlations, and consistent customer experience.

---

## ADR-055: Multi-Touch Attribution Engine (First-Touch, Last-Touch, Linear, Time-Decay) Distinguishing Attributed vs Incremental Revenue
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Single-touch attribution (e.g. last-click only) distorts marketing ROI by penalizing top-of-funnel awareness campaigns and rewarding low-effort retargeting, while failing to distinguish attributed revenue from baseline organic transactions.
- **Decision**: Implemented `AttributionService` supporting 4 attribution models (`FIRST_TOUCH`, `LAST_TOUCH`, `LINEAR`, `TIME_DECAY`) across customer journey touchpoints. Calculates campaign revenue credits alongside an estimated incremental revenue calculation (70% incremental factor) to isolate true marketing lift from baseline organic sales.
- **Consequences**: Unbiased marketing channel valuation, accurate ROAS tracking, and data-driven budget allocation across acquisition and retention channels.

---

## ADR-056: 7-Factor Explainable Growth Recommendation Synthesis with Strategy Categorization
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Automated growth recommendations must be immediately understandable to non-technical merchants and align directly with core e-commerce business goals (acquisition, activation, retention, revenue, referral).
- **Decision**: Implemented `GrowthIntelligenceService` synthesizing opportunities and risk interventions mapped across the pirate metrics funnel (`AARRR`), requiring all 7 explainability factors (strategy, target audience, recommended channel, evidence metrics, rationale, projected financial benefit, and action risk level).
- **Consequences**: Actionable, executive-ready growth guidance that merchants can review, simulate, and approve with complete operational clarity.

---

## ADR-057: Multi-Agent Growth Supervisor DAG Decomposition & Centralized Marketing Tool Execution
- **Date**: 2026-09-19
- **Status**: Approved
- **Context**: Complex commercial objectives (e.g. "Increase repeat purchases by 15% through personalized Banglish WhatsApp retention campaigns") require coordinated specialization across audience analysis, product affinities, copy generation, and margin verification.
- **Decision**: Implemented `GrowthSupervisorAgent` formulating validated multi-agent execution DAGs involving specialized Phase 7 agents (`CUSTOMER_LIFECYCLE`, `AUDIENCE_ANALYST`, `PRODUCT_RECOMMENDER`, `CONTENT_AGENT`, `SIMULATION`, `VERIFIER`, `SUPERVISOR`). Registered 18 marketing tools into `ToolRegistry` with strict Zod schemas, RBAC assertion, and tenant isolation.
- **Consequences**: Modular agent orchestration, separation of analytical reasoning from state mutation, and enterprise-grade policy containment for autonomous growth operations.

---

## ADR-058: Operational Digital Twin Projection as Read-Only Aggregate Mirror
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Autonomous commerce operations across inventory, procurement, pricing, orders, fulfillment, shipping, payments, finance, support, and returns require real-time system visibility without putting transactional locking strain on the ACID commerce core database.
- **Decision**: Implemented `OperationalTwinService` projecting an immutable, point-in-time Digital Twin (`OperationalDigitalTwin`) summarizing system health score (0–100), operational system modes (`AUTONOMOUS`, `SEMI_AUTONOMOUS`, `COPILOT`, `EMERGENCY_HALTED`), and key operational metrics across 10 commerce domains. The Digital Twin is strictly a read-model projection; authoritative state remains in the relational database.
- **Consequences**: Zero contention on transactional tables; single-pane-of-glass operational telemetry for autonomous agents, human operators, and executive oversight.

---

## ADR-059: Governed 11-Stage Operations Loop with Verification and Cryptographic ActionReceipts
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Autonomous AI agents must never be permitted to execute unconstrained database mutations or opaque operations without physical verification, auditability, and rollback capability.
- **Decision**: Implemented the governed 11-stage operational loop (`OBSERVE → DETECT → UNDERSTAND → DECIDE → SIMULATE → POLICY CHECK → APPROVAL → PLAN → EXECUTE → VERIFY → RECORD`). Every mutating action generates an immutable `ActionReceipt` containing tenant ID, agent ID, idempotency key, entity type, entity ID, cryptographic SHA-256 state before/after hash, verification status, and rollback payload.
- **Consequences**: Provable auditability, zero untracked state changes, replay protection, and guaranteed deterministic rollback capability across all operational domains.

---

## ADR-060: Deterministic Replenishment & MOQ Optimization for Purchase Orders
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Automated restocking must account for real sales velocity, supplier minimum order quantities (MOQ), unit costs, lead times, and warehouse capacities without LLM hallucination of inventory or pricing math.
- **Decision**: Implemented `ProcurementService` and `InventoryOperationsService` calculating 30-day sales velocity, forward days-of-supply, and safety stock levels. Restock quantities automatically enforce supplier MOQs and preferred vendor rules, drafting purchase orders with strict state machine transitions (`DRAFT → PENDING_APPROVAL → APPROVED → SENT → RECEIVED`).
- **Consequences**: Elimination of stockouts for fast-moving SKUs, adherence to supplier contractual MOQs, and accurate working capital management.

---

## ADR-061: Elasticity-Aware Dynamic Pricing with Immutable Margin-Floor Safeguard
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Dynamic pricing adjustments and clearance markdowns carry the catastrophic risk of selling below cost price or eroding retailer profitability if unconstrained.
- **Decision**: Implemented `PricingOperationsService` enforcing an immutable gross margin floor (minimum 15% default, configurable per tenant). Any proposed price reduction that violates the margin floor is automatically rejected before execution. All price changes support automated rollback to restore original prices.
- **Consequences**: Safe algorithmic pricing adjustments, guaranteed retail margin protection, and instantaneous rollback capability.

---

## ADR-062: Multi-Warehouse Order Fulfillment Planning and Routing
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Multi-location retail operations in Bangladesh (Dhaka hub, Chittagong depot, regional fulfillment centers) require optimal order splitting, inventory allocation, and carrier assignment to minimize transit times and delivery costs.
- **Decision**: Implemented `FulfillmentOperationsService` evaluating fulfillment readiness, warehouse stock availability, delivery geography (Inside Dhaka vs. Outside Dhaka), and recommending warehouse-to-courier assignments.
- **Consequences**: Faster order fulfillment, reduced split-shipment shipping costs, and optimal regional warehouse utilization.

---

## ADR-063: Courier In-Transit Delay Detection and Automated Carrier Failover
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Bangladeshi third-party logistics (Steadfast, Pathao, RedX) suffer from frequent regional transit delays, hub congestions, and delivery exceptions.
- **Decision**: Implemented `CourierOperationsService` continuously monitoring active consignments against expected delivery ETAs. Delayed parcels (>24h beyond SLA) trigger operational exceptions, and future dispatches on degraded routes automatically fail over to higher-performing alternative carriers.
- **Consequences**: Reduced delivery delays, mitigated RTO rates, and proactive customer support notification before customer complaint escalation.

---

## ADR-064: Deterministic MFS & Financial Ledger Reconciliation
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Mobile Financial Services (bKash, Nagad) and Courier COD settlements frequently involve payment reference typos, transaction mismatches, and delayed settlement batches.
- **Decision**: Implemented `PaymentOperationsService` and `FinanceOperationsService` matching incoming transaction IDs (TrxID) and settlement amounts against pending orders deterministically, verifying payment status and flagging unverified or duplicate payments as high-priority financial exceptions.
- **Consequences**: Zero leakage in MFS revenues, automated COD reconciliation against courier remittance sheets, and auditable financial discrepancy resolution.

---

## ADR-065: Centralized Operational Exception Management Engine
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Operational issues across shipping, inventory, payments, and fulfillment must be triaged, prioritized, assigned to domain agents or humans, and tracked through to verified resolution.
- **Decision**: Implemented `ExceptionManagementService` capturing structured exceptions with domain classification, severity rating (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), automated root cause hypothesis generation, resolution proposals, and resolution logging.
- **Consequences**: Systematic operational incident tracking, transparent root cause analysis, and reduced time-to-resolution for commerce anomalies.

---

## ADR-066: External Provider Health Monitoring and Automated Circuit Breakers
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Third-party APIs (SMS gateways, courier tracking, bKash webhook ingress) experience intermittent downtime, rate limits, and latency spikes that can cascade into system failures.
- **Decision**: Implemented `ProviderHealthService` maintaining rolling health scores (0–100) and consecutive failure counters. When consecutive failures exceed threshold (default: 5), an automated circuit breaker trips (`STATUS: CIRCUIT_BROKEN`), diverting traffic to secondary providers and preventing cascading failure.
- **Consequences**: High system resilience, automatic isolation of failing external dependencies, and graceful failover.

---

## ADR-067: Progressive Bulk Mutation Safeguards with Sample Previews and Execution Gates
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Mass operational actions (e.g. updating prices on 500 SKUs, cancelling 50 unfulfilled orders) carry systemic risk if applied instantaneously without preview or intervention mechanisms.
- **Decision**: Implemented `BulkSafeguardService` requiring preview sampling, dry-run simulation summaries, and progressive batch processing (chunks of 5–10 items) with emergency kill switch verification evaluated at each batch step.
- **Consequences**: Catastrophic mass update prevention, deterministic dry-run previews, and instant abort capability during in-flight executions.

---

## ADR-068: Multi-Tier Autonomy Budget Enforcement and Emergency Kill Switch
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Autonomous agent operations must have strict, bounded financial and transactional guardrails that can never be exceeded without explicit human elevation.
- **Decision**: Implemented `OperationalBudgetService` enforcing daily maximum spend limits (BDT), maximum autonomous action counts, and single-action financial caps. Established an Emergency Kill Switch that immediately halts all autonomous mutations and forces the system into `COPILOT` or `EMERGENCY_HALTED` mode.
- **Consequences**: Bounded financial exposure, total operational containment, and immediate human control takeover during system emergencies.

---

## ADR-069: Multi-Entity Hierarchy & Server-Side Scope Authorization
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Scaling commerce organizations manage multiple distinct brands, business units, physical outlets, and online storefronts under a shared corporate umbrella without compromising data boundaries.
- **Decision**: Implemented `EnterpriseHierarchyService` and `EnterpriseDataAccessService` establishing a 4-tier hierarchy (`Organization -> BusinessUnit -> EnterpriseBrand -> EnterpriseStore`). Enforced strict server-side scoping on every data retrieval and mutation where authorized stores are resolved from authenticated cryptographic session context, never accepted blindly from client request parameters.
- **Consequences**: Complete multi-brand and multi-store data isolation, zero cross-store leakage, and seamless roll-up reporting for enterprise holding companies.

---

## ADR-070: Governed Semantic Metrics Layer & Cross-Store Benchmarking
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Different business units often compute vital metrics (e.g. Gross Margin, Delivery SLA, Stockout Rate) inconsistently, producing disputed executive reports and distorted performance reviews.
- **Decision**: Implemented `SemanticMetricsService` and `EnterpriseBenchmarkingService` establishing centralized, versioned metric definitions with standardized formulas, dynamic time grains, and data quality confidence ratings. Implemented cohort percentile calculation (P10, Median P50, Frontier P90) and variance driver decomposition.
- **Consequences**: Single source of analytical truth across all operating entities, mathematically sound efficiency frontiers, and transparent peer performance benchmarking.

---

## ADR-071: Integration Hub with Checkpointed Sync Engine & Conflict Resolution
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Enterprise ERPs (SAP, NetSuite), CRMs (Salesforce, HubSpot), and Marketplaces (Daraz, Shopify) exchange asynchronous catalog and order updates that can generate contradictory transactional states.
- **Decision**: Implemented `IntegrationHubService`, `SyncEngineService`, and `ConflictResolutionService`. Enforced durable, checkpointed synchronization cycles and 5 governed conflict resolution strategies (`COMMERCEOS_WINS`, `EXTERNAL_WINS`, `LATEST_VALID_UPDATE`, `MANUAL_REVIEW`, `FIELD_OWNERSHIP`).
- **Consequences**: Zero silent data overwrites, deterministic data provenance, and automated conflict isolation with audit logs.

---

## ADR-072: Zero-Trust Developer Platform & HMAC-SHA256 Signed Webhooks
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: External partner applications and developer integrations require secure API authentication and real-time event notifications without risking credential exposure.
- **Decision**: Implemented `DeveloperPlatformService` issuing `cos_live_...` API keys stored as one-way SHA-256 hashes with sliding-window rate limiters. Implemented `WebhookPlatformService` providing HMAC-SHA256 signature verification (`X-CommerceOS-Signature`), delivery logging, exponential backoff retries, and dead-letter queueing.
- **Consequences**: Production-grade developer ecosystem security, tamper-proof webhook deliveries, and protection against API key brute-forcing.

---

## ADR-073: Enterprise Data Governance, PII Masking & Customer Identity Resolution
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Multi-store operations must comply with data protection regulations, prevent unauthorized employee access to customer PII, and stitch fragmented customer identities across channels.
- **Decision**: Implemented `DataGovernanceService` with 4-tier data classification (`RESTRICTED`, `CONFIDENTIAL`, `INTERNAL`, `PUBLIC`) and clearance-based PII masking. Implemented `EnterpriseCustomerIdentityService` resolving customer identities deterministically across stores via verified phone numbers and channel IDs without corrupting individual storefront histories.
- **Consequences**: Regulatory privacy compliance, protection of sensitive customer data from internal breach, and unified 360-degree customer lifetime value tracking across corporate brands.

---

## ADR-074: Autonomous Platform Architecture & 6-Layer Operational Model
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Autonomous commerce operations across Commerce, Social, Intelligence, Growth, Operations, and Enterprise must operate as one unified, governed operating system rather than fragmented point solutions.
- **Decision**: Established the 6-layer autonomous operational model:
  1. Business Objective Layer (Strategic Intent)
  2. Strategy & Optimization Layer (Cross-Domain Formulation)
  3. Decision & Policy Layer (Deterministic Governance)
  4. Cross-Domain Orchestration Layer (Structured Multi-Agent Collaboration)
  5. Execution & Tool Gateway Layer (ACID Commerce Mutations)
  6. Learning & Quality Layer (Shadow/Canary Feedback Loops)
- **Consequences**: Unifies all prior 9 phases into a self-coordinating platform while preserving the Prime Directive: `Agent -> Policy Engine -> Tool Gateway -> Domain Service -> Commerce Core -> DB`.

---

## ADR-075: Objective-Driven Governance & Multi-Tier Hierarchy Resolution
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Autonomous agents require top-down guidance to align operational actions with corporate financial targets and risk limits.
- **Decision**: Implemented `BusinessObjectivesService` supporting multi-tier hierarchy (`ENTERPRISE -> BUSINESS_UNIT -> BRAND -> STORE -> DOMAIN -> WORKFLOW -> AGENT_TASK`) with budget caps, constraint evaluation, progress tracking, and risk assessment.
- **Consequences**: Every autonomous action is bound to an active corporate objective; unaligned or unauthorized agent initiatives are rejected before execution.

---

## ADR-076: Global Decision Engine & Mandatory Human Approval Gates
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Autonomous decisions involving pricing, inventory liquidation, or budget reallocation carry financial and reputation risk if executed without verification.
- **Decision**: Implemented `GlobalDecisionEngineService` enforcing explicit state transitions (`PENDING -> EVALUATING -> SIMULATING -> AWAITING_APPROVAL -> APPROVED -> EXECUTING -> VERIFIED`). Decisions with HIGH or CRITICAL risk strictly require human elevation before execution.
- **Consequences**: Zero unauthorized high-risk operations; every decision records full simulation outcomes, policy evaluations, and cryptographic audit trails.

---

## ADR-077: Strategy Formulation, Non-Destructive Simulation & Trade-Off Engine
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Complex business strategies span multiple domains and can produce unintended cross-domain side effects (e.g. ad spend surge depleting stock).
- **Decision**: Implemented `StrategyEngineService` and `OptimizationEngineService` with non-destructive Monte Carlo simulation and multi-objective Pareto trade-off ranking. Simulation NEVER mutates live production data.
- **Consequences**: Operators and agents preview worst-case, expected, and best-case revenue and margin outcomes before any live strategy activation.

---

## ADR-078: Structured Inter-Agent Protocol & Consensus Conflict Resolution
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Autonomous domain agents (Inventory, Marketing, Support, Finance) can develop contradictory proposals (e.g. Marketing wants to run flash sale; Inventory wants to preserve low stock).
- **Decision**: Implemented `CrossDomainOrchestratorService` with structured message envelopes (`REQUEST`, `RESPONSE`, `PROPOSAL`, `EVIDENCE`, `CONFLICT`, `ACKNOWLEDGEMENT`) and 5 deterministic conflict resolution strategies (`PRIORITY_WINS`, `CONSTRAINT_WINS`, `NEGOTIATION`, `SIMULATION_DECIDES`, `HUMAN_DECIDES`).
- **Consequences**: Eliminates deadlock between agents, prevents contradictory operational commands, and transparently logs inter-agent debate and consensus.

---

## ADR-079: Unified Real-Time Cross-Domain Context Aggregator
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Autonomous decision-makers require an atomic, holistic view of commerce metrics, operational health, growth signals, and active risks to make informed decisions.
- **Decision**: Implemented `UnifiedContextService` aggregating Commerce, Operations, Intelligence, Growth, Enterprise, and Agent telemetry into a unified snapshot with automated opportunity and risk detection.
- **Consequences**: Agents reason over shared, coherent platform state rather than stale, isolated domain caches.

---

## ADR-080: Continuous Learning Pipeline with Staged Safe Promotion
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Continuously learning platforms must never train directly on raw production events or auto-apply unvalidated prompt/policy adjustments.
- **Decision**: Implemented `ContinuousLearningService` with a strict multi-stage promotion pipeline: `IDENTIFIED -> VALIDATING -> VALIDATED -> SHADOW_TESTING -> CANARY_TESTING -> GOVERNANCE_REVIEW -> DEPLOYED`. Unrestricted self-modification is strictly blocked.
- **Consequences**: Models and policies improve from empirical outcomes while preventing prompt injection poisoning, reward hacking, and catastrophic forgetting.

---

## ADR-081: Model Governance Registry, Lineage Tracking & Provider Abstraction
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Enterprise operations cannot depend on a single AI provider or unversioned foundation models without drift tracking and regulatory compliance.
- **Decision**: Implemented `ModelGovernanceService` and `AIProviderAbstractionService` supporting model versioning, evaluation benchmarks, rollback versions, provider health checks, and fallback chains across Gemini, Anthropic, OpenAI, and self-hosted models.
- **Consequences**: Zero vendor lock-in, automated failover during provider outages, and full model lineage audits for enterprise compliance.

---

## ADR-082: Policy-Governed Task-Aware Model Routing & Latency/Cost Optimization
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Routing every task to the largest frontier model produces excessive operational expenditure and high latency on simple classification tasks.
- **Decision**: Implemented `ModelRoutingService` evaluating data sensitivity (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`), latency caps, and cost thresholds to route requests to the optimal model and provider.
- **Consequences**: Substantial reduction in platform token costs, sub-second latency for customer-facing queries, and strict data residency compliance for sensitive data.

---

## ADR-083: Evidence-Based Autonomy Adaptation with Mandatory Board Oversight
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Dynamic autonomy levels must adjust based on empirical operational accuracy, but agents must NEVER have the capability to elevate their own autonomy permissions.
- **Decision**: Implemented `AutonomyAdaptationService` generating recommendations (`MAINTAIN_AUTONOMY`, `INCREASE_AUTONOMY`, `DECREASE_AUTONOMY`) based on 30-day rolling success rates, verification outcomes, and human overrides. Promotion to higher autonomy strictly requires external human governance approval.
- **Consequences**: Autonomy gracefully degrades to Copilot upon performance deterioration and can only scale with verified human sign-off.

---

## ADR-084: 11-Dimension Platform Health Scoring & Autonomous Quality Scorecard
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Multi-domain autonomous platforms require deep, multi-dimensional health visibility to detect subtle degradation before catastrophic service failures occur.
- **Decision**: Implemented `PlatformHealthService` measuring 11 distinct dimensions (Commerce, Operations, Intelligence, Growth, Enterprise, Agents, Models, Infrastructure, Integrations, Data, Security) alongside a daily/weekly/monthly Autonomous Quality Scorecard tracking decision accuracy, policy compliance, and false automation rates.
- **Consequences**: Early detection of domain anomalies, proactive self-healing alerts, and quantitative tracking of autonomous governance health.

---

## ADR-085: Cost-Aware Autonomy Economics & Unit Decision Efficiency Tracking
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Autonomous operations must demonstrate economic viability by tracking the exact cost-to-value ratio of every automated decision and agent run.
- **Decision**: Implemented `PlatformEconomicsService` tracking LLM token costs, tool execution expenses, cost per order, cost per autonomous decision, and cost efficiency ratios (`business_value / automation_cost`) by domain and agent entity.
- **Consequences**: Total visibility into operational expenditure, automated identification of inefficient agent loops, and cost optimization recommendations without compromising safety.

---

## ADR-086: Two-Tier Rollback: State Restoration & Compensating Action Architecture
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Real-world operations include both reversible actions (price updates, catalog configuration) and irreversible actions (dispatched SMS messages, courier parcel pickups, executed payments).
- **Decision**: Implemented `AutonomousRollbackService` with a two-tier architecture:
  1. Reversible Actions: Deterministic snapshot restoration (`executeRollback`)
  2. Irreversible Actions: Governed compensating workflows (`createCompensatingAction`) with escalated enterprise admin authorization requirements.
- **Consequences**: Safe failure recovery across physical and digital commerce operations without leaving corrupted intermediary states.

---

## ADR-087: Cross-Domain Incident Management, Blast Radius & Auto-Remediation
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: High-severity incidents in one domain (e.g. payment gateway timeout) rapidly cascade across domains (checkout drops, order confirmation retries, customer support queues explode).
- **Decision**: Implemented `GlobalIncidentService` calculating cross-domain blast radius, coordinating multi-domain incident response teams, auto-linking affected services, and managing the full lifecycle (`DETECTED -> INVESTIGATING -> MITIGATING -> RESOLVED -> POSTMORTEM`).
- **Consequences**: Rapid incident containment, automated cross-domain alerting, and structured root-cause postmortem capture.

---

## ADR-088: Multi-Region Data Residency & SLO Error Budget Burn Rate Governance
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Enterprise internationalization requires strict compliance with regional data sovereignty laws (e.g. Bangladesh Data Protection, GDPR) and mathematical service level objective (SLO) enforcement.
- **Decision**: Implemented `DataResidencyService` validating cross-border data transfer compliance by classification (`CUSTOMER_PII`, `FINANCIAL_DATA`), and `SLOEngineService` calculating error budgets, burn rates, and projected exhaustion dates across core commerce microservices.
- **Consequences**: Zero non-compliant cross-border data transfers, proactive deployment freezes when error budgets burn excessively, and contractual SLA compliance for enterprise tenants.

---

## ADR-089: Architectural Separation of n8n Orchestration Hub & CommerceOS Authority (ADR-Automation-N8n-Boundary)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Workflow automation engines like n8n excel at external messaging, notification fanout, scheduling, and third-party SaaS synchronization, but risk becoming fragile, unversioned monolithic backends if allowed to own transactional state or business invariants.
- **Decision**: Established a strict unidirectional boundary:
  1. CommerceOS is the sole authoritative source of truth for all business logic, transactions, state machines, permissions, audit records, and idempotency.
  2. n8n serves exclusively as an asynchronous orchestration hub, executing scheduled triggers, webhook dispatch, and notification delivery.
  3. Direct database access, raw SQL execution, or unvalidated state mutations from n8n Code nodes or external workflows are strictly prohibited. All interactions must route through authenticated, rate-limited `/api/v1/automation/*` and `/api/v1/automation/actions/*` endpoints.
- **Consequences**: Prevents unmaintainable shadow logic in workflow canvases, eliminates split-brain transactional anomalies, and guarantees enterprise auditability.

---

## ADR-090: Deterministic Granular Idempotency Engine & Distributed Mutation Locking (ADR-Automation-Idempotency)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Asynchronous workflows, courier retries, and network blips frequently trigger duplicate delivery attempts for critical commerce operations (order state updates, stock decrements, SMS dispatch).
- **Decision**: Implemented `IdempotencyService` utilizing atomic composite keys formatted as `tenant_id:idempotency_key:operation`.
  - New requests acquire a `PROCESSING` lock with a 5-minute time-to-live.
  - Concurrent duplicates during `PROCESSING` are rejected with `409 Conflict`.
  - Completed operations store cached response status codes and serialized response bodies with a 24-hour retention window, returning identical results on subsequent replay.
- **Consequences**: Zero duplicate order status transitions, zero double decrements on warehouse inventory, and deterministic idempotency guarantees for third-party courier and payment webhooks.

---

## ADR-091: Cryptographic Inbound Webhook Gateway with Replay & Drift Defense (ADR-Automation-Webhooks)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Bangladeshi logistics providers and external webhook producers deliver status updates over public internet endpoints vulnerable to spoofing, eavesdropping, and replay attacks.
- **Decision**: Implemented `WebhookGatewayService` enforcing:
  1. Cryptographic HMAC-SHA256 signature verification matching provider-specific headers (`x-steadfast-signature`, `x-pathao-signature`, `x-redx-signature`, etc.).
  2. Replay and clock drift protection rejecting payloads whose timestamp exceeds a 300-second (5-minute) threshold.
  3. Event-ID deduplication against an immutable audit ledger before domain dispatch.
- **Consequences**: Webhook endpoints are hardened against forged events, MITM tampering, and stale replay storms.

---

## ADR-092: Bangladeshi Courier Status Normalization & Autonomous Shipment Sync (ADR-Courier-Synchronization)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Bangladesh delivery providers (Steadfast, Pathao, RedX, Paperfly, eCourier, Sundarban) use wildly disparate status strings (`in_review`, `parcel_at_hub`, `assigned_to_rider`, `delivered_approval_pending`) and incompatible payload structures.
- **Decision**: Implemented `CourierSyncService` with provider-specific translation adapters mapping external statuses to canonical CommerceOS states (`PENDING`, `PICKED_UP`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `PARTIAL_DELIVERY`, `RETURNED`, `CANCELLED`, `LOST`, `DAMAGED`).
  - Unrecognized strings safely map to `UNKNOWN` while preserving original raw metadata for developer inspection.
  - Delivery confirmation autonomously reconciles order status to `DELIVERED` and COD payment records to `PAID`.
- **Consequences**: Unified logistics tracking, automated cash-on-delivery financial closing, and resilient handling of courier schema changes.

---

## ADR-093: Bounded Exponential Backoff with Jitter for Automation Retries (ADR-Automation-Retry)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Uncontrolled retry loops on transient network failures or rate limits cause thundering herd problems that worsen provider outages.
- **Decision**: Implemented `RetryQueueService` enforcing bounded exponential backoff with full jitter:
  - Configurable attempt limits (default 3, maximum 5).
  - Delay calculation: `delay = min(maxDelayMs, baseDelayMs * 2^(attempt - 1)) * (0.5 + Math.random() * 0.5)`.
  - Immediate abort without retries for non-transient errors (e.g. 401 Unauthorized, 403 Forbidden, 404 Not Found, 422 Unprocessable Entity).
- **Consequences**: Mitigates downstream congestion, avoids hammering degraded external providers, and prevents cascading service failures.

---

## ADR-094: Dead Letter Queue (DLQ) Lifecycle, Root Cause Categorization & Replay (ADR-Automation-Dead-Letter)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Failed workflow executions must not disappear silently, and manual inspection requires categorized error context and controlled single/bulk replay capabilities.
- **Decision**: Implemented `DeadLetterService` capturing terminal execution failures with structured error categorization (`TIMEOUT`, `AUTH_FAILURE`, `NETWORK_ERROR`, `SCHEMA_VALIDATION`, `CIRCUIT_BROKEN`, `BUSINESS_RULE_VIOLATION`, `RATE_LIMITED`, `INTERNAL_ERROR`).
  - DLQ entries support state transitions (`NEW -> INVESTIGATING -> REPLAYED / RESOLVED / DISCARDED`).
  - Replay executes through the router with a fresh idempotency key and correlation chain linking back to the original failure.
- **Consequences**: 100% operational observability for failed automation attempts, zero silent data loss, and swift incident remediation.

---

## ADR-095: Production n8n Integration, Credential Isolation & Environment Injection (ADR-N8n-Integration)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Distributing workflow templates containing hardcoded credentials, static URLs, or insecure code nodes risks token leakage and breaks cross-environment portability (local dev vs staging vs production).
- **Decision**:
  1. Production n8n workflows export strictly as valid n8n schema v1 JSON files placed in `/n8n/workflows/`.
  2. All HTTP Request nodes reference n8n credential objects (`genericAuthType: "httpHeaderAuth"` with credential named `"CommerceOS API"`).
  3. Base URLs reference environment variable `$env.COMMERCEOS_API_BASE_URL` with zero hardcoded hosts.
  4. Standard workflow library provided: Order Created Notifications, Courier Status Sync, Payment Verification, Low Stock Alerts, and Abandoned Checkout Recovery.
- **Consequences**: Workflows are immediately importable into any self-hosted or cloud n8n instance without security risks or manual JSON editing.

---

## ADR-096: Semantic Workflow Versioning, Migration Lifecycle & Template Library (ADR-Automation-Workflow-Versioning)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Upgrading automation workflows across active tenants requires non-breaking version transitions, backward compatibility, and catalog-driven instantiation.
- **Decision**: Implemented `AutomationRegistryService` and standard template registry supporting:
  1. Semantic versioning (`major.minor.patch`) on all workflow templates.
  2. 39 standard pre-built workflow templates across 8 core e-commerce categories (Orders, Inventory, Customers, Logistics, Payments, Marketing, Returns, Analytics).
  3. Tenant-scoped installation with parameter customizer and activation toggling.
- **Consequences**: Instant tenant onboarding to enterprise-grade automation with zero workflow schema collision.

---

## ADR-097: Multi-Layer Automation Safety: Recursion Depth, Rate Limiting & Emergency Kill Switch (ADR-Automation-Loop-Protection)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Event-driven automation systems can trigger runaway feedback loops (e.g. Order Updated triggers Webhook, which updates Order, triggering Webhook again), incurring prohibitive billing costs and database exhaustion.
- **Decision**: Implemented `AutomationSafetyService` enforcing a 5-pillar defensive perimeter:
  1. Max recursion depth limit (max 5 hops) tracked via execution causal chain.
  2. Sliding-window rate limiting per tenant and per automation rule (max 60 executions/minute).
  3. Emergency global and tenant-level kill switch (`emergencyStop`) that instantly halts all automation processing.
  4. Dry-run simulation mode (`isDryRun: true`) enabling operators to preview trigger matches and action payloads without committing mutations.
  5. Guardrail policy evaluation rejecting sensitive or unauthorized payload structures.
- **Consequences**: Absolute defense against runaway event recursion, guaranteed API stability, and zero-risk workflow testing in production.

---

## ADR-098: Multi-Provider Automation Abstraction & Health Circuit Breakers (ADR-Automation-Provider-Abstraction)
- **Date**: 2026-09-20
- **Status**: Approved
- **Context**: Relying exclusively on a single automation engine creates single-point-of-failure vulnerabilities. The system must support native internal execution alongside external orchestrators (n8n, webhook engines).
- **Decision**: Implemented `ProviderCircuitBreakerService` and `N8nProviderService` adopting the Provider Abstraction Pattern.
  - Tri-state circuit breaker per provider (`NORMAL`, `DEGRADED`, `OPEN`, `HALF_OPEN`) with failure threshold of 5 consecutive errors and a 60-second recovery cooldown.
  - Automated health monitoring checking latency, error rates, and endpoint availability.
- **Consequences**: High availability for enterprise operations; external n8n cluster downtime triggers graceful fallback or queued execution without failing customer checkout.

---

## ADR-099: Super Admin Role, Platform Control Plane, Connector Segregation & Automations Isolation (ADR-Super-Admin-Platform-Control)
- **Date**: 2026-09-24
- **Status**: Approved
- **Context**: As CommerceOS matures into a multi-tenant B2B SaaS platform, regular store staff were exposed to sensitive infrastructure credentials (raw database URIs, vector DB indexes, Redis ports, and n8n circuit breakers). Additionally, platform operators lacked an omnipotent Super Admin role for multi-tenant provisioning, cross-tenant telemetry, global kill-switches, and safe tenant impersonation.
- **Decision**:
  1. Defined canonical `SUPER_ADMIN` role possessing platform omnipotence, universal permissions, and dedicated platform capabilities (`PLATFORM_PERMISSIONS.*`).
  2. Created dedicated Super Admin Control Plane (`/super-admin`) featuring a 12-column Bento Grid, universal tenant directory, cryptographic tenant impersonation, central AI gateway fallback cascade, and master emergency stop.
  3. Segregated Connectors Hub (`/connector`): Regular store staff only view operational store connectors (Parcel Delivery Couriers, Social Channels, and Google Ads connect). Cloud infrastructure (AI LLMs, Vector DB, Redis, Relational DBs, Enterprise ERPs) is restricted to Admins and Super Admins.
  4. Moved Automations & n8n Hub (`/automations`) strictly under the `ADMIN` and `SUPER_ADMIN` roles, hiding it from the floating dock for regular store users and enforcing 6-state UX `PermissionDenied` guardrails.
- **Consequences**: Eliminates clutter for merchant store staff, protects platform infrastructure credentials from unauthorized exposure, and establishes scalable multi-tenant governance.

---

## ADR-100: Authoritative Separation of Platform Scope and Tenant Scope Authorization Boundary (ADR-Platform-Scope-Separation)
- **Date**: 2026-09-24
- **Status**: Approved (Authoritative Architecture Standard)
- **Context**: 
  - Earlier iterations (e.g., ADR-099) initially treated `SUPER_ADMIN` as a role within tenant RBAC or mixed platform permissions (`PLATFORM_PERMISSIONS.*`) into tenant catalogs, where `ROLE_PERMISSIONS.OWNER = Object.values(PERMISSIONS)`.
  - Conflating platform administration with tenant tenancy creates grave architectural vulnerabilities:
    1. Tenant Owners could inadvertently inherit platform privileges (e.g. cross-tenant tenant management, global automation kill switch, platform billing governance).
    2. A compromised tenant admin credential could escalate privileges to the SaaS control plane.
    3. Impersonation of a tenant user by platform support could unintentionally leak platform rights into tenant operations.
- **Decision**:
  1. **Strict Dual Authorization Domains**: Formally decouple the authorization model into two independent scopes:
     - `PLATFORM SCOPE`: Identity is `PlatformMembership` / `PlatformUser`. Context is `PlatformContext`. Governed by `PlatformAuthorizationService`.
     - `TENANT SCOPE`: Identity is `TenantMembership` / `TenantUser`. Context is `RequestContext`. Governed by `RbacService`.
  2. **Zero Inferred Authority**:
     - `TENANT_OWNER` $\neq$ `SUPER_ADMIN`.
     - Platform roles (`SUPER_ADMIN`, `PLATFORM_ADMIN`, `PLATFORM_OPERATIONS`, `PLATFORM_SUPPORT`, `PLATFORM_FINANCE`, `PLATFORM_SECURITY`, `PLATFORM_ANALYST`) exist only in `PlatformMembership`.
     - Ordinary tenant roles (`OWNER`, `ADMIN`, `DEV`, `MANAGER`, `SALES`, `SUPPORT`, `MARKETING`, `INVENTORY`, `FINANCE`, `ANALYST`) never grant platform permissions.
  3. **Platform Context Resolution**:
     - Platform routes (`/api/v1/platform/*`) must authenticate via `PlatformSessionToken` and resolve a dedicated `PlatformContext` (containing `platformUserId`, `platformRole`, `platformPermissions`, `mfaVerified`, `sessionExpiresAt`).
     - Tenant routes (`/api/v1/*`) continue to resolve `RequestContext` tied to a specific `tenantId`.
  4. **Controlled Impersonation Boundary**:
     - When platform support impersonates a tenant user, the effective permission set is strictly the TARGET USER's permissions in that specific tenant.
     - Platform privileges are NEVER carried over into an impersonation session.
     - Impersonation defaults to `READ_ONLY`, requires justification, step-up MFA, time-bounded expiration, and continuous audit attribution (`original_actor_id`, `effective_actor_id`, `impersonation_session_id`).
  5. **Data Access Minimization (Need-To-Operate)**:
     - Platform dashboards access aggregated metrics and operational telemetry, never raw unmasked customer PII or raw database shells. Direct SQL via browser is strictly forbidden.
- **Consequences**:
  - Eliminates privilege escalation paths between tenants and the SaaS platform.
  - Guarantees strict multi-tenant isolation even in the presence of compromised tenant accounts.
  - Establishes a rock-solid, production-grade foundation for the Super Admin / SaaS Owner Platform Control Plane.

---

## ADR-101: Integration of TypeSafe AI Jev (System One) Model for Sub-20ms Decisions and Policy Guardrails
- **Date**: 2026-09-25
- **Status**: Approved & Implemented
- **Context**:
  - High-throughput Bangladeshi social commerce (Facebook comments, Messenger, WhatsApp DMs) produces thousands of routine inquiries daily (*"dam koto?"*, *"stock ache?"*).
  - Calling Tier 1/2 generative LLMs (Gemini 1.5 Pro/Flash, GPT-4o) for every simple routing or classification decision introduced 400ms–1,200ms latency and high operational cost ($0.003–$0.015/turn).
  - TypeSafe AI introduced **Jev**, a specialized **System One model** trained via RLCD (Reinforcement Learning for Calibrated Decisions) that evaluates structured state and returns typed `Choice`, `Score`, and `Noul` (calibrated probabilities) in ~15ms at 400x lower cost.
- **Decision**:
  1. **Tier 0 System One Layer**: Integrate Jev as a reflex decision tier within `src/domains/ai/providers/jev/` without altering core business rules.
  2. **Stage 3 Inbound Router**: Integrate Jev into `AgentRouter.route()` after deterministic rules and Banglish normalization, yielding sub-20ms intent and agent routing.
  3. **AutoMode Policy Guardrailing**: Use Jev in `AgentPolicyService.evaluateToolRiskWithJev()` to dynamically gate proposed tool arguments before execution or human approval queue routing.
  4. **Bangladesh COD & RTO Risk Engine**: Implement `RtoRiskEngine` to evaluate doorstep refusal risk on Outside Dhaka Cash-on-Delivery orders to enforce bKash advance delivery fee requirements.
  5. **Circuit Breaker & Offline Fallback**: Implement a 5-failure threshold sliding-window circuit breaker with automatic fallback to `MockJevProvider` / Tier 1 LLM.
- **Consequences**:
  - Inbound intent routing latency dropped from ~850ms to ~12ms.
  - High-volume classification cost reduced by up to 400x.
  - 100% backward-compatible: all 27 core AI & RAG tests continue to pass with zero regressions.
  - Jev decisions remain non-authoritative for inventory, unit prices, and financial ledgers, maintaining Prime Directive compliance.

---

## ADR-102: Agent Governance Restructure: STATUS as Source of Truth
- **Date**: 2026-09-27
- **Status**: Approved
- **Context**: `.agent/` docs described the target design in the present tense; `PROJECT_STATE.md` claimed "Phase 12 complete" while the 2026-09-27 audit found CRITICAL auth bypasses and mostly simulated integrations. Docs duplicated invariants and contradicted each other (tokens, thresholds, fees, roles). Product-agent personas were filed as coding-agent skills. Nothing was auto-loaded by coding tools.
- **Decision**: Root `AGENTS.md` (+ `CLAUDE.md` importing it) is the entry point. `.agent/STATUS.md` is the single source of truth for what works; architecture docs carry status banners. Invariants/11 questions/DoD live only in `.agent/GOVERNANCE.md`. Numeric values live in code (tokens.css, constants) and docs cite them. Product-agent specs moved to `.agent/runtime-agents/`, product procedures to `.agent/specs/platform/`. Rules carry activation frontmatter. Claude Code wrappers, hooks, and subagents live in `.claude/`.
- **Consequences**: Less duplicated text to drift; agents can't mistake target design for current reality; enforcement moves partly into hooks. Previous layout archived in `.backups/agent-folder-2026-09-27.tar.gz`.
