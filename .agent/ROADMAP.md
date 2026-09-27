# CommerceOS Platform Implementation Roadmap

> **Status:** "COMPLETED" below means code was written for the phase, not that it is LIVE. Real status per capability: STATUS.md. Current priority: FIX_IMPLEMENTATION_PLAN.md Phase 0.

The development of CommerceOS progresses through 11 disciplined, verified phases:

```
[ Phase 0: Foundation & Governance ] ───► COMPLETED
               │
               ▼
[ Phase 1: Core Platform & Shell ]   ───► COMPLETED
               │
               ▼
[ Phase 2: Authoritative Commerce Core ] ───► COMPLETED
               │
               ▼
[ Phase 3: Social Commerce & Ingress ]   ───► COMPLETED
               │
               ▼
[ Phase 4: Agent Runtime & Policy Engine ] ───► COMPLETED
               │
               ▼
[ Phase 5: Multi-Agent Orchestration ] ───► COMPLETED
               │
               ▼
[ Phase 6: Commerce Intelligence Engine ] ───► COMPLETED
               │
               ▼
[ Phase 7: Autonomous Growth & Lifecycle ] ───► COMPLETED
               │
               ▼
[ Phase 8: Autonomous Operations Engine ] ───► COMPLETED
               │
               ▼
[ Phase 9: Enterprise Intelligence & Ecosystem ] ───► COMPLETED
               │
               ▼
[ Phase 10: CommerceOS Autonomous Platform ] ───► COMPLETED
               │
               ▼
[ Phase 11: Production n8n & Automations Hub ] ──► COMPLETED
               │
               ▼
[ Phase 12: Super Admin / Platform Control Plane ] ─► GOVERNANCE ESTABLISHED
```


---

## Phase Milestones & Exit Gates

### Phase 0: Foundation & `.agent` System (Completed)
- [x] Repository audit and greenfield state verification.
- [x] Establishment of complete `.agent/` operating system (root docs, rules, workflows, skills, templates, ADRs).
- [x] Phase 0 sign-off and verification report.

### Phase 1: Core Platform & Application Shell (Completed)
- [x] Next.js + Vanilla CSS tokens & Bento grid layout scaffolding.
- [x] Floating navigation dock (vertical desktop, bottom mobile) & TopBar with command search.
- [x] Multi-tenant context and cryptographic JWT session authentication.
- [x] Multi-tenant normalized database foundation with tenant scoping and atomic persistence.
- [x] Dashboard shell rendering all 6 UI states with zero fake metrics.
- [x] RBAC enforcement across 9 canonical roles and assertCan() gatekeeper.
- [x] Immutable audit trail logging with tenant isolation.
- [x] 19 Automated tests passing across Auth, Isolation, RBAC, Invitations, and Audit.

### Phase 2: Authoritative Commerce Core (Completed)
- [x] Product catalog, SKU variants, and pricing models.
- [x] Inventory tracking, low-stock thresholds, and atomic reservation locks.
- [x] Order state machine with Inside/Outside Dhaka fee calculations.
- [x] bKash/Nagad/COD payment records and verification flows.
- [x] Steadfast/Pathao shipment data structures and courier adapter normalization.
- [x] 18 Automated tests passing across Catalog, Concurrency, Deduplication, Pricing, State Machine, RBAC.

### Phase 3: Social Commerce & Unified Inbox (Completed)
- [x] Multi-channel provider abstraction (`IChannelProvider`) and adapters (Facebook, Instagram, WhatsApp, Website Chat).
- [x] Webhook ingress with cryptographic HMAC signature verification (`X-Hub-Signature-256`, `hub.challenge`).
- [x] Canonical normalization (`NormalizedIncomingMessage`) with lossless raw Banglish analysis.
- [x] Customer identity resolution (Phone > Channel PSID > Email > Visitor ID) without profile corruption.
- [x] Conversation lifecycle state machine, team assignment history, unread counters, and tagging.
- [x] Internal notes (`INTERNAL_NOTE`) strictly isolated from customer delivery.
- [x] Outbound messaging pipeline with token bucket rate limiter, idempotency keys, and exponential backoff.
- [x] Controlled social order draft creation via Commerce Core `OrderService.createOrder`.
- [x] Domain event outbox and HMAC-signed webhook delivery for n8n automation.
- [x] Unified Social Inbox UI (3-column Bento layout) and Social Dashboard with real KPI metrics.
- [x] First-party website live chat simulator widget (`WebsiteChatWidget`).
- [x] 17 Automated tests passing across Webhooks, Banglish, Identity, Lifecycle, Orders, Tenant Isolation, RBAC.

