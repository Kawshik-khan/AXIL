# CommerceOS — Principal Engineer Audit (Security · Correctness · Performance · Wiring)

**Date:** 2026-09-27 · **Scope:** entire repo at `G:\OLama\CommerceOS` (60 pages/components, 236 API route handlers, ~200 domain services, data layer, tests)
**Method:** static trace (UI → route → service → store) + runtime verification against a local `next dev` instance on port 3017 + a read-only Neon query + `tsc --noEmit` + the project's own test suite.

> ⚠️ This document contains working exploit steps against this codebase. Do not share it publicly until the CRITICAL items are fixed.

**Runtime hygiene:** `.data/commerceos.json` was backed up before the runtime checks and restored afterwards (SHA-256 prefix `3a88ad48…` identical before/after). `tests/test-results.json` was restored (`5f4dec7d…`). The dev server regenerated the `.next/` build cache. The project's Neon integration test wrote test rows and deleted them; Neon row totals are identical before and after.

---

## Phase 0 — Recon & mental model

- **What it is:** a Next.js 14.2 App Router monolith (React 18, TypeScript 5.6) that presents itself as a multi-tenant "commerce OS" for Bangladeshi F-commerce: orders, catalog, inventory, shipments, a social inbox, AI agents, growth/marketing, intelligence, operations, enterprise, "autonomous", and a super-admin console.
- **Actual system of record:** a single in-process `CommerceDatabase` object (`src/infrastructure/db/index.ts`, 8,994 lines). It loads `.data/commerceos.json` (39 MB, 10,001 customers, 5,001 orders) at boot and **rewrites the whole file synchronously on every mutation**.
- **Neon PostgreSQL:** reachable and seeded (55 tables, 5,001 orders, 10,007 customers). **No page or API route reads or writes it.** The 11 repository classes are imported only by `tests/neon-integration-tests.ts`, and the two stores have diverged (Neon has 1 product and 0 inventory items; the JSON store has 153 products and 415 inventory items).
- **External calls that actually exist:** 4 `fetch` sites in total: TypeSafe/Jev `/decide`, n8n webhook (skipped for localhost), and Google Sheets (×2). There are no calls to Meta/WhatsApp/Instagram, bKash/Nagad, Steadfast/Pathao/RedX, Shopify, or any LLM.
- **Trust boundaries / untrusted input:**
  - `/api/v1/*`: cookie or Bearer JWT, plus `x-platform-token`, `x-test-platform-role`, `x-step-up-token`.
  - Public ingress: `/api/v1/automation/webhooks/[provider]`, `/api/v1/social/webhooks/*`, `/api/v1/social/widget/*`.
  - Auth: `/api/v1/auth/*` and `/api/v1/platform/auth/*`.
  - There is no `middleware.ts`, so every route authenticates itself.
- **Blast radius of dependencies:**
  - Loss of the JSON file means total data loss.
  - Neon, Redis and Pinecone outages have no effect on the app, because it doesn't use them.
  - A TypeSafe outage falls back to a mock.
- **Assumptions (UNVERIFIED):**
  - Deployment target is Docker Compose / Kubernetes per `.agent/DEVOPS.md`. No application Dockerfile exists in the repo.
  - Production would run `next start`, which forces `NODE_ENV=production`.
  - "Correct" means what the repo's own docs claim: a multi-tenant, Neon-backed, production-grade SaaS.

---

## 1. Executive Summary

**Overall risk posture: CRITICAL. The app is not safe to expose to any network.**

Six independent authentication bypasses were each verified at runtime:

- Master passwords work for every user.
- Sessions can be forged because the live JWT secret is the public default.
- A `x-test-platform-role` header grants super-admin in any environment, and the super-admin UI itself sends it.
- The courier/payment webhook accepts unsigned requests that mark orders DELIVERED and COD payments PAID.
- The step-up "MFA" accepts any 6 characters.
- Missing or invalid tokens fall back to OWNER in dev.

The live Neon credential is also committed in `.env.example`.

**Fix first:**
1. Rotate the Neon password and scrub `.env.example`.
2. Delete the master-password and header backdoors, and require a unique `JWT_SECRET`.
3. Authenticate the courier/payment webhooks.
4. Add RBAC to the ~100 unguarded growth/marketing/ops/autonomous/enterprise mutations, and restrict payment verification.
5. Replace the whole-file JSON persistence (move to the Neon repos that already exist).

**What breaks first in production:** throughput. Every write re-serializes the whole 39 MB store and blocks the server. Measured: one login took ~3 s; 3 concurrent logins pushed an unrelated 82 ms read to 8.6 s; opening the Intelligence page ran for 405 s and froze every other user. On multiple replicas, writes are silently lost.

**How much is real:** of 122 UI sections, features and infra pieces traced:

| Status | Count | Share |
|---|---|---|
| LIVE | 41 | 33.6% |
| PARTIAL | 38 | 31.1% |
| STATIC/DEMO | 22 | 18.0% |
| BROKEN | 15 | 12.3% |
| DEAD | 6 | 4.9% |

"LIVE" means the section round-trips through the local JSON file; **0% is wired to Neon**. Basic CRUD (orders, products, inventory, customers, inbox, settings) is genuinely functional. Every external integration is simulated but reports success: customer messaging, courier booking, payment verification, connector tests, and AI (all LLM output comes from a keyword-matching mock). The analytics numbers include hard-coded baselines, and the intelligence modules analyze only the newest 50 of 5,001 orders.

---

## 2. Wiring Inventory (Phase 3.5)

**Status legend:**
- **LIVE**: reads and writes the real store end-to-end. [JSON] means that store is the local file, not Neon.
- **PARTIAL**: real backend, but incomplete or partly faked.
- **STATIC**: hard-coded, seeded or mocked, with no real effect.
- **DEAD**: unreachable or never used.
- **BROKEN**: the call fails (404/401/timeout), or the handler is a stub that returns fake success.

Verified-by: **S** = static trace, **R** = runtime (dev server, 2026-09-27).

### 2a. Per-page / per-section

