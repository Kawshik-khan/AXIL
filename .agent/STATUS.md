# CommerceOS — Current Status (Source of Truth)

**Last verified:** 2026-09-29 · **Evidence:** [`AUDIT_REPORT_2026-09-27.md`](../AUDIT_REPORT_2026-09-27.md) · **Remediation plan:** [`FIX_IMPLEMENTATION_PLAN.md`](../FIX_IMPLEMENTATION_PLAN.md)

> This file is the one place that says what **actually works**. Architecture docs in `.agent/` describe the
> **target** design. When a doc and this file disagree, this file wins for "what exists"; the doc wins for
> "what we are building toward". Never report a target-design capability as working unless this file says LIVE.

**Overall posture: NOT production-ready. Do not expose to any network.** Phase 0 containment (FX-00…FX-08, [ADR-103](DECISIONS.md#adr-103-fail-closed-authentication-secrets-and-webhook-signatures-phase-0-containment)) and Phase 1 access control (FX-10…FX-19, [ADR-104](DECISIONS.md#adr-104-access-control-and-integrity-phase-1)) are merged to `main` and tagged `release/phase-0` / `release/phase-1`. Phase 2 performance and read-path integrity (FX-20…FX-24, [ADR-105](DECISIONS.md#adr-105-coalesced-persistence-write-free-reads-and-complete-analytics-phase-2)) is merged to `main` and tagged `release/phase-2` (2026-09-28). Phase 3 (FX-30…FX-39, N11, N13–N15; [ADR-106](DECISIONS.md#adr-106-truthful-data-and-honest-integrations-phase-3), [ADR-107](DECISIONS.md#adr-107-enforced-safety-controls-one-order-writer-and-a-real-ai-provider-phase-3-completion)) is merged to `main` and tagged `release/phase-3` (2026-09-29). Phase 4, first stage ([ADR-108](DECISIONS.md#adr-108-postgres-as-the-system-of-record-behind-the-existing-store-api-phase-4-first-stage)) is on branch `phase-4-postgres`: Postgres can be the system of record (`DATA_BACKEND=pg`), tested on real Postgres (PGlite) and rehearsed on a Neon branch (`phase4-rehearsal`, since deleted: migrate, backfill of the real store, verification PASS, a live server on Postgres) but **not yet cut over**: production Neon is untouched and the app still uses the JSON file. Remaining blockers before any network exposure: the cutover itself (migrate, backfill, verify on production Neon) and one replica only until the async services of FX-45; integrations are honestly reported as not sent / not verified but none is built (Phase 5); four one-time data scripts must be run on existing stores (see §4).

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
| Persistence | **Two backends behind the same store API (ADR-108).** `DATA_BACKEND=pg`: Postgres (Neon) is the system of record — `ready()` takes a single-writer lease (`commerceos.store_writer`, fenced in every write transaction) and loads every table; each coalesced flush writes the changed and removed rows in one transaction; a refused row is set aside, kept in `commerceos.refused_rows` (survives restarts) and reported (`/health/ready` degraded) while every other write commits, and is retried after later commits; without a confirmed lease mutating requests get 503 before changing anything (after 15 s) and reads after 24 s, and a server that loses the lease exits. Default (unset): the single JSON file `.data/commerceos.json` via `src/infrastructure/db/index.ts`, as below. Mutations mark the store dirty; one coalesced async flush per `PERSIST_DEBOUNCE_MS` (250 ms) writes a temp file, fsyncs and renames it. Write failures are kept, retried and reported by `/health/ready`; stale temp files are quarantined at start; SIGTERM/SIGINT flush. A writer lock (`.data/commerceos.lock`) makes a second process, a second host or a seed script refuse to start; every flush first checks the lock still names this process; a blocked store answers writes with 503. Next.js helper processes (dev static-paths worker, build workers) load the store but never lock or write it. GET requests never write (sweep test over all 157 GET routes) | PostgreSQL (Neon) via repositories | PARTIAL — the Postgres backend passes every suite on PGlite (`npm run test:pg`) and was rehearsed end to end on a Neon branch (see §4), but is **not cut over** (the app still uses the JSON file); services are synchronous over an in-memory working set, so exactly one replica until FX-45; a crash loses at most the last debounce window. The legacy `*.repository.ts` files (drifted schema) stay unwired |
| Migrations | `006_align_domain_model.sql` (schema `commerceos`: core tables with constraints and tenant-scoped foreign keys, JSONB documents for the rest); runner applies each file whole in one transaction under an advisory lock (`npm run db:migrate`, or `--pglite <dir>` to rehearse). The drifted 001–005 and their seed data are in `migrations/legacy/` and no longer run | Reversible numbered migrations | PARTIAL — forward-only; 006 applied only to the `phase4-rehearsal` Neon branch, not to production |
| Vectors / RAG | Pinecone client (`src/infrastructure/pinecone`) + in-process BM25; embeddings come from the configured AI provider (`LLM_EMBEDDING_MODEL`), or the demo mock with `AI_DEMO_MODE=1` | pgvector / Pinecone hybrid | PARTIAL — real embeddings only with a provider configured; changing the embedding model needs a knowledge re-index |
| Cache / events | Upstash Redis REST client, largely unused; no Streams consumer groups, no Redlock | Redis Streams + PubSub + locks | TARGET |
| LLM | `ModelRouter.configure` (FX-32): an OpenAI-compatible provider from `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL_*` (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, vLLM) plus an optional second one; the keyword mock only with `AI_DEMO_MODE=1`, never as a fallback, labelled "Demo AI (offline)"; with neither, AI calls answer 424 `AI_PROVIDER_NOT_CONFIGURED`. `GET /api/v1/ai/status` reports LIVE / DEMO / NOT_CONFIGURED; usage is priced from reported tokens | Multi-provider router | PARTIAL — verified against a stubbed OpenAI-compatible server, not a live provider; Jev routing uses its offline rules only in demo mode (H14 closed) |
| Auth | jose JWTs (issuer + one audience per purpose) carrying a session version; bcrypt-only passwords; secrets fail closed; operator TOTP MFA (two-step sign-in, step-up with replay protection); per-account login rate limits; "sign out everywhere"; no implicit roles for platform staff; scoped service tokens for automations | Verified JWT, MFA, step-up | PARTIAL — workspace users have no MFA; rate limits are per process (one replica until FX-45); account-existence timing leaks (Low) |
| Tenant RBAC | `RbacService.assertCan` on every handler of the six previously unguarded domains (140 handlers, RBAC matrix test) plus the service-layer checks elsewhere; approvers come from the session; four-eyes on high-risk campaigns; id lookups are tenant-scoped; enterprise organizations belong to a workspace | Every route guarded | LIVE (API) — the dock and command palette hide modules a role can't use, but pages don't all show a 403 state yet; role review pending (FX-10 step 7) |
| Platform control plane | Services under `src/domains/platform/services/`. Enforced (FX-34, `src/lib/safety-gate.ts`): GLOBAL/TENANT kill switches stop every non-GET request (503), CHANNEL/WORKFLOW/PROVIDER switches stop sends, automations and AI calls; plan limits on users, products (incl. bulk import) and channels count what exists (403 `PLAN_LIMIT_REACHED`), `ai_monthly_runs` counts agent runs; feature flags (global, allow-list, deterministic % rollout) gate `/autonomous`, `/enterprise`, their AI tools and outbound messaging; the autonomous emergency halt stops cycles and decision execution. Support impersonation is real and read-only: an httpOnly cookie honoured only with the same operator's platform session and a live session record, `*.read` permissions only, re-checked every request, banner with "End session". Provisioned owners set their password with a one-time setup link (N8 closed) | Enforced gates | LIVE (H11 closed) — `MUTATION_APPROVED` support sessions are refused until two-operator approval exists |
| Webhooks | Courier/payment: per-endpoint `?wh=` id, HMAC of `<timestamp>.<raw body>`, 300 s window, tenant from the webhook row, duplicates suppressed by a key from signed data, 600/min per endpoint. Social: per-entry channel resolution, Meta signature mandatory | HMAC + replay defense | PARTIAL — secrets are per provider, not per endpoint (Low); provider-native signature formats not built (Phase 5); n8n relays must add HMAC signing (import guide) |
| External integrations | Nothing external reports success it didn't achieve (FX-31): social replies (Facebook, Instagram, WhatsApp, website chat) fail with `INTEGRATION_NOT_CONFIGURED` and are recorded FAILED after one attempt; marketing sends are `CHANNEL_NOT_CONNECTED`; shipments are booked manually with the courier's tracking number (`booking_mode: MANUAL`) and courier failover refuses; connector tests are `NOT_VERIFIED` except OpenAI, DeepSeek, Groq and OpenRouter, which get a real key check against their own public endpoint; enterprise integrations are saved `NOT_VERIFIED` with encrypted credentials, their test says `SIMULATED` and their sync answers 424; enterprise webhook dispatch records `NOT_SENT`; n8n is called only when an instance or `N8N_HOST` is configured (otherwise 424 `N8N_NOT_CONFIGURED`). Social channels still receive messages (inbound webhooks), shown as "Receiving only" | Real adapters | NOT BUILT — honestly labelled (H9 closed); real adapters are Phase 5 |
| Analytics | Analytics, intelligence, growth, enterprise and operations services read every row (`getAllOrders` / `getAllCustomers` / `getAllProducts`); paged reads require an explicit limit. Intelligence GETs serve a snapshot stored by `POST /api/v1/intelligence/recompute` (fresh for 15 min) or compute in memory, in O(n) | Real aggregates | LIVE on the JSON store — no fabricated figures (FX-30, FX-39, H7 closed): unknown values are `null` / "—" / `NOT_MEASURED`; period changes come from the previous window; RTO tiers need 20+ shipments; unattributed orders are `UNATTRIBUTED`; COGS falls back to 42% of price only where a product has no cost, and the share of estimated cost is reported. The Command Center reads only the workspace's own data. Enterprise per-store/brand figures are `NOT_MEASURED` because orders carry no store. No scheduled recompute. The demo workspace's seed data still contains fixed demo values |
| Docker / deploy | No Dockerfile; `n8n/docker-compose.yml` only. `/health/ready` reports persistence health and writer-lock / lease ownership, plus data-dir writability (JSON) or a Postgres ping (at most every 5 s); 503 when unsafe, `degraded` (200) when only refused rows are unsaved | Multi-stage image, readiness probe | TARGET — deployment constraint: one replica, `Recreate` updates (DEVOPS.md) |
| Lint | `npm run lint` has no ESLint config | Enforced lint | TARGET |
| Type-check / build | `npm run type-check` reports 0 errors (FX-38 removed the dead repositories; `declarations.d.ts` no longer shadows Next.js types); `next build` exits 0 (230 pages) | Zero errors, build passes | LIVE (H15 closed) |
| Tests | `npm test` → 27 custom suites, 855 tests, all pass (suites use the demo AI and never a live model unless `TEST_LLM_LIVE=1`, and never a database from the local env); `npm run test:pg` runs all 27 with the store persisted to in-memory Postgres (PGlite) and reloads each store record by record — all identical. `phase4-postgres-tests.ts` (30, Phase 4: migrations, the Postgres store, lease and fencing, refused rows, backfill / verify / export and the scripts end to end on temporary data), `phase3-truthfulness-tests.ts` (54, Phase 3: enterprise scoping, honest integrations, order lifecycle, safety controls, impersonation, invitations, AI provider, and a grep gate for known fabrication patterns and stray order-status writers), `security-regression-tests.ts` (46, Phase 0), `rbac-matrix-tests.ts` (287, Phase 1), `phase1-integrity-tests.ts` (61, Phase 1 + review fixes), `persistence-tests.ts` (8, real store in child processes), `phase2-analytics-tests.ts` (6) and `phase2-readonly-tests.ts` (14; sweeps all 141 tenant and 16 platform GET routes for store changes and write requests) among them; `scripts/smoke-security.mjs` replays the exploits against a running server | Unit + integration + eval + E2E | PARTIAL — no E2E/UI tests, no load test (FX-63) |
| Agent evals | `src/domains/ai/eval/golden-dataset.ts` + `evaluation.service.ts`; no `test:eval` script | Gated eval suite | PARTIAL |
| Git | Local git repository: `main` = Phase 3 (tags `release/phase-0` … `release/phase-3`); Phase 4 first stage on `phase-4-postgres`, not merged; `.gitignore` keeps out env files, `.data/`, `.backups/` and generated seeds | Versioned, PR-reviewed | PARTIAL — no remote, no CI |

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

**Closed by Phase 3 (2026-09-28, ADR-106):**
- H7 (fabricated metrics), H9 (stubbed integrations reported as successful), N11 (enterprise routes built a synthetic all-access admin), FX-39 (Command Center showed another dataset's numbers and fake customers).
- Also fixed in Phase 3:
  - `analytics-query`, sales intelligence and others summed the nonexistent `total_amount`, so revenue read 0;
  - product return rates used the workspace's total returns for every product; growth recommendations and offers carried fixed projected revenue;
  - enterprise benchmarks, consolidated analytics and the finance store breakdown split revenue by list position or fixed shares (45/35/12/8% by channel, 65/20/10/5% by region);
  - the order-status tool named "Steadfast Courier" / "STF-2026-PENDING" for orders without a shipment; the shipping tool named couriers and turned a free-delivery setting of 0 into ৳60;
  - the Automations page showed fixed CONNECTED badges for n8n, Steadfast, Pathao and bKash; automation health filled untracked providers in as HEALTHY; autonomous health cards showed a literal "99.9%" / "142ms";
  - identity resolution invented `+8801700…` phones;
  - continuous learning could promote a candidate on made-up evaluation results.
- Security review of Phase 3 (2026-09-28), all fixed with tests:
  - enterprise integration credentials were base64 (not encrypted) and returned by the list endpoint and the AI integration-status tool (Medium);
  - enterprise webhook listings returned signing secrets;
  - the enterprise overview showed workspace-wide revenue to store-scoped members, and fell back to a made-up organization;
  - the autonomous unified context counted every tenant's stores, brands, integrations and incidents;
  - `POST /shipments` had no body schema (a numeric tracking number was a 500);
  - `/connectors/test` now makes live key checks, so it needs `settings.update` and is limited to 10 per minute per workspace;
  - n8n fell back to `http://localhost:5678` and returned fetch errors naming internal hosts to tenants.

**Closed by the rest of Phase 3 (2026-09-29, ADR-107):**
- H11 (safety controls enforced), H12 + M2 + M3 (one order-status writer; reservation expiry; order numbers from a per-tenant counter), H14 (a real AI provider or a labelled demo), H15 (0 type errors; build passes), M1 (broken endpoints), M5 / M6 / M11 / M15 / M16 (data entry), N3, N8 (owner setup), N12, N13, N14 (script), N15; the demo seed's fixed telemetry and the literal delivery fees.
- Security review and done-check of this round, all fixed with tests:
  - a support operator could grant themselves `MUTATION_APPROVED`, act as OWNER and invite themselves (High): refused until two-operator approval exists; identity permissions are never available to support sessions;
  - support sessions now re-check the operator's permission and the target's status every request, and write a row to the workspace audit log for changes;
  - `GET /users` returned every pending invitation token to anyone with `user.read`; tokens are shown once, to the invitation's creator;
  - bulk import skipped the product limit; flagged modules' AI tools ran through `/ai`; the provider kill switch missed the fallback and embeddings; a shipment update could deliver an order (and mark COD paid) without `orders.update`;
  - product creation and bulk import put stock into *another tenant's* warehouse when the workspace had none;
  - AI prompts and the checkout tool used literal ৳60/৳120 fees and an invented ৳1200 "DEMO-SKU" line; Jev routing silently answered from a mock.
- **One-time data scripts for existing stores** (dry run by default, back up first, refuse while the app runs): `scripts/reencrypt-integration-credentials.ts` (N14), `scripts/clear-demo-telemetry.ts` (seeded health/SLO/courier/provider/model figures), `scripts/fix-warehouse-tenancy.ts` (M11), `scripts/fix-fabricated-data.ts` (M5, M15). Not yet run on the real `.data` store.

**Phase 4, first stage (2026-09-29, ADR-108):**
- Built: the Postgres backend (FX-40/42/44 in staged form), migration 006 and the new runner (FX-41), backfill / verification / export (FX-43). M8 closed (`withTransaction` no longer re-runs a failed transaction over HTTP; `execute` reports changed rows).
- Found by running every suite on Postgres, all fixed with tests: 55 record ids built from the clock alone collided within a millisecond; `adjustStock` created stock for another workspace's variant or warehouse (with that workspace's row id); the seed gave the super-admin a membership in a workspace that may not exist; fixtures without parent rows.
- Done-check, fixed with tests: a 503 from the lease fence left the change in memory and saved it later (a retry would duplicate it); a child row refused because of its parent was never retried and was lost on restart (now quarantined in `commerceos.refused_rows` and retried); no error listener on the Neon pool; a refused stock adjustment left an empty row.
- Security review (no Critical or High), all fixed with tests: acknowledged writes during a database outage and stale reads after a takeover (Medium); the unauthenticated readiness probe queried the database on every hit (Medium); default warehouse ids were truncated tenant ids, so workspaces could collide (Medium); tenant-changing upserts, blank numeric settings, backfill/verify locking and seeding the JSON source, dry runs holding the lease, a misleading backfill failure message, world-readable backups/exports, and blanked test variables refilled from the local env (Low).
- **Neon rehearsal (2026-09-29, branch `phase4-rehearsal` of project CommerceOS, created from `production`, which held no application tables; the branch was deleted afterwards):** migration 006 applied in 4 s; the backfill dry run of the real store found nothing to fix (56,375 records, 221 collections, no refused or unstorable rows, no text cleaned); `--apply` wrote everything in one transaction in 64 s; verification PASS (counts per tenant, SQL sums of order totals and stock, sequences, all 56,375 records deep-equal), also via `npm run db:verify-migration` (91 s). A throwaway `next dev` with `DATA_BACKEND=pg` loaded the store from Neon in ~25 s, took the lease and answered `/health/ready` ready; the unauthenticated exploit replay passed 16/16; a new test workspace, product (stock 10) and order were written and confirmed in Neon (stock 10 on hand / 2 reserved, order, item, reservation, sequence 1, no refused rows). Found and fixed: the lease wasn't renewed while a large store loaded, so a load longer than 80% of the lease tripped the store's own fence and start-up looped and exited (renewal now starts before the load; regression test).
- **Not done / open:**
  - The cutover on production Neon: `npm run db:migrate`, `npm run db:backfill` (dry run, then `--apply`), `npm run db:verify-migration`, then `DATA_BACKEND=pg`. Rehearsed on a branch (below); production is untouched.
  - FX-45: services still read memory, so exactly one replica; SQL-level reservation and order-number statements, rate limits in Redis, and removing the JSON path come with the async services.
  - The legacy public-schema tables from 001–005 remain in Neon (unused); drop them with a later migration once the cutover is done.
  - The seed scripts (`db:seed:*`) write the JSON file only; they refuse with `DATA_BACKEND=pg` (seed before the cutover or backfill afterwards). The converted maintenance scripts are tested on the JSON file only, not on Postgres.
  - FX-44's generic `DocumentStore<T>` API is not built (the documents table is; see ADR-108).
  - Only unauthenticated checks and a fresh test workspace ran against the Postgres-backed server: the real accounts' passwords weren't used, so the signed-in smoke checks ran on the JSON backend only.
  - Store scripts in `scripts/` are not covered by `npm run type-check` (tsconfig includes `src/` only); some older scripts have type errors (seed-growth-intelligence, test-live-jev, verify-analytics).

**Open from Phases 0 and 1:**
- **N6 (Medium, contained)** — Phase 0 stopped the public widget from sending visitor phone/email into identity resolution, so a visitor can no longer pose as a known customer. Phase 3 stopped inventing `+8801700…` phones for customers who have none (they're stored with an empty phone). Still missing: a verified-contact design.
- **Low:**
  - Invitation accept still answers differently for new and existing emails.
  - Courier webhook secrets are per provider and shared across tenants, and the signature doesn't cover `wh`. Fix: per-endpoint secrets.
  - The website server-to-server HMAC has no timestamp.
  - `tests/connectors-tests.ts` contains a fake `npg_` string, so FX-00's literal grep matches it. No real credential is in the history.
- **Found during Phase 2, open:**
  - `approveDecision` doesn't check the approval's expiry, and proposing a recommendation twice creates two approvals (Low).
  - The AI order tools now find any order by number. Before a customer-facing channel uses them, they must check the order belongs to that customer.
  - Lock identity is pid + host name + start time. Containers sharing a host name and pid namespace ids could still collide; the per-flush lock check limits the damage (Low). The Postgres backend's lease uses a random owner id and a heartbeat, which closes this after the cutover.
- **Found during Phase 3, open:**
  - Orders carry no store or brand, so enterprise per-entity figures stay `NOT_MEASURED` until orders are attributed.
  - The website widget has no way to receive replies (needs a secure polling endpoint, Phase 5).
  - Autonomous cycles are recorded at their first step; no worker executes their steps yet (the endpoint says so).
  - Support sessions can't change anything until a two-operator approval exists for `MUTATION_APPROVED`.
  - Courier status webhooks still update orders while a tenant kill switch is on (they report what already happened); decide whether to queue them instead.
  - The dead Neon `order.repository.ts` still writes order status directly (unwired; superseded by the Postgres store, to be removed with FX-45); campaigns are kill-switched by channel type because they carry no channel id; report definitions store an `all_access` label (execution uses the caller's scope) (Low).
  - The AI provider is verified against a stubbed server only; run one real provider (e.g. Ollama or OpenAI) before relying on it.
- **Deferred from Phase 2** (see ADR-105 deviations):
  - No scheduled recompute: snapshots are stored only by `POST /api/v1/intelligence/recompute`, workflows and the intelligence agent. Stale reads compute in memory instead.
  - The sweep calls 7 of the 24 tenant `[id]` GET routes only with ids that don't exist (no matching rows in its seed data), and sweeps query-parameter branches only for `ai/agents?view=` and `enterprise/metrics?metric_key=`.
  - `getDashboardMetrics` still scans each collection once per call (accepted until Phase 4).
  - Graceful-shutdown flush is untested on Windows (no SIGTERM delivery there).
- **Deferred from Phase 1** (see ADR-104 deviations):
  - Pages don't all render a 403 state (only navigation is filtered).
  - The role review with the product owner (FX-10 step 7) is pending.
  - Order numbers come from a per-tenant counter (FX-35); PO numbers and SKU suffixes still don't.
  - Enterprise Developer API keys are neither wired nor removed (FX-18 step 6, decision D2).
  - Rate limits and step-up replay state are per process (one replica until FX-45).
  - Workspace users have no MFA.
  - A role change doesn't revoke sessions; it takes effect on the next request anyway, because the role is re-read.
  - Authenticator setup shows the key and `otpauth://` link, not a QR code (no new dependency).
  - Step-up tokens aren't tied to one action.
  - The widget's 300-per-minute per-channel cap can be filled by one visitor rotating ids. It's a spam backstop; without a trusted proxy there's no client address to key on.

**Next:** run the four data scripts on the real store (stop the app first); then the Postgres cutover on production (ADR-108: migrate → backfill dry run → apply → verify → `DATA_BACKEND=pg`; rehearsed on the `phase4-rehearsal` branch, since deleted); then FX-45.
**Hardening:** two-operator approval for mutating support sessions; the Postgres cutover closes C7 for one replica, FX-45 for several.
**Hygiene:** M17, L4–L7.

When you fix a finding: update the row in §2 (if the status changed), and add a line to §5.

---

## 5. Change log of status (newest first)

| Date | Change | Finding IDs | Verified by |
|---|---|---|---|
| 2026-09-29 | Phase 4, first stage (FX-40…FX-44, staged; ADR-108): Postgres backend behind the store API (lease + fencing, one transaction per flush, refused rows set aside), migration 006 and a whole-file migration runner (legacy 001–005 retired), backfill / verification / export scripts, `npm run test:pg`; Persistence / Migrations / Docker / Tests / Git rows updated | M8 (+ 55 colliding ids, cross-tenant stock rows, a dangling seed membership; security review 3 Medium + 7 Low) | all 27 suites on JSON (855) and all 27 on PGlite with an identical reload; `npx tsc --noEmit` 0; `next build` exit 0 (230 pages, instrumentation hook); live on a throwaway server (JSON backend): `/health/ready` ready, `scripts/smoke-security.mjs` 19/19, 12 Phase 3 follow-up checks; scripts end to end on temporary data (migrate, dry run, apply, verify PASS, export equal, JSON file untouched); security review, all findings fixed with tests. rehearsed on a Neon branch: migrate, backfill (56,375 records, one transaction, 64 s), verification PASS, a live `DATA_BACKEND=pg` server (ready, 16/16 unauthenticated replay, writes confirmed in Neon). **Not cut over; production Neon untouched** |
| 2026-09-29 | Rest of Phase 3 (FX-32…FX-38) and the open Phase 3 findings: N13–N15, demo seed telemetry, real districts and delivery fees, broken endpoints, invitations and owner setup, data entry, one order-status writer with reservation expiry and order sequences, enforced kill switches / plan limits / feature flags / autonomous halt, real read-only support impersonation, a real OpenAI-compatible AI provider with an honest demo label, dead code removed; LLM / Vectors / Platform control plane / Type-check / Tests rows updated | H11, H12, H14, H15, M1, M2, M3, M5, M6, M11, M15, M16, N3, N8, N12, N13, N14, N15 | all 26 suites (825), `npx tsc --noEmit` (0, was 12), `next build` exit 0 (230 pages) on the final commit; live on a throwaway server: `scripts/smoke-security.mjs` 19/19, 15 Phase 3 checks and 12 follow-up checks (AI status DEMO, fees from settings, unknown district 400, Sylhet order derived and charged the outside-Dhaka fee, illegal jump 409, invite link shown once and never listed, invite page, no seeded health, strict objectives, cycle endpoint), orders district picker and AI badge rendered; N14 migration run end-to-end on a temporary store; security review (1 High, 3 Medium, 5 Low) and done-check, all fixed with tests or listed as open |
| 2026-09-28 | Phase 3 truthful data and wiring (FX-30, FX-31, FX-39, N11): fabricated metrics removed across analytics, intelligence, growth, marketing, enterprise, autonomous and super-admin; Command Center built from the workspace's own data; integrations report NOT_SENT / NOT_VERIFIED / SIMULATED; enterprise reads use the caller's real membership and scope; External integrations / Analytics / Tests / Git rows updated | H7, H9, N11 (+ security-review fixes; N13–N15 opened) | all 26 suites (788), `npm run type-check` (12, unchanged); live on a throwaway server: `scripts/smoke-security.mjs` 19/19, 15 Phase 3 API checks (integration install NOT_VERIFIED without credentials, sync 424, benchmarks NOT_MEASURED, shipment without tracking 400, connector NOT_VERIFIED, no known fabricated literals), Command Center, benchmarks, integrations, automations and autonomous health pages rendered from real data; security review and done-check, findings fixed or listed as open |
| 2026-09-28 | Phase 2 performance and read-path integrity (FX-20…FX-24): coalesced async persistence with surfaced errors, writer lock and real readiness; analytics read every row; write-free GETs with snapshot reads and an explicit recompute; O(n) hot spots; N9/N10 fixed; Persistence / Analytics / Docker / Tests / Git rows updated | C6, C7 (contained), H6, H8, M7, L3, N9, N10 | all 25 suites (769), `npm run type-check` (12, unchanged); live on a throwaway server seeded with 10,000 customers / 5,000 orders: 92 UI GETs left the store file unchanged, intelligence GETs ≤ 0.6 s cold, recompute idempotent and rate-limited (200, 200, 429), a second dev server on the same data refused to start, `scripts/smoke-security.mjs` 19/19; security review + re-review and done-check, all findings addressed or listed as open |
| 2026-09-28 | Phase 1 access control and integrity (FX-10…FX-19): RBAC on 140 handlers, payment verification rules, strict update schemas, tenant-scoped lookups and enterprise organization ownership, rate limiting, TOTP MFA and revocable sessions, cryptographic IDs, generic 500s and security headers, scoped service tokens, creator-scoped workflows; Auth / Tenant RBAC / Platform / Webhooks / Tests / Git rows updated | H2, H3, H4, H10, H13, M4, M9, M10, M12, M13, L1, L2, L8, N2, N4, N5 | all 22 suites (741), `npm run type-check` (12, unchanged), `scripts/smoke-security.mjs` 19/19 and a live MFA lifecycle check on the final commit, independent security review and done-check (both findings lists addressed) |
| 2026-09-27 | Phase 0 containment (FX-00…FX-08): backdoors removed, secrets fail closed, per-purpose token audiences, HMAC-signed courier/payment webhooks, strict social ingress, real super-admin sign-in, invitation accept requires the account's password; Auth / Webhooks / Tests / Git rows updated | C1–C5, C8, H1, H5, H10, M14, N1, N6 | `npm test` (all suites pass), `npm run type-check` (12, unchanged), `scripts/smoke-security.mjs` against a throwaway dev server (16/16) |
| 2026-09-27 | `.agent/` governance restructured; STATUS.md created to replace PROJECT_STATE.md | I2 | — |

---

## 6. Known documentation gaps

- `DATA_MODEL.md` and `API_CONTRACTS.md` describe the target schema; the JSON store's actual shapes live in the `*Record` interfaces in `src/infrastructure/db/index.ts` and `src/types/*.ts`.
- `DEVOPS.md`, `SYSTEM_DESIGN.md`, `EVENT_ARCHITECTURE.md` are TARGET designs.
- `ROADMAP.md` phase "COMPLETED" markers mean "code written", not "LIVE" by the definitions above.