### Phase 4: Agent Runtime & Policy Engine (Completed)
- [x] Deterministic Agent Orchestrator with intent classification.
- [x] Tool Registry with strict Zod schemas and RBAC allowlists.
- [x] Customer Support & Sales Agents handling Banglish inquiries.
- [x] Human-in-the-loop approval gate for sensitive actions.

### Phase 5: Multi-Agent Orchestration & Controlled Autonomy (Completed)
- [x] Supervisor agent, DAG planner, dynamic task router.
- [x] Agent Capability Registry with discovery and cyclic protection.
- [x] Shared execution workspace with scratchpad and multi-turn state.
- [x] Human-in-the-loop escalation and policy engine checks.

### Phase 6: Commerce Intelligence, Optimization & Decision Engine (Completed)
- [x] 14 Analytical engines (Demand, Stockout, Elasticity, CLV, Churn, Return/RTO).
- [x] Explainable recommendation generator with multi-objective trade-offs.
- [x] Simulation engine for counterfactual scenarios.
- [x] 9 Autonomous intelligence agents and Bento Grid BI control plane.

### Phase 7: Autonomous Growth, Marketing & Customer Lifecycle (Completed)
- [x] Dynamic & predictive customer segmentation engine.
- [x] 10-Stage customer lifecycle state machine with automated transitions.
- [x] Multi-step journey orchestrator with node execution.
- [x] Multi-channel campaign dispatcher with consent & frequency capping.
- [x] Fact-verified multilingual copywriter agent with RAG citations.
- [x] Margin-safe personalized offer & discount engine.
- [x] Co-purchase product recommender with FP-Growth affinity math.
- [x] Frequentist A/B testing & statistical significance engine.
- [x] Multi-touch attribution modeling (First, Last, Linear, Time-Decay, Position).

### Phase 8: Autonomous Commerce Operations Engine (Completed)
- [x] Real-time Operational Digital Twin projection across 10 commerce domains.
- [x] Inventory stockout risk evaluation and multi-warehouse balancing transfers.
- [x] Supplier MOQ replenishment modeling and Purchase Order drafting.
- [x] Elasticity pricing simulations with gross margin floor safeguards.
- [x] Multi-item warehouse allocation and courier optimization.
- [x] Courier in-transit delay detection and automated carrier failover.
- [x] Deterministic bKash/Nagad MFS transaction matching and reconciliation.
- [x] Automated daily financial reconciliation across orders and payments.
- [x] Operational exception classification, agent routing, and resolution.
- [x] Order SLA tracking, breach escalation, and automated mitigation.
- [x] External provider health monitoring, degradation detection, and circuit breakers.
- [x] Bulk mutation safeguards with dry-run previews and progressive batches.
- [x] Autonomy budget enforcement with daily spend limits and emergency kill switch.
- [x] Operations Supervisor DAG planner executing 11-stage governed workflows.
- [x] Physical mutation verification and immutable cryptographic ActionReceipts.
- [x] 14 Operational AI tools registered in ToolRegistry.
- [x] 15 Operational domain agents registered in AgentRegistry.
- [x] 19 REST API endpoints with tenant isolation and RBAC.
- [x] Bento Grid Operations UI with Command Center, Workflows, Exceptions, Autonomy, and Receipts.
- [x] 23 Automated tests passing in Phase 8 suite (165 total tests across all 8 phases).