| # | Page › Section / Action | Status | UI (file:line) | Data source (file:line) | Evidence | By | Fix → LIVE |
|---|---|---|---|---|---|---|---|
| 1 | Auth › Login | LIVE [JSON] | `(auth)/login/page.tsx` | `api/v1/auth/login/route.ts:9` → `auth/service.ts:117` | Works; but `lib/security.ts:27-33` master passwords (C1) | R | S |
| 2 | Auth › Register | LIVE [JSON] | `(auth)/register/page.tsx` | `auth/service.ts:35` | New tenant gets no warehouse (M11) | R | S |
| 3 | Shell › Auth guard | PARTIAL | `(dashboard)/layout.tsx:25` | `lib/api-response.ts:93-137` | Dev fallback returns OWNER for missing or invalid tokens, so the guard never redirects (H1) | R | S |
| 4 | Shell › Nav / command palette / logout | LIVE | `components/navigation/*` | `api/v1/auth/logout/route.ts:9` | Logout does not clear the platform cookie (M9) | S | S |
| 5 | Command Center › KPI values | PARTIAL | `(dashboard)/page.tsx:132-135` | `reports/dashboard` → `db/index.ts:4864` | Real numbers, but falls back to ৳184,500 / 1,420 / ৳1,299 when the value is 0 | R | S |
| 6 | Command Center › KPI trend pills, margin | STATIC | `page.tsx:136, 577` | none | `baseMarginPercent = 24.8`; "+18.4%", "+12.6%", "42 awaiting courier", "72% repeat" are literals | S | S |
| 7 | Command Center › Revenue spline chart | STATIC | `page.tsx:766` | none | Hand-drawn SVG path; highlight fixed on "Jun" | S | M |
| 8 | Command Center › Channel donut | PARTIAL | `page.tsx:139` (fallback) | `db/index.ts:4930-4990` | Channel inferred from `order.notes` text (unmatched orders default to Facebook); conversion % hard-coded | S | M |
| 9 | Command Center › Needs Attention | STATIC | `page.tsx:286` | none | 5 hard-coded cards; "Verify Payments →" links to `/payments`, which doesn't exist (404) | S | S |
| 10 | Command Center › Intelligence pods | STATIC | `page.tsx:1196-1300` | none | "Panjabi Cotton-L stockout in 18h", "৳38,400 recovered"; "Approve +50 Units" has no handler | S | M |
| 11 | Command Center › Automation stats, agent stream | STATIC | `page.tsx:360, 1326-1346` | none | "14 Online / 2,840 / 99.8%", fake agent log lines | S | M |
| 12 | Command Center › City orders & returning buyers | PARTIAL | `page.tsx:207, 1436` | `db/index.ts:~5031-5060` | Order counts per division are real; returning %, reorder frequency, loyalty, growth and SLA are literals | S | S |
| 13 | Command Center › Operations & Stock box | STATIC | `page.tsx:1577-1625` | none | "23,340", "94.8%", "82%" literals | S | S |
| 14 | Command Center › Recent orders table | STATIC | `page.tsx:394, 1693` | none | Hard-coded ORD-1042…1038 even though the API returns `recentOrders` | S | S |
| 15 | Orders › List / search / filter | LIVE [JSON] | `orders/page.tsx:92` | `order.service.ts:12` → `db/index.ts:4610` | Search is O(O×C) (§Perf) | R | — |
| 16 | Orders › Create order | LIVE [JSON] | `orders/page.tsx:154` | `order.service.ts:39-230` | Server-side pricing and reservations are real; but division/district are hard-coded "Chittagong" for every order outside Dhaka (`orders/page.tsx:165-166`, M5) | S | S |
| 17 | Orders › Detail + status transitions | LIVE [JSON] | `orders/page.tsx:203` | `order.service.ts:232` + `order-state-machine.ts` | State machine enforced | S | — |
| 18 | Products › List / create / archive | LIVE [JSON] | `products/page.tsx:46-118` | `product.service.ts` | PATCH has a mass-assignment bug (H3) | R | S |
| 19 | Products › CSV bulk import | LIVE [JSON] | `components/catalog/BulkImportModal.tsx` | `api/v1/products/bulk` → `bulk-import.service.ts` | Random 4-digit SKU suffixes (L6) | S | — |
| 20 | Products › Google Sheets import | LIVE (external) | `BulkImportModal.tsx` | `lib/google-sheet.ts:87,127` | Real `fetch` pinned to Google hosts | S | — |
| 21 | Inventory › List, low-stock, warehouses | LIVE [JSON] | `inventory/page.tsx:62-63` | `inventory.service.ts` | Took 48 s in the sweep only because another request was blocking the server (C6) | R | — |
| 22 | Inventory › Adjust stock | LIVE [JSON] | `inventory/page.tsx:119` | `inventory.service.ts:23` | Guarded by `INVENTORY_ADJUST` | S | — |
| 23 | Shipments › List + manual status | LIVE [JSON] | `shipments/page.tsx:42,105` | `shipping.service.ts:156` | DELIVERED bypasses the order state machine and never commits reservations (H12) | S | M |
| 24 | Shipments › Book courier | PARTIAL | `shipments/page.tsx:76` | `shipping.service.ts:97` | No courier API. Tracking number is fabricated as `TRK-STE-<ts>`, consignment ID as `CSG-<ts>` | S | L |
| 25 | Customers › List / search / create / detail | LIVE [JSON] | `customers/page.tsx:59-118` | `customer.service.ts` | PATCH has a mass-assignment bug (H3) | R | S |
| 26 | Conversations › Inbox list | LIVE [JSON] | `conversations/page.tsx:66` | `social/conversations` routes | No polling or realtime, despite the "real time" copy (L7) | S | M |
| 27 | Conversations › Read / assign / tag / note / resolve / reopen | LIVE [JSON] | `conversations/page.tsx` | `conversation.service.ts` | | S | — |
| 28 | Conversations › Send reply | **BROKEN (stub)** | `ConversationThread.tsx` | `outbound-message.service.ts:159` → `facebook.adapter.ts:133-147` (IG `:117`, WA `:171`, Web `:71`) | Adapters never call Meta; they return `mockId` and the message is marked **SENT** (H8) | S | L |
| 29 | Conversations › AI copilot suggestions | STATIC/DEMO | `ConversationThread.tsx` → `/ai/copilot/suggest` | `model-router.ts:43-44` | `MockLLMProvider` for both primary and fallback (H9) | S | L |
| 30 | Conversations › Product search, social order draft, context panel | LIVE [JSON] | `ProductSearchModal.tsx`, `SocialOrderModal.tsx`, `CustomerContextPanel.tsx` | `social-order.service.ts:53` → `OrderService.createOrder` | Creates real orders | S | — |
| 31 | Conversations › Social KPIs, quick replies | LIVE [JSON] | `SocialDashboard.tsx` | `social-analytics.service.ts` | | R | — |
| 32 | Conversations › Channel "Test" | STATIC | `SocialDashboard.tsx` | `facebook.adapter.ts:198-202` | Any non-empty token counts as valid | S | M |
| 33 | Conversations › Website chat widget | STATIC/DEMO | `WebsiteChatWidget.tsx:23-26` | `/social/widget/message` (public, unauthenticated) | Hard-coded visitor "Tanvir Rahman" / 01711223344; a simulator, not a real embed | S | M |
| 34 | Inbound social webhooks (FB/IG/WA/web) | PARTIAL | n/a | `webhook-ingress.service.ts:61-86` | Ingests messages, but has signature-skip and cross-tenant routing issues (H4); FB profile names are fabricated (`facebook.adapter.ts:193`) | S | M |
| 35 | Growth › Overview | PARTIAL | `growth/page.tsx:93-94` | `api/v1/growth/overview/route.ts` | Inputs truncated to 50 rows (H5) | R | S |
| 36 | Growth › Campaign list | LIVE [JSON] | `growth/campaigns/page.tsx:17` | `db.getCampaigns` | | R | — |
| 37 | Growth › Approve / execute / pause / resume / simulate | PARTIAL | `growth/campaigns/page.tsx:36` | `campaign.service.ts:312-420` | Sends go through stub adapters; conversions fixed at 7% × ৳1,650; recipients beyond the newest 50 customers are silently "suppressed"; no RBAC; approver taken from the request body (H1, H6, M7) | S | M |
| 38 | Growth › Audiences list / refresh | LIVE [JSON] | `growth/audiences/page.tsx` | `audience.service.ts` | | R | — |
| 39 | Growth › Audience presets | **BROKEN (logic)** | `growth/audiences/page.tsx:78` | same | All 4 presets send the same rule `total_spend > 5000` (M6) | S | S |
| 40 | Growth › Journeys | LIVE [JSON] | `growth/journeys/page.tsx` | `journey-engine.service.ts` | | R | — |
| 41 | Growth › Lifecycle | PARTIAL | `growth/lifecycle/page.tsx` | `customer-lifecycle.service.ts` | 50-row truncation (H5) | R | S |
| 42 | Growth › Attribution | PARTIAL | `growth/attribution/page.tsx` | `attribution.service.ts` | 3,000 seeded attributions plus fabricated campaign revenue | S | M |
| 43 | Growth › Experiments | PARTIAL | `growth/experiments/page.tsx` | `experiment.service.ts` | Seeded experiments; `getExperimentById` isn't tenant-checked at `:72` | S | S |
| 44 | Marketing › Overview KPIs | LIVE [JSON] | `marketing/page.tsx` | `marketing.service.ts:683-708` | | R | — |
| 45 | Marketing › "AI insight" cards | STATIC | `marketing/page.tsx` | `marketing.service.ts:713-730` | Literal text ("86 dormant customers", "18.4%") | S | S |
| 46 | Marketing › Abandoned carts list, mark recovered | LIVE [JSON] | `marketing/page.tsx` | `marketing.service.ts:77,278` | | R | — |
| 47 | Marketing › WhatsApp nudge | **BROKEN (stub)** | `marketing/page.tsx` | `marketing.service.ts:132` → `marketing-channel.service.ts:37-57` | Send is a stub that returns success; the "ordered since" check sees only the newest 50 orders | S | L |
| 48 | Marketing › Broadcast create / approve / reject | LIVE [JSON] | `marketing/page.tsx` | `marketing.service.ts:490-575` | No RBAC (H1) | S | S |
| 49 | Marketing › Broadcast dispatch | **BROKEN (stub)** | `marketing/page.tsx` | `marketing.service.ts:576` → `campaign.service.ts:312` | Stub sends plus fabricated results (H6, H8) | S | L |
| 50 | Marketing › Kill switch | PARTIAL | `marketing/page.tsx` | `campaign.service.ts:29-39` | In-memory per process; resets on restart | S | S |
| 51 | Marketing › Audiences / members | LIVE [JSON] | `marketing/page.tsx` | `marketing.service.ts:328-456` | | R | — |
| 52 | Marketing › Attribution report | PARTIAL | `marketing/page.tsx` | `marketing.service.ts:597` | Built on seeded and fabricated attributions | S | M |
| 53 | Analytics › Financial KPIs | PARTIAL | `analytics/page.tsx` | `analytics.service.ts:132-231` | GMV/COGS computed from all orders; COGS assumes 42% when cost is missing; `period_change_pct: 12.8` literal (`:228`) | R | S |
| 54 | Analytics › Revenue / margin chart | PARTIAL | `analytics/page.tsx` | `analytics.service.ts:704-708` | Empty buckets filled with a sine wave; the margin line is always synthetic | R | S |
| 55 | Analytics › Channel attribution | **STATIC (fabricated)** | `analytics/page.tsx` | `analytics.service.ts:446-490, 532` | ৳425,600 / 198 baseline orders added to real tallies. Runtime: with 0 orders today, the API returned 198 orders / ৳425,600 | R | S |
| 56 | Analytics › RTO geography (64 districts) | PARTIAL | `analytics/page.tsx` | `analytics.service.ts:261` | Real orders blended with `BD_64_DISTRICTS` base counts | S | S |
| 57 | Analytics › Executive digests | PARTIAL | `analytics/page.tsx` | `analytics.service.ts:562` | Built from rows 53-56; get-by-id has an IDOR (H14) | S | S |
| 58 | Intelligence › Overview | **BROKEN (timeout)** | `intelligence/page.tsx` | `api/v1/intelligence/overview/route.ts` | Runtime: >120 s, aborted; each call runs per-row persists (H7) | R | M |
| 59 | Intelligence › Insights (anomalies / opportunities / risks) | **BROKEN (timeout)** | `intelligence/insights/page.tsx` | `opportunity-detector.service.ts`, `risk-detector.service.ts` | Runtime: opportunities took 405 s, risks >120 s; duplicate rows appended on every view | R | M |
| 60 | Intelligence › Recommendations + propose decision | PARTIAL | `intelligence/recommendations/page.tsx:23,41` | `decision.service.ts:21` | Recommendation lookup isn't tenant-scoped | S | S |
| 61 | Intelligence › Forecasts | PARTIAL | `intelligence/forecasts/page.tsx:20` | `forecasting.service.ts` | Newest 50 orders only | S | S |
| 62 | Intelligence › Simulation | PARTIAL | `intelligence/simulation/page.tsx` | `simulation.service.ts` | Formula-based simulation over truncated data | S | S |
| 63 | Intelligence › Cohorts / RFM / NL query | PARTIAL | `intelligence/analytics/page.tsx` | `customer-intelligence.service.ts:11-121`, `nl-analytics.service.ts` | Runtime: RFM took 79 s and scored exactly 50 of 10,001 customers; "NL" is keyword matching | R | M |
| 64 | Operations › Overview (twin / budget / providers) | PARTIAL | `operations/page.tsx` | `operational-twin.service.ts` | Twin computed on newest 50 orders; provider health is seeded | R | S |
| 65 | Operations › Workflow runner | PARTIAL | `operations/workflows/page.tsx:147-165` | `api/v1/operations/tasks` → `operations-workflow.service.ts:66` | The 11-step progress is a `setTimeout` animation; the backend call is real and budget-gated | S | S |
| 66 | Operations › Exceptions list / resolve | LIVE [JSON] | `operations/exceptions/page.tsx:47,75` | `exception-management.service.ts:81,113` | Update isn't tenant-scoped in the db layer | R | S |
| 67 | Operations › Autonomy budget & kill switch | LIVE [JSON] | `operations/autonomy/page.tsx` | `operational-budget.service.ts:57-66,120` | The one kill switch that is actually enforced | R | — |
| 68 | Operations › Receipts | LIVE [JSON] | `operations/receipts/page.tsx:31` | `db.getActionReceipts` | | S | — |
| 69 | Enterprise › Overview | PARTIAL | `enterprise/page.tsx` | `enterprise-operations.service.ts` | Seeded `org_default`; `organization_id` taken from the query string | R | M |
| 70 | Enterprise › Hierarchy | LIVE [JSON] | `enterprise/hierarchy/page.tsx` | `enterprise-hierarchy.service.ts` | Seeded fixtures | R | — |
| 71 | Enterprise › Analytics / metrics | PARTIAL | `enterprise/analytics/page.tsx` | `enterprise-analytics.service.ts`, `semantic-metrics.service.ts` | 50-row truncation | R | S |
| 72 | Enterprise › Benchmarks | PARTIAL | `enterprise/benchmarks/page.tsx` | `enterprise-benchmarking.service.ts:26` | 50-row truncation | R | S |
| 73 | Enterprise › Governance / data quality / AI governance | PARTIAL | `enterprise/governance/page.tsx` | `data-governance.service.ts` etc. | Seeded records | R | M |
| 74 | Enterprise › Integrations test / sync | STATIC | `enterprise/integrations/page.tsx` | `integration-hub.service.ts:116-128` | Always "Successfully connected" with random latency; lookup isn't tenant-scoped | S | L |
| 75 | Enterprise › Developer API keys | DEAD | `enterprise/developer/page.tsx` | `developer-platform.service.ts:89` | Keys can be minted, but `authenticateApiKey` is never called, so no API accepts them | S | M |
| 76 | Enterprise › Outbound webhooks | STATIC | `enterprise/developer/page.tsx` | `webhook-platform.service.ts:85` | "Simulated HTTP delivery (succeeds unless URL contains 'fail')" | S | M |
| 77 | Autonomous › Overview | STATIC | `autonomous/page.tsx` | `autonomous-control-plane.service.ts:20-67` | Counts of seeded in-memory records | R | M |
| 78 | Autonomous › "Run daily cycle" | **BROKEN (404)** | `autonomous/page.tsx:92-98` | `/api/v1/ai/tools/execute` (no such route) | Runtime 404, yet the page alerts "executed successfully" | R | S |
| 79 | Autonomous › Pause / resume | **BROKEN (no effect)** | `autonomous/page.tsx` | `autonomous-control-plane.service.ts:111,163` | `EMERGENCY_HALTED` is never read; not persisted (H11, C7) | S | M |
| 80 | Autonomous › Decisions approve / reject | **BROKEN (no effect)** | `autonomous/decisions/page.tsx` | `global-decision-engine.service.ts:148-161` | In-memory status flip; not persisted, not executed; `approved_by` from body | S | M |
| 81 | Autonomous › Objectives + simulate | PARTIAL | `autonomous/objectives/page.tsx` | `business-objectives.service.ts:45` | `db.data.push` without persist, so lost on restart | S | S |
| 82 | Autonomous › Health | PARTIAL | `autonomous/health/page.tsx` | `platform-health.service.ts` | Seeded health records | R | M |
| 83 | Autonomous › Learning | STATIC | `autonomous/learning/page.tsx` | `continuous-learning.service.ts` | Seeded, in-memory | R | M |
| 84 | Autonomous › Governance | **BROKEN (404)** | `autonomous/governance/page.tsx:60` | `/api/v1/ai/tools/execute` | Pause/resume same as row 79 | R | S |
| 85 | Autonomous › Agents | STATIC | `autonomous/agents/page.tsx:29` | none | Hard-coded `PHASE_10_AGENTS` array | S | M |
| 86 | AI Agents › Overview, runs | LIVE [JSON] | `agents/page.tsx` | `ai/overview`, `ai/runs` | Run contents come from the mock LLM | R | — |
| 87 | AI Agents › Agent definitions & policies | LIVE [JSON] | `agents/page.tsx` | `ai/agents`, `ai/policies` | | R | — |
| 88 | AI Agents › Simulator / test chat | STATIC/DEMO | `agents/page.tsx` → `/ai/simulate` | `mock-llm.provider.ts` | Keyword rules, not an LLM | S | L |
| 89 | AI Agents › Knowledge base | PARTIAL | `agents/page.tsx:394-413, 440-490` | `knowledge.service.ts:55-146` | TXT/MD/CSV/JSON work. PDF/DOCX are read with `readAsText` + regex, which produces garbage. Embeddings are mock; Pinecone isn't configured, so storage is local; progress steps are `setTimeout` | S | M |
| 90 | AI Agents › Evaluations | PARTIAL | `agents/page.tsx` | `evaluation.service.ts` | Golden dataset run against the mock LLM | S | M |
| 91 | `/ai/agents` › Orchestration registry | PARTIAL | `ai/agents/page.tsx` (not linked from any nav) | `autonomy-policy.service.ts:37-44` | Runtime: first load took 100.9 s (68 whole-file persists) | R | S |
| 92 | `/ai/approvals` › Approve / reject | LIVE [JSON] | `ai/approvals/page.tsx` | `approval-engine.ts:25,115` | Lookup isn't tenant-scoped: cross-tenant approvals possible (H14) | S | S |
| 93 | `/ai/workflows` (+ detail) | PARTIAL | `ai/workflows/page.tsx` | `task-executor.ts:243-262` | Deterministic tasks run as a synthetic OWNER (M12) | S | M |
| 94 | Automations › CRUD / toggle / test | LIVE [JSON] | `automations/page.tsx` | `automation-registry.service.ts` | RBAC present | R | — |
| 95 | Automations › Templates install | LIVE [JSON] | `automations/page.tsx` | `automation/templates/[id]/install` | | R | — |
| 96 | Automations › Executions / DLQ retry | LIVE [JSON] | `automations/page.tsx` | `dead-letter.service.ts` | | R | — |
| 97 | Automations › n8n dispatch | PARTIAL | n/a | `n8n-provider.service.ts:209` | Any `localhost` or `example.com` base URL is mocked, so the documented local Docker n8n is never called. Remote URLs make a real `fetch` | S | S |
| 98 | Automations › Provider health / circuit breakers | LIVE [JSON] | `automations/page.tsx` | `provider-circuit-breaker.service.ts` | | R | — |
| 99 | Connectors › Catalog + save credentials | LIVE [JSON] | `connector/page.tsx` | `connectors/service.ts` | Credentials are encrypted with a key derived from the public JWT default (M15) | R | S |
| 100 | Connectors › Test connection | STATIC | `connector/page.tsx` | `connectors/service.ts:1491-1502` (+1530-1690) | Runtime: a fake OpenAI key returned "Successfully connected… verified" | R | M |
| 101 | Connectors › Advertised webhook URLs | **BROKEN (404)** | `connector/page.tsx` | `connectors/service.ts:319,434,474,510,538,1184` | `/shipments/webhooks/{steadfast,pathao,redx}`, `/social/webhooks/{meta,telegram}`, `/enterprise/webhooks/shopify`: runtime 404 | R | S |
| 102 | Settings › Workspace (delivery fees) | LIVE [JSON] | `settings/page.tsx:99` | `tenants/current/settings` → `pricing.service.ts:41-44` | Fees are used by pricing | R | — |
| 103 | Settings › Team role / status | LIVE [JSON] | `settings/page.tsx:157,176` | `users/[id]` | | R | — |
| 104 | Settings › Invite user | PARTIAL | `settings/page.tsx:134` | `invitations/service.ts:28` | Invite is created, but no email is sent and there is no accept page (`/invitations/[token]` has no UI); token uses `Math.random` | S | M |
| 105 | Settings › Audit log | LIVE [JSON] | `settings/page.tsx:56` | `api/v1/audit` | | R | — |
| 106 | `/users` | LIVE | `users/page.tsx` | none | Redirects to `/settings#users`; not linked anywhere | S | — |
| 107 | Super Admin › All data tabs | PARTIAL | `super-admin/page.tsx:161…` (11 header sites) | `platform/*` routes | Reads work only because every request carries `x-test-platform-role: SUPER_ADMIN` (C3); there is no login page | R | M |
| 108 | Super Admin › Headline stat fallbacks | STATIC | `super-admin/page.tsx:742-930,1017` | none | `?? 4999`, `?? 2450000`, `?? 18420`, `94.2%`, `99.8%`, "99.9% Uptime", "100% MFA" | S | S |
| 109 | Super Admin › Step-up MFA | **BROKEN (401)** | `super-admin/page.tsx:439` | `platform/auth/step-up/route.ts:9-17` | UI sends `mfaCode`, the route reads `code`/`password`: runtime 401. The server accepts any 6 characters (H10) | R | S |
| 110 | Super Admin › Suspend / activate tenant | LIVE [JSON] | `super-admin/page.tsx` | `platform-tenant.service.ts` | Suspension is enforced in `auth/service.ts:208` | S | — |
| 111 | Super Admin › Start impersonation | DEAD | `super-admin/page.tsx` | `platform-support.service.ts:32-115` | A token is minted, but `verifyImpersonationToken` (`security.ts:269`) is never called, so it can't be used | S | M |
| 112 | Super Admin › Revoke impersonation | **BROKEN (404)** | `super-admin/page.tsx:345` | Route is `DELETE /platform/support/impersonate?sessionId=` | UI calls `POST …/{id}/revoke`: runtime 404 | R | S |
| 113 | Super Admin › Create kill switch | **BROKEN (no effect)** | `super-admin/page.tsx` | `platform-safety.service.ts` | Stored but never checked; `KillSwitchActiveError` (`errors.ts:146`) is never thrown | S | M |
| 114 | Super Admin › Deactivate kill switch | **BROKEN (404)** | `super-admin/page.tsx:390` | none | Runtime 404 | R | S |
| 115 | Super Admin › Feature flags / entitlements / plans | PARTIAL | `super-admin/page.tsx` | `platform-feature-flag.service.ts`, `platform-entitlement.service.ts` | CRUD works but nothing enforces them | S | M |
| 116 | Infra › `/health` | STATIC | none | `app/health/route.ts` | Always "healthy" | R | S |
| 117 | Infra › `/health/ready` | STATIC | none | `app/health/ready/route.ts:7` | Always "database: connected"; never checks Neon | R | S |
| 118 | Infra › Neon repositories (11 classes) | DEAD | none | `src/infrastructure/db/repositories.ts`, `src/domains/**/**.repository.ts` | Only tests import them; 12 `tsc` errors live in them | S | L |
| 119 | Infra › Upstash Redis | DEAD | none | `src/infrastructure/redis/client.ts` | Not configured; only `jev-client.ts` imports it | S | M |
| 120 | Infra › Pinecone | DEAD (unconfigured) | none | `src/infrastructure/pinecone/client.ts:92` | `PINECONE_API_KEY` is unset, so the local fallback is used | S | M |
| 121 | Infra › TypeSafe/Jev decision API | PARTIAL | none | `jev-client.ts:140` | The only real AI call; falls back to mock on failure; reachability UNVERIFIED | S | — |
| 122 | Component › `ModulePlaceholder.tsx` | DEAD | `components/bento/ModulePlaceholder.tsx` | none | Never imported | S | S |

