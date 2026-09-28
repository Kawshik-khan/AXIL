# CommerceOS — Current Status (Source of Truth)

**Last verified:** 2026-09-28 · **Evidence:** [`AUDIT_REPORT_2026-09-27.md`](../AUDIT_REPORT_2026-09-27.md) · **Remediation plan:** [`FIX_IMPLEMENTATION_PLAN.md`](../FIX_IMPLEMENTATION_PLAN.md)

> This file is the one place that says what **actually works**. Architecture docs in `.agent/` describe the
> **target** design. When a doc and this file disagree, this file wins for "what exists"; the doc wins for
> "what we are building toward". Never report a target-design capability as working unless this file says LIVE.

**Overall posture: NOT production-ready. Do not expose to any network.** Phase 0 containment (FX-00…FX-08, [ADR-103](DECISIONS.md#adr-103-fail-closed-authentication-secrets-and-webhook-signatures-phase-0-containment)) and Phase 1 access control (FX-10…FX-19, [ADR-104](DECISIONS.md#adr-104-access-control-and-integrity-phase-1)) are merged to `main` and tagged `release/phase-0` / `release/phase-1`. Phase 2 performance and read-path integrity (FX-20…FX-24, [ADR-105](DECISIONS.md#adr-105-coalesced-persistence-write-free-reads-and-complete-analytics-phase-2)) is merged to `main` and tagged `release/phase-2` (2026-09-28). Remaining blockers before any network exposure: the JSON-file store is still one file owned by one process (Postgres cutover, Phase 4), fabricated metrics and simulated integrations (H7–H9, H14, Phase 3), unenforced platform safety controls (H11) and N8.

---

## 1. Status vocabulary

| Label | Meaning |
|---|---|
| **LIVE** | Works end-to-end against the real persistence layer, verified by a test or manual trace. |
| **PARTIAL** | Some paths work; known gaps listed. |
| **SIMULATED** | Code runs but external effects are mocked (no message sent, no courier booked, no LLM called). Must never report success to users. |
| **STATIC** | UI renders hard-coded or demo data. |
| **BROKEN** | Fails, calls non-existent endpoints, or produces wrong results. |
| **TARGET** | Documented design only; not implemented. |

---

## 2. Actual stack vs documented target

| Concern | Actual today | Target (docs) | Status |
|---|---|---|---|
| Persistence | Single JSON file `.data/commerceos.json` via `src/infrastructure/db/index.ts`. Mutations mark the store dirty; one coalesced async flush per `PERSIST_DEBOUNCE_MS` (250 ms) writes a temp file, fsyncs and renames it. Write failures are kept, retried and reported by `/health/ready`; stale temp files are quarantined at start; SIGTERM/SIGINT flush. A writer lock (`.data/commerceos.lock`) makes a second process, a second host or a seed script refuse to start; every flush first checks the lock still names this process; a blocked store answers writes with 503. Next.js helper processes (dev static-paths worker, build workers) load the store but never lock or write it. GET requests never write (sweep test over all 157 GET routes) | PostgreSQL (Neon) via repositories | PARTIAL — Neon client + `*.repository.ts` exist, **0% wired**; exactly one replica until FX-45; a crash loses at most the last debounce window |
| Migrations | Forward-only `.sql` in `src/infrastructure/db/migrations/` (seed data mixed in) | Reversible numbered migrations | PARTIAL |
| Vectors / RAG | Pinecone client (`src/infrastructure/pinecone`) + in-process BM25; embeddings are fake | pgvector / Pinecone hybrid | SIMULATED (H14) |
| Cache / events | Upstash Redis REST client, largely unused; no Streams consumer groups, no Redlock | Redis Streams + PubSub + locks | TARGET |
| LLM | `src/domains/ai/providers/mock-llm.provider.ts` keyword mock | Multi-provider router | SIMULATED (H14) |
| Auth | jose JWTs (issuer + one audience per purpose) carrying a session version; bcrypt-only passwords; secrets fail closed; operator TOTP MFA (two-step sign-in, step-up with replay protection); per-account login rate limits; "sign out everywhere"; no implicit roles for platform staff; scoped service tokens for automations | Verified JWT, MFA, step-up | PARTIAL — workspace users have no MFA; rate limits are per process (one replica until FX-45); account-existence timing leaks (Low) |
| Tenant RBAC | `RbacService.assertCan` on every handler of the six previously unguarded domains (140 handlers, RBAC matrix test) plus the service-layer checks elsewhere; approvers come from the session; four-eyes on high-risk campaigns; id lookups are tenant-scoped; enterprise organizations belong to a workspace | Every route guarded | LIVE (API) — the dock and command palette hide modules a role can't use, but pages don't all show a 403 state yet; role review pending (FX-10 step 7) |
| Platform control plane | Services under `src/domains/platform/services/`; kill switches / flags / entitlements not enforced. Real operator sign-in with TOTP; step-up actions work once the operator sets up an authenticator; newly provisioned tenant owners cannot sign in yet (N8) | Enforced gates | PARTIAL (H11, N8) |
| Webhooks | Courier/payment: per-endpoint `?wh=` id, HMAC of `<timestamp>.<raw body>`, 300 s window, tenant from the webhook row, duplicates suppressed by a key from signed data, 600/min per endpoint. Social: per-entry channel resolution, Meta signature mandatory | HMAC + replay defense | PARTIAL — secrets are per provider, not per endpoint (Low); provider-native signature formats not built (Phase 5); n8n relays must add HMAC signing (import guide) |
| External integrations | Social send, courier booking, payment verification, connectors all stubbed but report success | Real adapters | SIMULATED (H9) |
| Analytics | Analytics, intelligence, growth, enterprise and operations services read every row (`getAllOrders` / `getAllCustomers` / `getAllProducts`); paged reads require an explicit limit. Intelligence GETs serve a snapshot stored by `POST /api/v1/intelligence/recompute` (fresh for 15 min) or compute in memory, in O(n) | Real aggregates | PARTIAL — hard-coded baselines and fabricated projections remain (H7, Phase 3); no scheduled recompute |
| Docker / deploy | No Dockerfile; `n8n/docker-compose.yml` only. `/health/ready` reports persistence health, data-dir writability and writer-lock ownership (503 when unsafe) | Multi-stage image, readiness probe | TARGET — deployment constraint: one replica, `Recreate` updates (DEVOPS.md) |
| Lint | `npm run lint` has no ESLint config | Enforced lint | TARGET |
| Type-check | `npm run type-check` reports 12 errors, all in the unwired `customer.repository.ts` / `social.repository.ts` (H15); unchanged by Phases 0 and 1 | Zero errors | BROKEN |
| Tests | `npm test` → 25 custom suites, 769 tests, all pass: `security-regression-tests.ts` (46, Phase 0), `rbac-matrix-tests.ts` (287, Phase 1), `phase1-integrity-tests.ts` (61, Phase 1 + review fixes), `persistence-tests.ts` (8, real store in child processes), `phase2-analytics-tests.ts` (6) and `phase2-readonly-tests.ts` (14; sweeps all 141 tenant and 16 platform GET routes for store changes and write requests) among them; `scripts/smoke-security.mjs` replays the exploits against a running server | Unit + integration + eval + E2E | PARTIAL — no E2E/UI tests, no load test (FX-63) |
| Agent evals | `src/domains/ai/eval/golden-dataset.ts` + `evaluation.service.ts`; no `test:eval` script | Gated eval suite | PARTIAL |
| Git | Local git repository: `main` = Phase 2 (tags `release/phase-0`, `release/phase-1`, `release/phase-2`); `.gitignore` keeps out env files, `.data/`, `.backups/` and generated seeds | Versioned, PR-reviewed | PARTIAL — no remote, no CI |

---

## 3. Feature inventory (from audit §1, 122 sections traced)

| Status | Count | Share |
|---|---|---|
| LIVE (on JSON store) | 41 | 33.6% |
| PARTIAL | 38 | 31.1% |
| STATIC/DEMO | 22 | 18.0% |
| BROKEN | 15 | 12.3% |
| DEAD | 6 | 4.9% |

Basic CRUD (orders, products, inventory, customers, inbox, settings) is genuinely functional on the JSON store.

---

## 4. Open findings by priority

**Closed by Phase 0 (2026-09-27, ADR-103):**
- C1, C2, C3, C4, C8, H1, H5, M14.
- H5 hardening from the Phase 0 security review:
  - Meta batches are routed and signature-checked per entry, so a batch can't carry another Page's messages into the first Page's tenant.
  - A Meta account id can be connected to only one channel (409 otherwise). An id held by several channels is ignored at ingress.
  - The widget session endpoint no longer returns other visitors' IP address or user agent, and widget visitor ids are 128-bit random.
- The opt-in dev bypass (`DEV_AUTH_BYPASS=1`) now serves only loopback, same-site requests (no LAN or cross-site use).
- N1 (found during Phase 0): `POST /api/v1/invitations/[token]` signed in an *existing* account without its password. Anyone who can create an invitation, including a self-registered workspace owner, could mint a session for any existing email. The route now requires that account's password.
- H10 is contained: step-up fails closed and no session claims MFA. Real TOTP is FX-15.
- C5 is closed in the repository: `.env.example` has placeholders only, and `.gitignore` is in place. **The owner must still rotate the Neon database password that was in `.env.example`.**

**Closed by Phase 1 (2026-09-28, ADR-104):**
- H2 (RBAC on 140 handlers), H3 (payment verification), H4 (mass assignment), H13 (IDOR, including enterprise organizations), H10 (real TOTP step-up).
- M4 (cryptographic IDs), M9/M10 (session hygiene; no implicit OWNER for platform staff), M12 (workflows act with their creator's permissions), M13 (rate limiting).
- L1 (generic 500s), L2/L8 (security headers).
- Phase 0 findings: N2 (webhook dedup), N4 (fake MFA flags), N5 (workspace-only suspension). The low item "`x-request-id` feeds the idempotency key" is also closed.
- Phase 1 security review (2026-09-28), all fixed with tests:
  - an ADMIN could invite an OWNER (High);
  - `POST /ai/agents` UPDATE_POLICY could write another workspace's autonomy policy (High);
  - role assignment switched operator MFA off;
  - the dedup key could be bypassed with a re-cased signature;
  - `X-Forwarded-For` spoofing behind a proxy;
  - password guessing through invitation acceptance;
  - service tokens outliving their creator's access;
  - the payment AI tool needed only read access;
  - an unscoped enterprise integration test that faked success;
  - a rejected reconciliation reported as 200;
  - a global pre-auth Meta webhook bucket;
  - a mistyped MFA code signed the console out;
  - MFA enrollment without re-authentication;
  - removing the last owner;
  - account-existence timing on login.

**Closed by Phase 2 (2026-09-28, ADR-105):**
- C6: no request waits for a whole-file write; mutations are coalesced into one async flush per window.
- C7 (contained): write errors are surfaced, retried and reported; temp files are quarantined, not lost; one writer per host, and seed scripts refuse to run beside the app. Multi-host safety waits for Postgres (FX-45).
- H6: analytics read every row (checked with 120 orders / 80 customers in tests, and 10,000 customers / 5,000 orders live).
- H8: all 141 tenant GET routes are write-free (was 14 writers, found by the new sweep); intelligence endpoints answer in under 0.6 s cold on 10,000 customers (were 79–405 s on the audit store).
- M7: campaign recipients are looked up in a map of all customers, so none is silently suppressed.
- L3: `/health/ready` checks persistence, the data directory and the writer lock.
- Found during Phase 2 and fixed:
  - **N9 (Medium):** cohort records were stored by month only, so tenants overwrote each other's cohorts and `getCohortRecords` returned every tenant's rows (no route read them). Now keyed and filtered by tenant; pre-Phase-2 rows without a tenant are ignored.
  - **N10 (Medium):** the marketing frequency cap counted only the first page of the customer's conversations and messages, so a busy shop could exceed the cap. It now counts all of them.
  - `GET /growth/lifecycle/[customerId]` created a lifecycle row for any made-up id; it now answers 404 for unknown customers.
  - `GET /operations/payments` reported only exceptions created by that same request, so a second call showed 0 unreconciled payments; it now shows every unresolved one.
  - `getInventory` looked variants and products up across every tenant's catalogue.
  - Removing the 50-row cap exposed O(n·m) loops that the cap had hidden: audience evaluation, marketing audience cohorts and members, stockout risks, reconciliation, order health, pricing, abandoned carts and COGS. At 10,000 customers / 5,000 orders they took 0.9–3.1 s; now 20–85 ms.
  - AI `get_order` / `get_order_status` searched only the newest 50 orders.
  - Recommendations shown from a live compute couldn't be proposed as decisions (404); proposing now stores the current set.
- Phase 2 security review and re-review (2026-09-28), all fixed with tests:
  - a recompute carried an old approve/reject decision onto new content, and each recompute pushed its expiry forward (Medium);
  - a lock owned by another host was taken over, and two processes could both take over a stale lock (Medium);
  - `/health/ready` exposed paths, pids and host names to unauthenticated callers;
  - a blocked store acknowledged writes it never saved and seeded accounts in memory;
  - recompute had no rate limit, and proposing an unknown id triggered a stored recompute;
  - ops scripts backed up the wrong file with a custom data dir and reported success before the flush;
  - `findOrderById` looked the customer up without a tenant filter;
  - a lock that exists but can't be read was treated as stale.

**Open from Phases 0 and 1:**
- **N6 (Medium, contained)** — Phase 0 stopped the public widget from sending visitor phone/email into identity resolution, so a visitor can no longer pose as a known customer. What's still missing:
  - a verified-contact design;
  - real placeholders instead of the made-up `+8801700…` phones given to customers who have none (FX-30).
- **N8 (Medium)** — `platform-tenant.service.ts` provisions the tenant owner as `INVITED` with a disabled password, and nothing lets them set one. Provisioned workspaces are unusable until an owner-setup flow exists (FX-37).
- **N3 (Low)** — `src/types/declarations.d.ts` shadows `@types/node` (hidden by `skipLibCheck`). Fold into FX-38.
- **Low:**
  - Invitation accept still answers differently for new and existing emails.
  - Courier webhook secrets are per provider and shared across tenants, and the signature doesn't cover `wh`. Fix: per-endpoint secrets.
  - The website server-to-server HMAC has no timestamp.
  - `tests/connectors-tests.ts` contains a fake `npg_` string, so FX-00's literal grep matches it. No real credential is in the history.
- **Found during Phase 2, open:**
  - **N11 (Medium):** `GET /enterprise/benchmarks` builds a synthetic `ENTERPRISE_ADMIN` caller with `all_access` scope and fallback identity values instead of the caller's real enterprise role, so store-level scoping inside an organization isn't applied.
  - **N12 (Low):** `semanticMetricsService.queryMetric` looks metric definitions up in the shared `org_default`, not the caller's organization (it no longer writes there).
  - Product intelligence applies the tenant's total returns to every product's return rate; growth recommendations carry fixed projected revenue. Both are fabricated-metric work for Phase 3 (FX-30).
  - `GetOrderStatusTool` reports "Steadfast Courier" / "STF-2026-PENDING" when an order has no shipment (non-negotiable 7, Phase 3 FX-31).
  - `approveDecision` doesn't check the approval's expiry, and proposing a recommendation twice creates two approvals (Low).
  - The AI order tools now find any order by number. Before a customer-facing channel uses them, they must check the order belongs to that customer.
  - Lock identity is pid + host name + start time. Containers sharing a host name and pid namespace ids could still collide; the per-flush lock check limits the damage. A heartbeat or boot id would close it (Low, until FX-45).
- **Deferred from Phase 2** (see ADR-105 deviations):
  - No scheduled recompute: snapshots are stored only by `POST /api/v1/intelligence/recompute`, workflows and the intelligence agent. Stale reads compute in memory instead.
  - The sweep calls 7 of the 24 tenant `[id]` GET routes only with ids that don't exist (no matching rows in its seed data), and sweeps query-parameter branches only for `ai/agents?view=` and `enterprise/metrics?metric_key=`.
  - `getDashboardMetrics` still scans each collection once per call (accepted until Phase 4).
  - Graceful-shutdown flush is untested on Windows (no SIGTERM delivery there).
- **Deferred from Phase 1** (see ADR-104 deviations):
  - Pages don't all render a 403 state (only navigation is filtered).
  - The role review with the product owner (FX-10 step 7) is pending.
  - Human-facing numbers (PO numbers, SKU suffixes) wait for FX-35 sequences.
  - Enterprise Developer API keys are neither wired nor removed (FX-18 step 6, decision D2).
  - Rate limits and step-up replay state are per process (one replica until FX-45).
  - Workspace users have no MFA.
  - A role change doesn't revoke sessions; it takes effect on the next request anyway, because the role is re-read.
  - Authenticator setup shows the key and `otpauth://` link, not a QR code (no new dependency).
  - Step-up tokens aren't tied to one action.
  - The widget's 300-per-minute per-channel cap can be filled by one visitor rotating ids. It's a spam backstop; without a trusted proxy there's no client address to key on.

**Next — Phase 3 (FX-30…):** truthful data and broken wiring: remove fabricated metrics (H7), honest integration stubs (H9), N11.
**Hardening:** H7–H9, H11, H12, H14, M1–M3, M11; Postgres cutover for C7 (FX-45).
**Hygiene:** H15, M5, M6, M8, M15–M17, L4–L7, N12.

When you fix a finding: update the row in §2 (if the status changed), and add a line to §5.

---

## 5. Change log of status (newest first)

| Date | Change | Finding IDs | Verified by |
|---|---|---|---|
| 2026-09-28 | Phase 2 performance and read-path integrity (FX-20…FX-24): coalesced async persistence with surfaced errors, writer lock and real readiness; analytics read every row; write-free GETs with snapshot reads and an explicit recompute; O(n) hot spots; N9/N10 fixed; Persistence / Analytics / Docker / Tests / Git rows updated | C6, C7 (contained), H6, H8, M7, L3, N9, N10 | all 25 suites (769), `npm run type-check` (12, unchanged); live on a throwaway server seeded with 10,000 customers / 5,000 orders: 92 UI GETs left the store file unchanged, intelligence GETs ≤ 0.6 s cold, recompute idempotent and rate-limited (200, 200, 429), a second dev server on the same data refused to start, `scripts/smoke-security.mjs` 19/19; security review + re-review and done-check, all findings addressed or listed as open |
| 2026-09-28 | Phase 1 access control and integrity (FX-10…FX-19): RBAC on 140 handlers, payment verification rules, strict update schemas, tenant-scoped lookups and enterprise organization ownership, rate limiting, TOTP MFA and revocable sessions, cryptographic IDs, generic 500s and security headers, scoped service tokens, creator-scoped workflows; Auth / Tenant RBAC / Platform / Webhooks / Tests / Git rows updated | H2, H3, H4, H10, H13, M4, M9, M10, M12, M13, L1, L2, L8, N2, N4, N5 | all 22 suites (741), `npm run type-check` (12, unchanged), `scripts/smoke-security.mjs` 19/19 and a live MFA lifecycle check on the final commit, independent security review and done-check (both findings lists addressed) |
| 2026-09-27 | Phase 0 containment (FX-00…FX-08): backdoors removed, secrets fail closed, per-purpose token audiences, HMAC-signed courier/payment webhooks, strict social ingress, real super-admin sign-in, invitation accept requires the account's password; Auth / Webhooks / Tests / Git rows updated | C1–C5, C8, H1, H5, H10, M14, N1, N6 | `npm test` (all suites pass), `npm run type-check` (12, unchanged), `scripts/smoke-security.mjs` against a throwaway dev server (16/16) |
| 2026-09-27 | `.agent/` governance restructured; STATUS.md created to replace PROJECT_STATE.md | I2 | — |

---

## 6. Known documentation gaps

- `DATA_MODEL.md` and `API_CONTRACTS.md` describe the target schema; the JSON store's actual shapes live in the `*Record` interfaces in `src/infrastructure/db/index.ts` and `src/types/*.ts`.
- `DEVOPS.md`, `SYSTEM_DESIGN.md`, `EVENT_ARCHITECTURE.md` are TARGET designs.
- `ROADMAP.md` phase "COMPLETED" markers mean "code written", not "LIVE" by the definitions above.