### Phase 9: Enterprise Intelligence & Ecosystem Platform (Completed)
- [x] Multi-Entity Hierarchy Tree (Organizations, Business Units, Brand Groups, Brands, Stores, Sales Channels).
- [x] Server-side scope authorization & enterprise access control layer (Zero cross-store data leakage).
- [x] Enterprise RBAC with 11 specialized enterprise roles and 28 fine-grained permissions.
- [x] Semantic Metrics Layer with standard definitions, formula evaluation, dynamic time grains, and quality status.
- [x] Cross-store & cross-brand benchmarking with cohort percentiles, ranking, and variance decomposition.
- [x] Executive reporting engine with on-demand/scheduled runs and multi-entity CSV export packaging.
- [x] Integration Hub with standard connectors (SAP S/4HANA, NetSuite, Salesforce, HubSpot, Daraz, Shopify Plus).
- [x] Durable sync engine with checkpointing, status tracking, and batch processing.
- [x] Conflict resolution engine with 5 configurable strategies (CommerceOS Wins, External Wins, Latest, Manual).
- [x] Developer platform with OAuth application management, SHA-256 hashed API keys, and rate limiting.
- [x] Outbound webhook platform with HMAC-SHA256 signing, delivery logging, retry scheduling, and DLQ.
- [x] Enterprise data governance with sensitivity classification (Restricted/Confidential/Internal/Public) and PII masking.
- [x] Automated data quality audit engine detecting referential integrity and schema defects.
- [x] Cross-store deterministic customer identity stitching (Phone, Channel ID, Email).
- [x] Enterprise pricing policy hierarchy (Enterprise floor > Brand policy > Store override).
- [x] Operational incident management lifecycle (Detected, Triaged, Investigating, Mitigating, Resolved, Postmortem).
- [x] Enterprise AI governance with token budgets, cost ceilings, and hard-stop policy enforcement.
- [x] Enterprise Supervisor DAG planning agent with 5 validated cross-store multi-agent patterns.
- [x] 15 Enterprise domain agents registered in AgentRegistry.
- [x] 16 Enterprise AI tools registered in ToolRegistry.
- [x] 12 Enterprise REST API routes with cryptographic session context extraction and RBAC.
- [x] Bento Grid Enterprise UI with 7 rich views (Overview, Hierarchy, Analytics, Benchmarks, Integrations, Developer, Governance).
- [x] 15 Automated tests passing in Phase 9 suite (180 total tests across all 9 phases).

### Phase 10: CommerceOS Autonomous Platform (Completed)
- [x] Autonomous Control Plane & 6-Layer Architecture (Objective, Strategy, Decision, Orchestration, Execution, Learning).
- [x] Objective-Driven Governance & Hierarchy Resolution (`Enterprise -> BU -> Brand -> Store -> Domain -> Workflow -> Task`).
- [x] Global Decision Engine with options formulation, non-destructive simulation, policy checks, and mandatory human approval gates.
- [x] Multi-Objective Strategy & Tradeoff Optimization with Pareto ranking and constraint satisfaction.
- [x] Structured Inter-Agent Communication Protocol & Consensus Conflict Resolution (Priority, Constraint, Negotiation, Simulation, Human).
- [x] Real-Time Unified Cross-Domain Context Aggregator (Commerce, Operations, Intelligence, Growth, Enterprise, Agents).
- [x] Continuous Learning Pipeline with Staged Safe Promotion (`Identified -> Validated -> Shadow -> Canary -> Governance -> Production`).
- [x] Model Governance Registry, Lineage Tracking & AI Provider Abstraction (Gemini, Anthropic, OpenAI, Self-hosted).
- [x] Policy-Controlled Model Routing based on Task Sensitivity, Region, Cost, and Latency limits.
- [x] Evidence-Based Autonomy Adaptation with rolling 30-day performance checks and mandatory external board oversight.
- [x] 11-Dimension Platform Health Scoring & Autonomous Quality Scorecard (Accuracy, Compliance, Verification, False Automations).
- [x] Cost-Aware Autonomy Economics & Unit Decision Efficiency Tracking by domain and agent entity.
- [x] Two-Tier Reversible Rollback Engine & Compensating Action Architecture.
- [x] Cross-Domain Global Incident Management with Blast Radius Calculation and Root-Cause Postmortems.
- [x] Multi-Region Data Residency Policy Enforcement & SLO Error Budget Burn Rate Governance.
- [x] 6 Canonical Cross-Domain Autonomous Workflows (Demand Surge, Inventory Crisis, Profit Optimization, Retention Recovery, Operational Crisis, Enterprise Expansion).
- [x] Autonomous Supervisor Agent DAG decomposition and 7 Specialized Domain Agents.
- [x] 14 Autonomous Tools registered in ToolRegistry.
- [x] 14 REST API Endpoints with tenant isolation, RBAC, and standard JSON response envelopes.
- [x] Bento Grid Autonomous Control Tower UI with 7 Views (Overview, Objectives, Decisions, Agents, Learning, Health, Governance).
- [x] Global Event Architecture with Correlation ID, Idempotency, and Partitioned Event Replay.
- [x] 25 Automated tests passing in Phase 10 suite (205 total tests across all 10 phases).

### Phase 11: Production n8n & Automations Hub (Completed)
- [x] Real, exportable, valid n8n v1 schema JSON workflows delivered in `/n8n/workflows/`:
  - `commerceos-order-created-notification.json` (Multichannel customer & merchant alert sequence)
  - `commerceos-courier-status-sync.json` (Bangladeshi courier status polling and reconciliation)
  - `commerceos-payment-verification.json` (bKash/Nagad MFS transaction matching)
  - `commerceos-inventory-low-stock-alert.json` (Stockout forecasting & merchant warning)
  - `commerceos-abandoned-checkout-recovery.json` (Timed multi-channel recovery flow)