**Totals:** LIVE 41 · PARTIAL 38 · STATIC 22 · BROKEN 15 · DEAD 6 (122 total). **LIVE ratio: 33.6%**, and all of it runs on the local JSON file.

### 2b. Endpoint table (runtime results)

**Runtime GET sweep of every GET URL the UI calls (96 URLs):**
- 90 returned 200 in under 6 s. Most of that time was dev-mode first compile; the same routes answer in 17-80 ms when warm.
- 2 returned 200 but took over 60 s:
  - `/api/v1/intelligence/customers`: 79.1 s
  - `/api/v1/ai/agents?view=orchestration`: 100.9 s
- 1 returned 200 after 47.9 s: `/api/v1/inventory`, blocked behind the opportunities request (the server itself logged 2.2 s).
- 3 timed out at 120 s:
  - `/api/v1/intelligence/overview`
  - `/api/v1/intelligence/opportunities` (the server finished after **405.6 s**)
  - `/api/v1/intelligence/risks`

**Client calls that don't match the server:**

| Method + path the client calls | Called from | Server reality | Result |
|---|---|---|---|
| POST `/api/v1/ai/tools/execute` | `autonomous/page.tsx:92`, `autonomous/governance/page.tsx:60` | No route | 404 (R) |
| POST `/api/v1/platform/safety/kill-switch/{id}/deactivate` | `super-admin/page.tsx:390` | No route | 404 (R) |
| POST `/api/v1/platform/support/impersonate/{id}/revoke` | `super-admin/page.tsx:345` | Actual route is `DELETE ?sessionId=` | 404 (R) |
| POST `/api/v1/platform/auth/step-up` with `{mfaCode}` | `super-admin/page.tsx:439` | Reads `body.code` / `body.password` | 401 (R) |
| `/api/v1/shipments/webhooks/{steadfast,pathao,redx}` | shown to users by `connectors/service.ts:474,510,538` | No route | 404 (R) |
| `/api/v1/social/webhooks/{meta,telegram}` | `connectors/service.ts:319,434` | No route | 404 (R) |
| `/api/v1/enterprise/webhooks/shopify` | `connectors/service.ts:1184` | No route | 404 (S) |
| `/api/v1/enterprise/reports/{id}/download` | `enterprise-reporting.service.ts:82` | No route | 404 (S) |
| Page link `/payments` | `(dashboard)/page.tsx:312` | No page | 404 (S) |

**Orphaned endpoints: 70 of 236 route files have no UI caller.** Of these, 5 are legitimate external ingress (`social/webhooks/{facebook,instagram,website}`, `social/widget/{config,session}`) and 7 are server-to-server callbacks for n8n (`automation/actions/*`, `automation/events`, `automation/failures`, `automation/workflows`). The **58 that are genuinely missing a UI** are:

- **Payments / refunds / returns:** `/payments`, `/payments/verify`, `/refunds`, `/returns`. There is no Payments or Returns screen at all.
- **Catalog admin:** `/brands`, `/categories`, `/coupons`. There is no UI to manage categories, brands or coupons.
- **Platform auth:** `/platform/auth/login`, `/platform/auth/logout`, `/platform/auth/session`. There is no super-admin login UI; see C3.
- **Invitations:** `/invitations/[token]`. There is no accept-invite page.
- **Operations:**
  - `/operations/actions`
  - `/operations/actions/[id]/approve`
  - `/operations/actions/[id]/simulate`
  - `/operations/digital-twin`
  - `/operations/finance`
  - `/operations/fulfillment`
  - `/operations/inventory`
  - `/operations/payments`
  - `/operations/pricing`
  - `/operations/procurement`
  - `/operations/sla`
- **Growth:**
  - `/growth/audiences/[id]`
  - `/growth/campaigns/[id]`
  - `/growth/campaigns/[id]/reject`
  - `/growth/campaigns/[id]/schedule`
  - `/growth/content/generate`
  - `/growth/content/verify`
  - `/growth/insights`
  - `/growth/journeys/[id]`
  - `/growth/journeys/[id]/pause`
  - `/growth/journeys/[id]/resume`
  - `/growth/lifecycle/[customerId]`
  - `/growth/offers`
  - `/growth/preferences/[customerId]`
  - `/growth/recommendations`
- **Intelligence:** `/intelligence/data-quality`, `/intelligence/metrics`, `/intelligence/models`, `/intelligence/query`.
- **AI:** `/ai/agents/[id]`, `/ai/feedback`, `/ai/runs/[id]`, `/ai/usage`.
- **Autonomous:** `/autonomous/cost`, `/autonomous/decisions/[id]`, `/autonomous/objectives/[id]`, `/autonomous/strategies`.
- **Enterprise:** `/enterprise/data-lineage`, `/enterprise/incidents`, `/enterprise/reports`.
- **Other:**
  - `/analytics/digests/[id]`
  - `/automations/[id]`
  - `/marketing/broadcasts/[id]/simulate`
  - `/social/business-hours`
  - `/social/channels/[id]`
  - `/social/customers/[id]/identities`
  - `/social/leads/[id]`

**Orphaned UI:**
- `components/bento/ModulePlaceholder.tsx` is never imported.
- `/ai/agents` and `/users` aren't linked from any navigation.
- `/ai` duplicates `/agents` (re-export).

### 2c. "Looks done but isn't" (highest-value list)

1. **The super-admin console has no login.** It "works" because the page sends `x-test-platform-role: SUPER_ADMIN` on every request (`super-admin/page.tsx:161` and 10 more). Anyone who can reach `/super-admin` is super-admin in any environment.
2. **"Sent ✓" customer replies, WhatsApp cart nudges and broadcasts are never delivered.** Every adapter returns a mock message ID.
3. **"Book courier" never talks to a courier.** Tracking numbers are invented.
4. **"Verify payment" never talks to bKash/Nagad**, and read-only roles can call it.
5. **"Test connection" says "Successfully connected to OpenAI … verified" for any fake key** (runtime proven). Enterprise integrations and outbound webhooks are also simulated.
6. **All "AI" (copilot, agents, simulator, evaluations) is a keyword-matching mock.** Embeddings are fake, and "Storing in Vector DB" is a `setTimeout`.
7. **Analytics revenue by channel includes ৳425,600 / 198 hard-coded orders.** "Period change 12.8%" and the margin trend line are constants or sine waves.
8. **Intelligence, Growth, Operations and Enterprise analytics use only the newest 50 orders / 50 customers** because of a silent default page size.
9. **The Command Center's trends, attention items, agent stream, recent orders, ops box and revenue chart are hard-coded**, and the KPIs fall back to fake values when the real number is 0.
10. **Kill switches, feature flags, entitlements and the autonomous "Emergency Halt" are stored and displayed but enforced nowhere.** The only enforced one is the Operations budget kill switch.
11. **"Run Daily Autonomous Cycle" returns 404 but alerts success.**
12. **Step-up MFA can't succeed from the UI** (contract mismatch), but the server accepts any 6 characters.
13. **Impersonation issues a token that nothing accepts; revoke is a 404.** Developer API keys authenticate nothing.
14. **"Neon PostgreSQL / Pinecone / Upstash" infrastructure is dead code.** `/health/ready` reports "database: connected" unconditionally.
15. **The project's tests report 297/297 passing** (runtime, 45 s). They run with persistence disabled, call services directly (so they skip HTTP auth), and none assert the backdoors.

---

## 3. Findings Table

| ID | Severity | Status | Category | Location | One-line summary |
|---|---|---|---|---|---|
| C1 | CRITICAL | PROVEN (R) | Auth (CWE-798/287) | `src/lib/security.ts:25-39` | Hard-coded master passwords and pass-the-hash authenticate any user |
| C2 | CRITICAL | PROVEN (R) | Auth / crypto (CWE-321/798) | `src/lib/security.ts:5,9`; `.env.example:7` | Live JWT secret equals the public default, so any tenant or platform session can be forged |
| C3 | CRITICAL | PROVEN (R) [BROKEN] | Broken access control (A01) | `src/lib/api-response.ts:213-245`; `super-admin/page.tsx:161…` | `x-test-platform-role` header grants any platform role in all environments; the UI depends on it |
| C4 | CRITICAL | PROVEN (R) | Webhook auth (CWE-345/347) | `webhook-gateway.service.ts:39-46,144-146`; `db/index.ts:2414-2447`; `automation/webhooks/[provider]/route.ts:15-30` | Unsigned courier/payment webhooks mark shipments DELIVERED and COD PAID |
| C5 | CRITICAL | PROVEN | Secrets (CWE-798/312) | `.env.example:11-12`; no `.gitignore` | Live Neon owner credential committed in the example file; `.data` with PII has no ignore rules |
| C6 | CRITICAL | PROVEN (R) | Performance / availability | `db/index.ts:1041-1073` | Whole 39 MB store serialized and written synchronously on every mutation, freezing the whole server |
| C7 | CRITICAL | PROVEN (code + artifacts); impact SUSPECTED | Reliability / data loss | `db/index.ts:1064-1066`; `.data/*.tmp.*`; `autonomous/services/*` | Persist errors swallowed; failed writes left 5 × 37-39 MB temp files; per-process state loses writes on multi-replica; some services never persist |
| C8 | CRITICAL | PROVEN (code) — *addendum* | Auth (CWE-287) | `src/app/api/v1/platform/auth/login/route.ts:33-37` | Platform login accepts any password for any platform operator, because every bcrypt hash starts with `$2a$10$` |
| H1 | HIGH | PROVEN (R in dev) | Auth fallback | `api-response.ts:93-137, 247-270` | Missing **or invalid** token becomes OWNER (tenant) and SUPER_ADMIN (platform) whenever `NODE_ENV` isn't production/test |
| H2 | HIGH | PROVEN | Broken access control (A01) | ~100 routes under `growth/`, `marketing/`, `operations/`, `enterprise/`, `autonomous/`, `intelligence/` | No permission checks; approver identity taken from the request body |
| H3 | HIGH | PROVEN | Business logic / authz | `payment.service.ts:93-115` | `payments.read` (ANALYST/FINANCE/DEV) can mark any order PAID with any TrxID, unverified and reusable |
| H4 | HIGH | PROVEN | Mass assignment (CWE-915) / tenant isolation | `product.service.ts:175`→`db/index.ts:4217`; `customer.service.ts:161`→`db/index.ts:4577` | PATCH spreads the raw body, so `tenant_id` and `id` can be overwritten |
| H5 | HIGH | PROVEN | Webhook auth / tenant isolation | `webhook-ingress.service.ts:61-86`; `facebook.adapter.ts:21`; `facebook/route.ts:13` | Unsigned social messages accepted; unmatched pages routed to another tenant; hard-coded fallback secrets |
| H6 | HIGH | PROVEN (R) | Correctness | `db/index.ts:4545, 4644` (+46 call sites) | Default `limit: 50` silently truncates analytics to 1% of orders and 0.5% of customers |
| H7 | HIGH | PROVEN (R) | Correctness / integrity | `analytics.service.ts:228,446-490,532,704-708,261`; `campaign.service.ts:402-406`; `(dashboard)/page.tsx:132-136` | Fabricated numbers presented as real business metrics |
| H8 | HIGH | PROVEN (R) | Performance | `customer-intelligence.service.ts:116`, `product-intelligence.service.ts:95`, `inventory-intelligence.service.ts:92`, `autonomy-policy.service.ts:41`, `db/index.ts:6494-6550` | GET endpoints do one whole-file persist per row and append non-deduplicated rows: 79 / 101 / 405 s |
| H9 | HIGH | PROVEN | Integration integrity | `social/channels/adapters/*.ts`, `marketing-channel.service.ts:37-118`, `shipping.service.ts:97`, `connectors/service.ts:1464-1700` | External effects are stubbed but reported as successful |
| H10 | HIGH | PROVEN (R) | Auth (CWE-308) | `platform/auth/step-up/route.ts:13-17`; `security.ts:148`; `auth/login/route.ts:39` | Step-up MFA accepts any 6 characters; platform sessions default to `mfaVerified=true` |
| H11 | HIGH | PROVEN | Safety controls | `errors.ts:146`; `autonomous-control-plane.service.ts:111,163`; platform flags/entitlements | Kill switches, flags, entitlements and emergency halt are never enforced |
| H12 | HIGH | PROVEN | Correctness / inventory integrity | `shipping.service.ts:120,176`; `courier-sync.service.ts:162-171` | Delivery bypasses the order state machine and never commits reservations; CANCELLED orders can become DELIVERED/PAID |
| H13 | HIGH | PROVEN | IDOR (CWE-639) | `analytics.service.ts:556`→`db/index.ts:6964`; `approval-engine.ts:25,115`; `decision.service.ts:21,124`; `integration-hub.service.ts:117` | Lookups by ID alone allow cross-tenant read, approve and test |
| H14 | HIGH | PROVEN | AI integrity | `model-router.ts:43-44`; `mock-llm.provider.ts` | All LLM output is a keyword mock; embeddings are fake |
| H15 | HIGH | SUSPECTED (high confidence) | Build / deployability | `domains/customers/customer.repository.ts`, `domains/social/social.repository.ts` | `tsc` reports 12 errors in files `next build` type-checks, so the production build likely fails |
| M1 | MEDIUM | PROVEN (R) [BROKEN] | Wiring | 9 client call sites (§2b) | UI calls endpoints or contracts that don't exist; one shows a false success alert |
| M2 | MEDIUM | PROVEN | Inventory integrity | `db/index.ts:4447` | Reservations get `expires_at` but nothing ever expires them, so stock leaks |
| M3 | MEDIUM | PROVEN (code); SUSPECTED occurrence | Concurrency | `order.service.ts:103-110`; `db/index.ts:4602` | Order number computed as count+1 before awaits, so concurrent creates can duplicate it |
| M4 | MEDIUM | PROVEN | Crypto (CWE-338) | `security.ts:68-74`; `invitations/service.ts:28` | Invitation tokens and all IDs come from `Math.random` |
| M5 | MEDIUM | PROVEN | Data integrity | `orders/page.tsx:165-166` | Every outside-Dhaka order is stored as Chittagong |
| M6 | MEDIUM | PROVEN | Logic | `growth/audiences/page.tsx:78` | All 4 audience presets create the same rule |
| M7 | MEDIUM | PROVEN | Correctness / perf | `campaign.service.ts:352,361` | O(R×C) lookup; recipients outside the newest 50 customers are silently suppressed |
| M8 | MEDIUM | PROVEN (code) [DEAD path] | Data integrity | `neon/client.ts:111,144-156` | `withTransaction` re-runs a rolled-back transaction non-atomically; `execute().rowCount` is wrong |
| M9 | MEDIUM | PROVEN | Session management | `auth/logout/route.ts:9-18`; `security.ts:97` | Logout leaves the 8 h platform cookie; 7-day JWTs can't be revoked |
| M10 | MEDIUM | PROVEN | Authz | `auth/service.ts:136-151, 216-231` | Any active platform member (even support) becomes OWNER of tenant[0] or the token's tenant |
| M11 | MEDIUM | PROVEN | Tenant isolation | `db/index.ts:4156,4191`; `tenants/service.ts:23-51` | New tenants have no warehouse, so their inventory rows point at another tenant's warehouse |
| M12 | MEDIUM | PROVEN | Privilege escalation | `task-executor.ts:243-262` | AI workflow tasks execute as a synthetic OWNER |
| M13 | MEDIUM | PROVEN | Abuse / DoS | whole API | No rate limiting on login, register, widget or webhooks (Upstash dependency unused) |
| M14 | MEDIUM | PROVEN | Crypto (CWE-321) | `security.ts:9` | Connector credential encryption key = SHA-256(public default JWT secret) |
| M15 | MEDIUM | PROVEN | PII integrity | `identity-resolution.service.ts:124` | Social customers get random real-looking `+8801700xxxxxx` phone numbers |
| M16 | MEDIUM | PROVEN | Functional | `agents/page.tsx:394-413` | PDF/DOCX "parsing" via `readAsText` + regex indexes garbage |
| M17 | MEDIUM | SUSPECTED | SSRF (CWE-918) | `n8n-provider.service.ts:201-224` | Server POSTs to a platform-configurable `base_url`; reachable unauthenticated via C3 |
| L1 | LOW | PROVEN | Info leak (CWE-209) | `api-response.ts:59-70` | Raw internal error messages returned on 500 |
| L2 | LOW | PROVEN | API hygiene | growth, autonomous and intelligence services | `throw new Error("… not found")` returns 500 instead of 404 |
| L3 | LOW | PROVEN (R) | Observability | `app/health/ready/route.ts:7` | Readiness probe always reports ready and never checks a real DB |
| L4 | LOW | PROVEN | Integrity | `aud_${Date.now()}` in many services | Audit/event IDs collide within the same millisecond |
| L5 | LOW | PROVEN [DEAD] | Injection (CWE-89) | `base-repository.ts:151-187` | Column and table names interpolated; latent SQLi if ever fed request keys |
| L6 | LOW | PROVEN | Integrity | `procurement.service.ts:121`; `bulk-import.service.ts:324`; `products/page.tsx:76` | 4-digit random PO/SKU suffixes collide (birthday bound ≈ 100 items) |
| L7 | LOW | PROVEN | UX / functional | `conversations/page.tsx` | No polling or realtime, but the copy promises "real time" |
| L8 | LOW | PROVEN | Hardening | `next.config.js` | No security headers or CSP |
| I1 | INFO | PROVEN (R) | Tests | `tests/*` | 297/297 pass but cover none of the above risky paths |
| I2 | INFO | PROVEN | Docs | `SYSTEM_AUDIT_REPORT.md`, `.agent/PROJECT_STATE.md` | Claim "production-grade / fully operational", contradicted by this audit |