- [x] Zero hardcoded secrets: All n8n HTTP Request nodes use generic credential `"CommerceOS API"` and dynamic environment variable `$env.COMMERCEOS_API_BASE_URL`.
- [x] Docker deployment and workflow import tooling (`/n8n/README.md`, `/n8n/deployment/environment.example`, `/n8n/deployment/import.md`).
- [x] Complete library of 39 standard pre-built workflow templates across 8 core e-commerce domains.
- [x] Deterministic Idempotency Engine (`tenant_id:idempotency_key:operation`) with 5-minute locking and 24-hour result caching.
- [x] Cryptographic Inbound Webhook Gateway with HMAC signature verification, timestamp replay protection (<300s drift), and status translation for Bangladeshi couriers (Steadfast, Pathao, RedX, Paperfly, eCourier, Sundarban).
- [x] Bounded Retry Queue with exponential backoff, full jitter (max 3-5 attempts), and fast-fail on non-retryable 4xx errors.
- [x] Dead Letter Queue (DLQ) with 8 root-cause categories (`TIMEOUT`, `AUTH_FAILURE`, `NETWORK_ERROR`, etc.), investigation tracking, and single/bulk atomic replay.
- [x] Provider Circuit Breaker (`NORMAL`, `DEGRADED`, `OPEN`, `HALF_OPEN`) with failure threshold of 5 and 60-second recovery cooldown.
- [x] Automation Safety Perimeter: recursion depth hard cap of 5 hops, sliding-window rate limiting (60/min), dry-run simulation mode, and emergency kill switches.
- [x] 18 REST API endpoints for automations, workflows, executions, DLQ, providers, webhooks, and authoritative actions (`orders`, `inventory`, `shipments`, `notifications`).
- [x] Bento Grid Automations UI with 9 operational views and Command Palette integration.
- [x] 18 Automated tests in `automation-hub-tests.ts` (223 total passing tests across 11 test suites with zero failures).

### Phase 12: Super Admin / SaaS Owner Platform Control Plane (Governance Established)
- [ ] Dedicated Platform Authorization Boundary (`PlatformContext` vs `RequestContext`, `PlatformMembership` vs Tenant `Membership`).
- [ ] Granular Platform Permissions Catalog (`platform.*`, `tenant.*`, `subscription.*`, `plan.*`, `entitlement.*`, `automation.*`, `n8n.*`, `provider.*`, `execution.*`, `dlq.*`, `support.*`, `security.*`, `audit.*`, `maintenance.*`).
- [ ] 7 Specialized Platform Roles (`SUPER_ADMIN`, `PLATFORM_ADMIN`, `PLATFORM_OPERATIONS`, `PLATFORM_SUPPORT`, `PLATFORM_FINANCE`, `PLATFORM_SECURITY`, `PLATFORM_ANALYST`) completely decoupled from Tenant roles.
- [ ] Centralized Authorization Pipeline (Authentication → Identity → Scope → Permission → Policy → Step-Up → Approval → Domain Operation → Verification → Audit).
- [ ] 4-Tier Privileged Action Risk Framework (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) with step-up verification and dual-custodian approvals for critical mutations.
- [ ] Governed Support Impersonation Engine with `READ_ONLY` default, mandatory justification, target user permission scoping (no privilege escalation), persistent amber UI banner, and dual-actor audit logging.
- [ ] SaaS Plan & Entitlement Governance (`EntitlementService`, plans, versions, tenant-specific quota overrides, usage meters) strictly decoupled from store-level commerce checkout.
- [ ] Platform Automation & n8n Cluster Administration (worker health monitoring, cross-tenant failure diagnostics, DLQ management, circuit breaker recovery).
- [ ] Multi-Scope Emergency Kill Switch (`GLOBAL`, `TENANT`, `WORKFLOW`, `PROVIDER`, `CHANNEL`) with reversible state machine and operator notification.
- [ ] Immutable Platform Audit Trail (`platform_audit_logs`) with tamper-evident export and security event streaming.
- [ ] Super Admin Bento Grid UI with floating command dock, 18 operational views, dark charcoal / lime palette, and zero fake metrics.
- [ ] Comprehensive automated test suite validating platform authorization, isolation enforcement, impersonation downgrading, and privileged action safeguards.