---

## 4. Detailed Findings

### C1: Master passwords and pass-the-hash authenticate any account
**CRITICAL | [PROVEN] | CWE-798, CWE-287**

- **Location:** `src/lib/security.ts:25-39`
- **What's wrong:** `verifyPassword` returns `true` without calling bcrypt in any of these cases:
  - the password is `"CommerceOS2026!"` or `"Password123!"`;
  - the password equals the stored hash;
  - the stored hash starts with `$2a$10$iM.oG9E` or contains `"default"`.
- **Impact / exploit:** anyone who knows or guesses an email logs in as that user in any tenant. That includes `superadmin@commerceos.io`, whose login also mints a platform cookie (`auth/login/route.ts:31-50`). The string `Password123!` is also accepted as a step-up credential.
- **Reproduction (runtime):**
  1. Register a new user with the password `Unique-Audit-Pw-7731!`.
  2. `POST /api/v1/auth/login` with the same email and `{"password":"Password123!"}` returns **200 with a session**.
  3. The same email with a wrong password returns 401, so the bypass is specific to the master strings.
- **Fix:**

```ts
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try { return await bcrypt.compare(password, hash); } catch { return false; }
}
```

  Then re-hash the seeded accounts with real passwords, set in `db/index.ts:1117,1152…`. Some tests in `tests/run-tests.ts`, `tests/orchestration-tests.ts` and `tests/jev-system-one-tests.ts` rely on `Password123!` and will need updating.

### C2: Session JWT secret is the public default, so tokens can be forged
**CRITICAL | [PROVEN] | CWE-321, CWE-798**

- **Location:** `src/lib/security.ts:5` (hard-coded fallback); `.env.example:7`. The value in `.env.local` equals both; verified by equality check without printing the secret.
- **What's wrong:**
  - Every token type (tenant session, platform session, step-up, impersonation) is HS256 with the same key.
  - `verifySessionToken` doesn't check `scope`, `aud` or `iss`.
  - The credential-encryption key is derived from the same secret (`:9`).
- **Impact / exploit:** mint `{userId, tenantId}` for any tenant, or `{platformRole:"SUPER_ADMIN", scope:"PLATFORM"}`, and you have full control. This works even with `NODE_ENV=production`.
- **Reproduction (runtime):**
  - A forged tenant JWT for `usr_platform_support_01` returned that identity from `/api/v1/auth/session`. This is not the dev-fallback user, so the forged token itself was accepted.
  - A forged PLATFORM JWT for tenant owner `admin@commerceos.io` returned `role: SUPER_ADMIN` from `/api/v1/platform/auth/session`.
- **Fix:** fail closed at boot, and use per-purpose keys and audiences.

```ts
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.startsWith("commerceos_super_secret"))
  throw new Error("JWT_SECRET must be a unique random value (>=32 bytes)");
// sign: .setAudience("tenant") / "platform" / "step-up" / "impersonation"
// verify: jwtVerify(token, key, { algorithms: ["HS256"], audience: "tenant" })
```

  Move credential encryption to its own `ENCRYPTION_KEY`. Rotating either key invalidates all sessions and all stored connector credentials, so plan a re-encrypt step.

### C3: `x-test-platform-role` header is a platform auth bypass in every environment
**CRITICAL | [PROVEN] | OWASP A01, CWE-288**

- **Location:** `src/lib/api-response.ts:213-245`; `src/app/super-admin/page.tsx:161, 232, 261, 283, 301` (11 occurrences)
- **What's wrong:**
  - With no platform token, any request carrying `x-test-platform-role: <ROLE>` gets that role's full permissions. There is no `NODE_ENV` guard.
  - `stepUpVerified` is true for any `x-step-up-token` longer than 5 characters (`:227`).
  - The super-admin UI has no login page and relies on this header for every call. `/api/v1/platform/auth/login` exists but nothing calls it.
- **Impact / exploit:** an unauthenticated internet user can list, suspend and archive tenants, start impersonation, and edit plans, flags, settings and the n8n fleet. In production, simply visiting `/super-admin` does this.
- **Reproduction (runtime):** `GET /api/v1/platform/auth/session` with `x-test-platform-role: PLATFORM_ANALYST` and `x-step-up-token: aaaaaa` returns role `PLATFORM_ANALYST` with `stepUpVerified: true`. The header overrides the environment fallback.
- **Fix:**
  - Delete the block at `:212-245`, or guard it with `if (process.env.NODE_ENV === "test")` AND a test-only flag.
  - Remove the header from `super-admin/page.tsx`.
  - Add a `/super-admin/login` page that uses `POST /api/v1/platform/auth/login` and the `httpOnly` cookie.

### C4: Courier/payment webhooks accept unsigned requests
**CRITICAL | [PROVEN] | CWE-345, CWE-347**

- **Location:**
  - `src/app/api/v1/automation/webhooks/[provider]/route.ts:15-30`: tenant taken from the `x-tenant-id` header or `?tenant_id=` query parameter.
  - `webhook-gateway.service.ts:144-146`: signature checking is skipped if `signature_algorithm === "TOKEN"` **or** any `Authorization: Bearer …` header is present, and the token is never compared.
  - `:39-46`: missing env secrets fall back to the predictable `sec_wh_<ref>`.
  - `db/index.ts:2414-2447`: all 4 seeded webhooks (Steadfast, Pathao, bKash, Nagad) use `"TOKEN"`.
  - `courier-sync.service.ts:162-171`: a DELIVERED status sets the order to DELIVERED and COD payments to PAID.
- **Impact / exploit:** an anonymous POST of `{"tracking_number":"TRK-STE-<8 digits>","status":"delivered"}` marks a shipment delivered and the order paid. Tracking numbers are `TRK-<3 letters>-<last 8 digits of Date.now()>`, so they're enumerable. Result: revenue falsification, and inventory is never decremented (H12).
- **Reproduction (runtime):** `POST /api/v1/automation/webhooks/steadfast?tenant_id=ten_default_dhaka` with no signature and no token returned `{"verified":true, … "canonical_status":"DELIVERED"}`. A non-existent tracking number was used, so no data changed.
- **Fix:**
  - Resolve the tenant from the webhook row, e.g. via a per-webhook path secret, never from client input.
  - For TOKEN: `crypto.timingSafeEqual(bearerToken, resolveSecret(ref))`.
  - Delete the `hasAuthToken` bypass.
  - Throw if the env secret is missing.
  - Require a timestamp header for HMAC providers.

### C5: Live database credential committed; no ignore rules
**CRITICAL | [PROVEN] | CWE-798, CWE-312**

- **Location:** `.env.example:11-12` contain the full Neon owner connection string including the password, identical to `.env.local`. There is no `.gitignore`. `.data/commerceos.json` holds 10,001 customer records (names, phones, addresses) and bcrypt hashes.
- **Impact:** anyone who receives the folder (a zip for a reviewer, a future git push) gets read/write access to the Neon DB (55 tables, 10,007 customers).
- **Fix:**
  1. **Rotate the Neon role password now.**
  2. Replace the example values with placeholders.
  3. Add a `.gitignore` covering `.env*` (except `.env.example`), `.data/`, `.next/`, `node_modules/`, `*.tsbuildinfo`, `tests/test-results.json`.

### C6: Whole-file synchronous persistence blocks the server on every write
**CRITICAL (outage at normal load) | [PROVEN]**

- **Location:** `src/infrastructure/db/index.ts:1041-1073`
- **What's wrong:** `persist()` runs `JSON.stringify(this.data, null, 2)` over 39 MB, then `writeSync` + `fsync` + `renameSync`, on the request thread, after **every** mutation. The re-entrancy guard (`isPersisting`) is dead code because the function is synchronous. A single order runs 5 or more persists (one per item reservation, plus the order, coupon, event and audit writes).
- **Measured:**
  - Standalone: parse 1.14 s, stringify 0.20 s, write 0.15 s.
  - In-server: one login (2 persists) took **2.98 s**; 3 concurrent logins took 2.9 / 8.5 / 8.5 s.
  - An unrelated `GET /customers?limit=1` issued 50 ms later took **8.6 s**, versus 82 ms alone.
- **Complexity:** each write is O(S), where S is the total bytes across all tenants. W writes/s costs O(W·S). The throughput ceiling is roughly 1 write per second for the whole platform.
- **Fix:**
  - **Target:** move to the Neon repositories that already exist, giving O(log n) indexed writes and real transactions (after fixing M8).
  - **Interim (S):**

```ts
private timer: NodeJS.Timeout | null = null;
private persist() {                       // coalesce all writes in a 250 ms window
  if (this.isTestInstance || process.env.NODE_ENV === "test" || this.timer) return;
  this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 250);
}
private async flush() {
  const tmp = `${this.filePath}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(this.data));   // no pretty-print (~40% smaller)
  await fs.promises.rename(tmp, this.filePath);                   // errors must be logged/alerted (see C7)
}
```

### C7: Silent data loss and non-durable, per-process state
**CRITICAL | [PROVEN code + artifacts; production impact SUSPECTED]**

- **Location:**
  - `db/index.ts:1064-1066`: `catch { // Memory fallback }` swallows every write error.
  - The constructor `mkdir` also silently ignores errors (`:557-561`).
  - `.data/` holds 5 orphaned `commerceos.json.tmp.<ts>` files of 11-39 MB each, from 2026-09-22 to 09-24. These are failed rename/write attempts; the in-memory state diverged from disk and those writes were lost on restart.
  - All `src/domains/autonomous/services/*` mutate `db.data.*` directly without persisting, for example `business-objectives.service.ts:45` and `autonomous-control-plane.service.ts:111`.
- **Impact:**
  - Read-only filesystems (serverless) lose every write silently.
  - Kubernetes replicas (the documented target) each hold a divergent copy, and the last writer wins the whole file.
  - Restarts drop unpersisted autonomous state.
- **Fix:** let persistence failures fail the request (5xx) and emit metrics; clean up temp files; persist in the autonomous services, or better, migrate to Postgres.

### H1: Dev auth fallback grants OWNER / SUPER_ADMIN for missing or invalid tokens
**HIGH | [PROVEN in dev]**

- **Location:** `api-response.ts:93-137` (tenant) and `:247-270` (platform)
- **What's wrong:** when `NODE_ENV` is neither `production` nor `test` (`.env.local` sets `development`), a request with **no token or a bad/expired token** is treated as the super-admin user acting as OWNER with all permissions, and on platform routes as SUPER_ADMIN with `stepUpVerified: true`.
- **Reproduction (runtime):** `GET /api/v1/auth/session` without a cookie returned 200 as OWNER; `GET /api/v1/orders` with `Bearer garbage` returned 200.
- **Impact:** any staging or demo host started with `next dev`, or with `NODE_ENV` unset in a custom server, is fully open. It also masks auth bugs during development, because pages "work" logged out.
- **Fix:** require an explicit opt-in `DEV_AUTH_BYPASS=1`, never apply it when a token was presented but failed verification, and log loudly.

### H2: No RBAC on ~100 business-critical routes
**HIGH | [PROVEN] | OWASP A01**

- **Location:** every route under `growth/`, `marketing/`, `operations/`, `enterprise/` (except the RBAC service), `autonomous/`, `intelligence/` (listed by the route-level grep). The corresponding `src/domains/{growth,intelligence,operations,autonomous,marketing}` services contain **0** `assertCan` calls.
- **Additional problem:** the approver is taken from the body:
  - `growth/campaigns/[id]/approve/route.ts:12`: `body.approved_by || …`
  - `autonomous/decisions/[id]/approve/route.ts:15`
- **Impact:** a SUPPORT or ANALYST user can approve and execute high-risk broadcasts, flip the Operations kill switch, approve autonomous decisions and resolve exceptions, and can record someone else as the approver (repudiation). The "human approval gate" provides no control.
- **Fix:** add `RbacService.assertCan(context, PERMISSIONS.X)` to each handler, with new permissions such as `GROWTH_MANAGE`, `MARKETING_DISPATCH`, `OPS_AUTONOMY_MANAGE` and `AUTONOMY_APPROVE`. Always use `context.user.id` as the approver. Add a table-driven RBAC test (§6).

### H3: Any role with `payments.read` can mark orders paid
**HIGH | [PROVEN]**

- **Location:** `payment.service.ts:93-115`, route `api/v1/payments/verify/route.ts`
- **What's wrong:**
  - Verification requires only `PAYMENTS_READ`, which DEV, FINANCE and ANALYST hold (`permissions.ts` ROLE_PERMISSIONS).
  - Any `transaction_id` string is accepted, with no gateway lookup, no amount-versus-order check, and no uniqueness on (provider, TrxID).
  - The payment is set to PAID and the order payment to PAID.
- **Impact:** payment fraud. One real bKash TrxID can "verify" unlimited orders, and read-only staff can flip orders to paid.
- **Fix:** add a new `PAYMENTS_VERIFY` permission (OWNER/ADMIN/FINANCE). Reject a duplicate TrxID with 409 and an amount mismatch with 422. Verify through the bKash/Nagad query API when configured; otherwise set status `MANUALLY_VERIFIED` with the actor recorded.

### H4: Mass assignment on PATCH product/customer (cross-tenant write)
**HIGH | [PROVEN] | CWE-915**

- **Location:** `api/v1/products/[id]/route.ts:24` → `product.service.ts:175` → `db/index.ts:4217-4226` (`{...existing, ...updates}`); same pattern in `customers/[id]/route.ts:32` → `customer.service.ts:161` → `db/index.ts:4577-4585`.
- **Exploit:** `PATCH /api/v1/products/<own id>` with `{"tenant_id":"<victim tenant>"}` moves the row into the victim tenant (it persists before the NotFound is thrown). The same body can overwrite `id`, `created_at`, `variants` and `status` arbitrarily.
- **Fix:** validate with a strict schema and whitelist fields.

```ts
const ProductPatch = z.object({ name: z.string().min(1), description: z.string(), base_price: z.number().nonnegative(),
  compare_at_price: z.number().optional(), cost_price: z.number().optional(), status: z.enum(["ACTIVE","DRAFT","ARCHIVED"]),
  category_id: z.string().optional(), brand_id: z.string().optional(), images: z.array(z.string().url()), sku: z.string() }).partial().strict();
const updates = ProductPatch.parse(body);   // unknown keys → 400
```

  Also add a guard in the db layer: `delete (updates as any).tenant_id; delete (updates as any).id;`.

### H5: Social webhook ingress: signature skip and cross-tenant routing
**HIGH | [PROVEN]**

- **Location:** `webhook-ingress.service.ts:61-86`; `facebook.adapter.ts:21`; `social/webhooks/facebook/route.ts:13`; `social/widget/message/route.ts` (public)
- **What's wrong:**
  - If no channel matches the payload's page or phone ID, the first **active channel of any tenant** receives the message (`:66-71`).
  - If none exists, a "sandbox" channel in `ten_default_dhaka` is used and **signature verification is skipped** (`if (channel)`, `:81`).
  - When a channel lacks an app secret, HMAC falls back to `"meta_test_secret"`.
  - The verify token falls back to a literal.
  - The public widget endpoint creates customers and conversations with no rate limit; each message is several whole-file persists (C6).
- **Impact:** injected fake conversations and customers, cross-tenant message leakage, and a trivial DoS.
- **Fix:** reject unknown page IDs (return 200 to Meta, but drop the message); never skip verification; fail closed when no secret is set; rate-limit the widget per IP and per `anonymous_id`.

### H6: Silent 50-row truncation in analytics
**HIGH | [PROVEN]**

- **Location:** `db.getOrders` and `db.getCustomers` default `limit` to 50 (`db/index.ts:4644, 4545`). There are 36 call sites of `db.getOrders(tenantId)` and 10 of `db.getCustomers(tenantId)` without options, across intelligence (12), growth (8), operations (6), enterprise (7) and marketing (8).
- **Evidence (runtime):** RFM analysis produced exactly **50** `customer_intelligence` rows for a tenant with 10,001 customers.
- **Impact:** forecasts, anomalies, LTV/churn, lifecycle, benchmarks, the digital twin, campaign recipients, and "customer already ordered" suppression all compute on about 1% of the data. The results look plausible but are wrong.
- **Fix:** add explicit `getAllOrders(tenantId)` and `getAllCustomers(tenantId)` (or iterators), migrate the 46 call sites, and make the paginated variants require a `limit`.
- **Complexity note:** after the fix, `analyzeCustomers` is O(C×O) = 10,001 × 5,001 ≈ 5×10⁷ comparisons plus C persists. Group orders with a `Map<customerId, Order[]>` for O(C+O), and persist once.

### H7: Fabricated metrics presented as real
**HIGH | [PROVEN]**

- **Location and evidence:**
  - `analytics.service.ts:446-490`: `baselineGMV` / `baselineOrders` (৳425,600 / 198) added to real channel tallies.
  - `:228`: `period_change_pct: 12.8`.
  - `:532`: literal "top channel by conversion".
  - `:704-708`: sine-wave GMV for empty buckets; the margin series is always synthetic.
  - `:261`: base district counts added to RTO.
  - `campaign.service.ts:402-406`: conversions = 7% of delivered × ৳1,650 AOV.
  - `marketing.service.ts:713-730`: literal "AI insights".
  - `(dashboard)/page.tsx:132-136`: KPI fallbacks to fake values when the real value is 0.
  - `super-admin/page.tsx:742-930`: `??` fallbacks for MRR, GMV, AI stats and uptime.
- **Reproduction (runtime):** `GET /analytics/channels?preset=TODAY` with 0 orders today returned `total_orders_count: 198, total_gmv_bdt: 425600`. `GET /analytics/financials?preset=TODAY` returned `period_change_pct: 12.8` and a chart point of ৳12,000.
- **Impact:** merchants make decisions (ad spend, COD advances by district, stock) on invented numbers. Executive digests repeat them.
- **Fix:** delete the baselines and fallbacks; compute the period change from the previous window; return `null` for unknown values and show empty states. Label any demo mode explicitly.

### H8: GET endpoints that rewrite the database per row
**HIGH (perf) | [PROVEN]**

- **Location:**
  - `customer-intelligence.service.ts:116` (upsert per customer)
  - `product-intelligence.service.ts:95` (per product)
  - `inventory-intelligence.service.ts:92` (per variant)
  - `autonomy-policy.service.ts:37-44` (per agent on first read)
  - `insertOpportunity/Risk/Anomaly/Recommendation` (`db/index.ts:6494-6550`) append without deduplication on every view.
- **Measured:**
  - `/intelligence/customers` 79.1 s (50 persists)
  - `/ai/agents?view=orchestration` 100.9 s (68 persists)
  - `/intelligence/opportunities` 405.6 s (~257 persists)
  - `/intelligence/overview` and `/intelligence/risks` over 120 s
  - While these ran, every other request queued (inventory 47.9 s).
  - The store grew by 118,891 bytes in a single sweep.
- **Complexity:** O(rows × S) per GET, where S is the store size. Target: O(rows) compute plus one bulk write, and none on GET.
- **Fix:** make GETs pure reads; move recomputation into an explicit POST `/recompute` or a scheduled job with a single persist; use deterministic IDs (`opp_${tenant}_${kind}_${entityId}`) for upsert semantics.

### H9: External integrations stubbed but reported successful
**HIGH | [PROVEN]**

- **Location and evidence:**
  - Social send: `facebook.adapter.ts:133-147`, `instagram.adapter.ts:117-128`, `whatsapp.adapter.ts:171-182`, `website-chat.adapter.ts:71-82`.
  - Marketing send: `marketing-channel.service.ts:37-118`.
  - Courier: `shipping.service.ts:95-101`.
  - Connector tests: `connectors/service.ts:1464-1700`.
  - Integration tests: `integration-hub.service.ts:116-128`.
  - Outbound webhooks: `webhook-platform.service.ts:85-100`.
  - n8n: `n8n-provider.service.ts:209`.
  - Messages are marked SENT/DELIVERED; campaigns write `messages_delivered`.
- **Reproduction (runtime):** `POST /connectors/test {provider_id:"openai", credentials:{api_key:"sk-this-is-not-a-real-key"}}` returned `success: true`.
- **Impact:** operators believe customers were answered or messaged and parcels booked, when nothing left the server.
- **Fix:** until real adapters exist, return `status:"NOT_SENT", reason:"channel_not_connected"` and show a banner. Implement adapters behind feature flags that are actually enforced.

### H10: Fake step-up MFA
**HIGH | [PROVEN] | CWE-308**

- **Location:**
  - `platform/auth/step-up/route.ts:13-17`: accepts `code === "123456" || "000000" || password === "Password123!" || code.length === 6`.
  - `security.ts:148`: `mfaVerified` defaults to `true`.
  - `auth/login/route.ts:39`: `mfaVerified = mfa_enabled` flag, with no challenge.
- **Reproduction (runtime):** `{code:"zzzzzz"}` returned 200 with a step-up token. The UI's own `{mfaCode:"654321"}` returned 401 (contract bug, M1).
- **Fix:** add TOTP (e.g. `otplib`) with a per-operator secret and rate limiting; set `mfaVerified` only after a verified challenge.

### H11: Safety controls stored but never enforced
**HIGH | [PROVEN]**

- **Evidence:**
  - `KillSwitchActiveError` (`errors.ts:146`) is never thrown.
  - No code outside the platform admin service reads feature flags or entitlements.
  - `EMERGENCY_HALTED` (`autonomous-control-plane.service.ts:111,163`) is written but never read.
  - The only enforced switches are Operations `emergency_stopped` (`operational-budget.service.ts:66`, used by `operations-workflow.service.ts:66`), the AI agent policy (`autonomy-policy.service.ts:57`), and the in-memory marketing switch.
- **Impact:** during an incident, operators flip switches that do nothing.
- **Fix:** add a single `SafetyGate.assertAllowed(tenantId, capability)` called by every mutating service, or remove the UI until it's enforced.

### H12: Shipment delivery bypasses the order state machine and inventory commit
**HIGH | [PROVEN]**

- **Location:** `shipping.service.ts:118-122` (sets READY_TO_SHIP / FULFILLED directly) and `:173-185`; `courier-sync.service.ts:162-172`
- **What's wrong:** `db.updateOrderStatus(..., "DELIVERED")` skips `OrderStateMachine.assertTransition`, so CANCELLED or RETURNED orders can become DELIVERED and PAID. Unlike `order.service.ts:~262` (`transitionOrderStatus`), these paths never call `commitReservation`, so `quantity_on_hand` is never decremented for courier-delivered orders and reserved stock stays reserved forever.
- **Fix:** route every status change through `OrderService.transitionOrderStatus` (single writer), and commit reservations inside it.

### H13: IDOR through ID-only lookups
**HIGH | [PROVEN] | CWE-639**

- **Location:**
  - `analytics.service.ts:551-557` → `db/index.ts:6964`: digest by ID with no tenant filter. Digests contain GMV, margins and channel revenue.
  - `approval-engine.ts:25,115` via `POST /api/v1/ai/approvals/[id]`: approve or reject another tenant's pending AI action.
  - `decision.service.ts:21,124`: `getRecommendationById` / `getDecisionRequestById`.
  - `integration-hub.service.ts:117`: test by installation ID.
  - About 50 `db.get*ById(id)` / `db.update*(id, …)` accessors are unscoped (`db/index.ts:6128-7843`).
- **Fix:** make every accessor take `tenantId` (`find(r => r.tenant_id === tenantId && r.id === id)`); return 404 on mismatch.

### H14: All "AI" is a mock provider
**HIGH | [PROVEN]**

- **Location:** `model-router.ts:43-44`: `primaryProvider = fallbackProvider = new MockLLMProvider()`. `setPrimaryProvider` is never called. Embeddings (`mock-llm.provider.ts:335`) are concept-cluster vectors. Connector-saved OpenAI/Anthropic keys are never used by the router.
- **Impact:** agent replies, copilot suggestions, evaluations and the "RAG" quality are fixed keyword behaviour, not model reasoning.
- **Fix:** wire a real provider from connector config, or label the AI features "offline demo".

### H15: Production build likely fails on type errors
**HIGH | [SUSPECTED, high confidence]**

- **Evidence:** `tsc --noEmit -p tsconfig.json` (run 2026-09-27) reports **12 errors**, all in orphaned files:
  - `domains/customers/customer.repository.ts` (8): `findCustomerByEmail`, `full_name`, `district`, … don't exist.
  - `domains/social/social.repository.ts` (4): `SocialMessage`, `createSocialMessage`, … don't exist.
- **Why it matters:** `tsconfig.json` includes `src/**/*.ts`, and `next build` type-checks the project and fails on errors unless `typescript.ignoreBuildErrors` is set, which it isn't.
- **Not verified:** `next build` was not run, to avoid overwriting `.next`.
- **Fix:** delete or repair the two dead repositories; add `npm run type-check` to CI.

### Medium findings

| ID | Location | Problem and impact | Fix |
|---|---|---|---|
| **M1** (Wiring, PROVEN runtime) | §2b table | 404s and a 401 contract mismatch. `autonomous/page.tsx:92-98` ignores `res.ok` and alerts success. | Point the UI at existing routes: `DELETE /platform/support/impersonate?sessionId=…`; add `/platform/safety/kill-switch/[id]/deactivate`; send `{code}` for step-up; add `/api/v1/ai/tools/execute` or remove the button. Check `res.ok` everywhere. |
| **M2** | `db/index.ts:4447` | Reservations carry `expires_at` but nothing ever releases them, so stock stays reserved for abandoned PENDING orders. | Add a sweeper (interval or on-read) that releases `ACTIVE && expires_at < now` and cancels the stale order. |
| **M3** | `order.service.ts:103` → `db/index.ts:4602` | Order number is count+1, computed **before** `await reserveStock` (`:110`). Two concurrent creates both get `ORD-2026-005002`. Deletions also cause reuse. | Use a monotonic per-tenant sequence (a Postgres `SEQUENCE`, or an atomic counter in the store) assigned at insert. |
| **M4** (CWE-338) | `security.ts:68-74`, `invitations/service.ts:28` | Invitation tokens and all IDs come from `Math.random` (V8 xorshift128+, predictable). | Use `crypto.randomBytes(32).toString("base64url")` and `crypto.randomUUID()`. |
| **M5** | `orders/page.tsx:165-166` | Division/district is `"Dhaka"` or `"Chittagong"` depending only on the zone, which corrupts RTO geography and courier routing for every outside-Dhaka order. | Add real division/district selectors, as `customers/page.tsx:41-42` already has. |
| **M6** | `growth/audiences/page.tsx:9-40, 78` | Four presets with different descriptions all post the same condition. | Store the rule per preset. |
| **M7** | `campaign.service.ts:352,361` | O(R×C) `allCustomers.find` over a 50-row list, so recipients beyond the newest 50 are "suppressed". | Use a `Map` built from all customers: O(R+C). |
| **M8** (DEAD path) | `neon/client.ts:144-156` | If `fn` throws after ROLLBACK, the outer `catch(poolErr)` **re-runs `fn` without a transaction**, so writes are duplicated and partial. `execute().rowCount` returns the returned-row count (`:111`). | Only fall back on connection errors (`instanceof` check before BEGIN); use `result.rowCount`. |
| **M9** | `auth/logout/route.ts` | Clears only `commerceos_session`. The platform cookie (8 h) survives, and 7-day JWTs can't be revoked. | Clear both cookies; add a `session_version` per user checked in `resolveRequestContext`. |
| **M10** | `auth/service.ts:136-151, 216-231` | Any active platform membership (e.g. PLATFORM_SUPPORT) becomes OWNER of `getTenants()[0]` or of any tenant ID in a token. | Map platform roles to read-only tenant access through audited impersonation only. |
| **M11** | `db/index.ts:4156, 4191` | Tenants created by `register` have no warehouse, so inventory rows reference `warehouses[0]` of another tenant. | Create a default warehouse in `TenantService.createTenant`; remove the cross-tenant fallback. |
| **M12** | `task-executor.ts:243-262` | Tasks run with a fabricated OWNER context regardless of who created the workflow. | Carry the creator's permissions into the workflow and check them per task. |
| **M13** | whole API | No rate limiting on login, register, widget or webhooks. Brute force and spam are trivial, and each request is ≥1 full persist (C6). | Use `@upstash/ratelimit` (already a dependency) or an in-memory token bucket per IP and per account. |
| **M14** | `security.ts:9` | Encryption key = SHA-256(public default JWT secret), so connector credentials are effectively plaintext to anyone with the file. | Use a separate KMS/env key; re-encrypt. |
| **M15** | `identity-resolution.service.ts:124` | Missing phones are filled with random `+8801700xxxxxx`, which are real Grameenphone-format numbers. Any future real send would message strangers, and random collisions merge identities. | Leave the phone `null`. |
| **M16** | `agents/page.tsx:394-413` | Compressed PDF streams and DOCX (zip) read as text produce garbage chunks. | Parse server-side (`pdf-parse`, `mammoth`) or restrict accepted types. |
| **M17** (SUSPECTED) | `n8n-provider.service.ts:201-224` | The server POSTs to `instance.base_url` supplied through platform config, which is reachable unauthenticated via C3, and stores the JSON response. Not verified: exactly which route persists `base_url`. | Allow-list hosts; block private IP ranges. |

### Low / Info findings

| ID | Location | Problem | Fix |
|---|---|---|---|
| **L1** (CWE-209) | `api-response.ts:59` | Unhandled errors return raw internal messages to clients. | Return a generic message and log the details server-side. |
| **L2** | growth, autonomous, intelligence services | `throw new Error("…not found")` returns 500. | Use `NotFoundError`. |
| **L3** | `app/health/ready/route.ts:7` | Always ready. | Check the real DB (and Neon if adopted) with a timeout. |
| **L4** | many services | `aud_${Date.now()}` / `evt_${Date.now()}_…` IDs collide within the same millisecond. | Use `randomUUID()`. |
| **L5** | `base-repository.ts:151-187` | Keys are interpolated as column names. | Allow-list columns per repository. |
| **L6** | 4-digit random suffixes | PO/SKU collisions. | Use sequences or ULIDs. |
| **L7** | inbox | No realtime. | Add SSE or 10 s polling. |
| **L8** | `next.config.js` | No `headers()`. | Add CSP, `X-Frame-Options`, `Referrer-Policy`, HSTS. |
| **I1** | tests | 297/297 pass, but tests set `NODE_ENV=test` (so `persist()` never runs), call services directly (so HTTP auth, dev fallback and headers are skipped), and the security suite never asserts `verifyPassword("Password123!", <other hash>) === false`. | See §6. |
| **I2** | docs | `SYSTEM_AUDIT_REPORT.md` ("100% functional", "production-grade") and `.agent/PROJECT_STATE.md` ("Phases 1-12 fully operational") are contradicted by C1-C7 and the wiring inventory. | Update or retire them. |

### Performance summary (Phase 3)

| Hot path | Current cost | Dominant term | Improved |
|---|---|---|---|
| Any mutation (`persist`) | O(S) CPU + I/O, sync, S = 39 MB | JSON.stringify + fsync | Postgres indexed write O(log n); interim debounce gives O(S) per 250 ms window |
| `getOrders(search)` `db/index.ts:4630-4636` | O(O·C) (`customers.find` per order) | 5,001 × 10,001 | `Map<id, Customer>`: O(O+C) |
| `getOrders` hydration `:4646-4654` | O(L·(C + I)) per page | `order_items.filter` per order | Index items by `order_id`: O(L) |
| `analyzeCustomers` | O(C·O) + C·persist | persist | Group by customer O(C+O), 1 persist |
| `analyzeInventoryHealth` | O(V·(P + I)) + V·persist | persist | Maps + 1 persist |
| `executeCampaign` | O(R·C) + stub sends | `.find` | Map O(R+C) |
| `getDashboardMetrics` | O(O+C+P+I) scans across all tenants' arrays per page view | full-array filters | Per-tenant indexes or SQL aggregates |

Per-tenant filtering everywhere is O(total rows across all tenants), so every tenant pays for every other tenant's data.

### Reliability & operability (Phase 4)

- **No backpressure:** synchronous persistence serializes everything.
- **No timeouts on long GETs:** the Next server kept processing after clients aborted (405 s).
- **Circuit breakers:** they exist for n8n and couriers, but guard mostly mocked calls.
- **Observability:** no structured logging, metrics or tracing. Errors are swallowed in `persist()`, the Pinecone fallbacks, and the social webhook route (which returns 200 on error by design).
- **Idempotency:** webhook idempotency exists (`idempotency.service.ts`); order creation has no idempotency key.
- **Resource leaks:** `setTimeout(() => this.persist(), 50)` re-entry path is dead; no connection pools are used by the app.

### Code quality (Phase 5)

Two parallel data layers (the JSON `db` and Neon repositories) with divergent schemas. Services reach into `(db as any).data` directly (20+ files). The 9k-line `db/index.ts` god-object has 552 public methods.

---

## 5. Prioritized Remediation Plan

**Fix first (this week)**

1. [S] Rotate the Neon password; placeholder `.env.example`; add `.gitignore` (C5).
2. [S] Delete master passwords and pass-the-hash; re-seed real hashes; update the 3 affected test files (C1).
3. [S] Fail closed on a default or missing `JWT_SECRET`; per-purpose audiences; separate encryption key (C2, M14).
4. [M] Remove the `x-test-platform-role` path and the header in the UI; build the super-admin login page on the existing route (C3).
5. [S] Lock `automation/webhooks/[provider]`: tenant from config, constant-time token compare, no Bearer bypass, no default secrets (C4).
6. [S] Opt-in dev auth bypass only, never on invalid tokens (H1).
7. [S] Strict zod schemas on PATCH product/customer (H4).
8. [S] `PAYMENTS_VERIFY` permission, TrxID uniqueness, amount check (H3).
9. [M] `assertCan` on growth/marketing/operations/enterprise/autonomous/intelligence mutations; approver = session user (H2).
10. [S] Real step-up (TOTP) or remove the step-up gate claims (H10).

**Hardening (next 2-4 weeks)**

11. [L] Replace the JSON store with the Neon repositories (fix M8 first). Interim [S]: debounced async persist with surfaced errors and temp-file cleanup (C6, C7).
12. [M] Pure-read GETs; move recompute jobs to explicit POST or cron with a single persist; deterministic IDs (H8).
13. [M] Remove the 50-row default from 46 call sites (H6).
14. [M] Remove fabricated baselines and fallbacks; honest empty states (H7).
15. [M] Mark stubbed integrations as NOT_SENT / "demo", or implement the real adapters (H9, H14).
16. [M] Enforce or remove kill switches, flags and entitlements (H11).
17. [S] Fix the broken endpoints and contracts in §2b (M1).
18. [M] Single order-status writer, reservation commit, expiry sweeper, sequence numbers (H12, M2, M3).
19. [M] Tenant-scope every `db.*ById` accessor (H13).
20. [S] Rate limiting and security headers (M13, L8).

**Nice-to-have**

21. [S] Delete or repair the dead repositories so `tsc` is clean (H15).
22. [S] Remaining items: `crypto` tokens, district picker, audience presets, error hygiene, readiness probe (M4-M6, L1-L4).
23. [M] Invitation accept page and email delivery; server-side PDF/DOCX parsing; inbox realtime (row 104, M16, L7).
24. [M] Payments / Returns / Categories / Brands / Coupons UIs for the 58 orphaned endpoints, or remove the endpoints.

---

## 6. Test Additions

These are written for the existing harness (`runTest` + `assert`, run via `tests/ts-runner.cjs`).

```ts
// tests/security-regression-tests.ts
import assert from "assert";
import { hashPassword, verifyPassword } from "@/lib/security";
import { extractPlatformContext, extractRequestContext } from "@/lib/api-response";
import { WebhookGatewayService } from "@/domains/automation/services/webhook-gateway.service";
import { ProductService } from "@/domains/catalog/product.service";
import { db } from "@/infrastructure/db";

await runTest("C1: master passwords and pass-the-hash are rejected", async () => {
  const hash = await hashPassword("S0me-Unique-Password!");
  assert.strictEqual(await verifyPassword("Password123!", hash), false);
  assert.strictEqual(await verifyPassword("CommerceOS2026!", hash), false);
  assert.strictEqual(await verifyPassword(hash, hash), false);
});

await runTest("C3: x-test-platform-role is ignored outside test", async () => {
  const prev = process.env.NODE_ENV; (process.env as any).NODE_ENV = "production";
  try {
    const req = new Request("http://x/api/v1/platform/overview", { headers: { "x-test-platform-role": "SUPER_ADMIN" } });
    await assert.rejects(() => extractPlatformContext(req));
  } finally { (process.env as any).NODE_ENV = prev; }
});

await runTest("H1: an invalid token never falls back to OWNER", async () => {
  const req = new Request("http://x/api/v1/orders", { headers: { authorization: "Bearer not.a.jwt" } });
  await assert.rejects(() => extractRequestContext(req));
});

await runTest("C4: courier webhook without a valid token is rejected", async () => {
  for (const headers of [{}, { authorization: "Bearer anything" }]) {
    const r = await WebhookGatewayService.processInboundWebhook("ten_default_dhaka", {
      provider: "STEADFAST" as any, endpointPath: "/api/v1/automation/webhooks/steadfast",
      headers, rawBody: "{}", parsedBody: {},
    });
    assert.strictEqual(r.verified, false);
  }
});

await runTest("H4: PATCH cannot move a product to another tenant", async () => {
  const p = await ProductService.createProduct(ctxA, { name: "T", sku: `T-${Date.now()}`, base_price: 10 });
  await ProductService.updateProduct(ctxA, p.id, { tenant_id: "ten_victim" } as any).catch(() => {});
  assert.ok(db.findProductById(ctxA.tenant.id, p.id));
  assert.strictEqual(db.findProductById("ten_victim", p.id), undefined);
});
```

**Table-driven RBAC matrix (H2).** For every mutating handler, a SUPPORT-role session must get 403:

```ts
const MUTATIONS: Array<[string, (req: Request, ctx: any) => Promise<Response>, any]> = [
  ["marketing/broadcasts/[id]/dispatch", dispatchPOST, { params: { id: "cmp_x" } }],
  ["growth/campaigns/[id]/approve",      approvePOST,  { params: { id: "cmp_x" } }],
  ["operations/autonomy/kill-switch",    killPOST,     {}],
  ["autonomous/decisions/[id]/approve",  decApprove,   { params: { id: "dec_x" } }],
  ["payments/verify",                    verifyPOST,   {}],
];
for (const [name, handler, ctx] of MUTATIONS) {
  await runTest(`RBAC: SUPPORT cannot call ${name}`, async () => {
    const res = await handler(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${supportToken}` }, body: "{}" }), ctx);
    assert.strictEqual(res.status, 403);
  });
}
```

**Correctness tests:**

| Test | Input | Expected |
|---|---|---|
| H6 truncation | Seed 120 customers / 300 orders | `analyzeCustomers(t).length === 120`; RFM frequency sums equal 300 |
| H7 honesty | Tenant with 0 orders; `getChannelAttributionReport(ctx,"TODAY")` | `total_orders_count === 0 && total_gmv_bdt === 0`; `period_change_pct` is null |
| H3 payments | ANALYST calls verify | 403 |
| H3 payments | Same TrxID on 2 payments | 2nd call returns 409 |
| H3 payments | Amount ≠ order total | 422 |
| H12 state | Shipment DELIVERED for a CANCELLED order | 409 |
| H12 state | Delivered order | `quantity_on_hand` decremented, reservation COMMITTED |
| M2 expiry | Reservation with `expires_at` in the past, then sweeper runs | Status RELEASED, `quantity_available` restored |
| M3 uniqueness | `Promise.all` of 20 `createOrder` | 20 distinct `order_number` |
| H13 IDOR | Tenant B requests tenant A's digest ID / approval ID | 404 |
| Step-up contract | UI payload `{mfaCode}` | Handled by the route; valid TOTP only |

**Contract gate (CI).** Turn the audit's route cross-check into a test that fails when any client `fetch('/api/v1/…')` has no route or method, or any server-side "advertised" URL 404s.

**Load test (k6).** 20 VUs, 70% `GET /api/v1/orders?limit=20`, 30% `POST /api/v1/auth/login`. Assert p95 < 500 ms and max < 2 s. This fails today (measured 8.6 s at 3 concurrent writes).

**Property/fuzz tests:**
- `reserveStock` with random quantities (including negatives, fractions and NaN) never makes `quantity_available > quantity_on_hand`.
- Webhook bodies fuzzed with random headers are never `verified` without a valid signature.

---

## 7. Open Questions / What I Could Not Verify

1. **Deployment target.** Docs say Docker/Kubernetes, but there's no application Dockerfile. Is `NODE_ENV=production` guaranteed in the deployed environment? This determines whether H1 is exploitable in prod.
2. **System of record.** Is Neon meant to be the system of record? If so, the JSON store must go; if not, the Neon layer (and C5's credential) should be retired.
3. **TypeSafe/Jev.** `api.typesafe.ai` reachability and the behaviour of the live key were not exercised.
4. **Production build.** `next build` was not run, to avoid overwriting `.next`. H15 is inferred from `tsc`.
5. **POST flows.** Beyond the ones listed in §2, POST flows were traced statically, not executed. Examples: bulk import, knowledge upload, workflow creation, enterprise hierarchy create.
6. **Past data loss.** Were the 5 orphaned `.tmp` files from crashes or from concurrent processes (e.g. seed scripts running alongside `next dev`)? Is there known data loss from 2026-09-22 to 09-24?
7. **Credential spread.** Has the folder, or `CommerceOS_IEEE_Project_Proposal.docx`, been shared with the Neon credential in it? Rotation is needed either way.
8. **Intended maturity.** If this is an academic/demo build for the IEEE proposal, say so. The STATIC/DEMO items then need honest labels rather than implementations, but C1-C5 still matter the moment it's hosted anywhere.
9. **Not reviewed in depth:** `n8n/workflows/*.json`, `scripts/*`, CSS/design, the 1,800-line pages' pure-presentation code, and `.agent/` docs beyond the claims cited.

---

## Addendum — findings discovered during remediation planning (2026-09-27)

- **C8 — Platform login accepts any password.** CRITICAL, [PROVEN by code trace].
  - **Location:** `src/app/api/v1/platform/auth/login/route.ts:33-37` evaluates `isValid = password === "Password123!" || user.password_hash === password || user.password_hash.startsWith("$2a$10$")`. Every hash produced by `hashPassword()` (bcrypt, cost 10) starts with `$2a$10$`, so every platform operator can log in with any password.
  - **Also:** the route returns the platform JWT in the JSON body as well as the cookie.
  - **Fix:** FX-02 in `FIX_IMPLEMENTATION_PLAN.md`.
- **C1-b — Seeded accounts only work through the backdoors.** The seeded hash `$2a$10$iM.oG9E…` (`db/index.ts:1117, 1152, 1209`) matches **neither** `Password123!` nor `CommerceOS2026!` (`bcrypt.compare` returns false for both). Removing the backdoors therefore locks out all 6 seeded accounts unless their passwords are reset first. See FX-02 step 5.
- **H11-b — The emergency kill switch fails silently while confirming success.** HIGH, [PROVEN by code trace].
  - **Location:** `src/app/(dashboard)/autonomous/governance/page.tsx:55-70`.
  - **What happens:** the button POSTs to `/api/v1/ai/tools/execute` (404, runtime-verified for the same route) and ignores the response. It then alerts "EMERGENCY KILL SWITCH ACTIVATED. All autonomous executions halted."
  - **Fix:** FX-33 item 1.
- **H5-b — Seeded channels have no real credentials.** Seeded channels store placeholder strings (`"encrypted_fb_token_seed"`, `db/index.ts:2465-2510`) instead of ciphertext. `ChannelService.getDecryptedCredentials` (`channel.service.ts:162-168`) swallows the decrypt failure and returns `{}`, so Meta signature checks fall back to the literal `"meta_test_secret"`. See FX-03 step 4 and FX-07.
