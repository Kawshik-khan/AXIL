# CommerceOS — Current Status (Source of Truth)

**Last verified:** 2026-09-27 · **Evidence:** [`AUDIT_REPORT_2026-09-27.md`](../AUDIT_REPORT_2026-09-27.md) · **Remediation plan:** [`FIX_IMPLEMENTATION_PLAN.md`](../FIX_IMPLEMENTATION_PLAN.md)

> This file is the one place that says what **actually works**. Architecture docs in `.agent/` describe the
> **target** design. When a doc and this file disagree, this file wins for "what exists"; the doc wins for
> "what we are building toward". Never report a target-design capability as working unless this file says LIVE.

**Overall posture: NOT production-ready. Do not expose to any network.** Phase 0 containment (FX-00…FX-08, [ADR-103](DECISIONS.md#adr-103-fail-closed-authentication-secrets-and-webhook-signatures-phase-0-containment)) and Phase 1 access control (FX-10…FX-19, [ADR-104](DECISIONS.md#adr-104-access-control-and-integrity-phase-1)) are implemented on branch `phase-1-access-control` (2026-09-28). Remaining blockers before any network exposure: the JSON-file store (C6, C7, Phase 2/4), fabricated metrics and simulated integrations (H6–H9, H14, Phase 3), unenforced platform safety controls (H11) and N8.

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
| Persistence | Single JSON file `.data/commerceos.json` (~39 MB) via `src/infrastructure/db/index.ts`, whole-file sync write on every mutation | PostgreSQL (Neon) via repositories | PARTIAL — Neon client + `*.repository.ts` exist, **0% wired** (C6, C7) |
| Migrations | Forward-only `.sql` in `src/infrastructure/db/migrations/` (seed data mixed in) | Reversible numbered migrations | PARTIAL |
| Vectors / RAG | Pinecone client (`src/infrastructure/pinecone`) + in-process BM25; embeddings are fake | pgvector / Pinecone hybrid | SIMULATED (H14) |
| Cache / events | Upstash Redis REST client, largely unused; no Streams consumer groups, no Redlock | Redis Streams + PubSub + locks | TARGET |
| LLM | `src/domains/ai/providers/mock-llm.provider.ts` keyword mock | Multi-provider router | SIMULATED (H14) |
| Auth | jose JWTs (issuer + one audience per purpose) carrying a session version; bcrypt-only passwords; secrets fail closed; operator TOTP MFA (two-step sign-in, step-up with replay protection); per-account login rate limits; "sign out everywhere"; no implicit roles for platform staff; scoped service tokens for automations | Verified JWT, MFA, step-up | PARTIAL — workspace users have no MFA; rate limits are per process (one replica until FX-45); account-existence timing leaks (Low) |
| Tenant RBAC | `RbacService.assertCan` on every handler of the six previously unguarded domains (140 handlers, RBAC matrix test) plus the service-layer checks elsewhere; approvers come from the session; four-eyes on high-risk campaigns; id lookups are tenant-scoped; enterprise organizations belong to a workspace | Every route guarded | LIVE (API) — the dock and command palette hide modules a role can't use, but pages don't all show a 403 state yet; role review pending (FX-10 step 7) |
| Platform control plane | Services under `src/domains/platform/services/`; kill switches / flags / entitlements not enforced. Real operator sign-in with TOTP; step-up actions work once the operator sets up an authenticator; newly provisioned tenant owners cannot sign in yet (N8) | Enforced gates | PARTIAL (H11, N8) |
| Webhooks | Courier/payment: per-endpoint `?wh=` id, HMAC of `<timestamp>.<raw body>`, 300 s window, tenant from the webhook row, duplicates suppressed by a key from signed data, 600/min per endpoint. Social: per-entry channel resolution, Meta signature mandatory | HMAC + replay defense | PARTIAL — secrets are per provider, not per endpoint (Low); provider-native signature formats not built (Phase 5); n8n relays must add HMAC signing (import guide) |
| External integrations | Social send, courier booking, payment verification, connectors all stubbed but report success | Real adapters | SIMULATED (H9) |
| Analytics | Hard-coded baselines + 50-row truncation | Real aggregates | BROKEN (H6, H7) |
| Docker / deploy | No Dockerfile; `n8n/docker-compose.yml` only | Multi-stage image, readiness probe | TARGET (readiness probe always "ready", L3) |
| Lint | `npm run lint` has no ESLint config | Enforced lint | TARGET |
| Type-check | `npm run type-check` reports 12 errors, all in the unwired `customer.repository.ts` / `social.repository.ts` (H15); unchanged by Phases 0 and 1 | Zero errors | BROKEN |
| Tests | `npm test` → 22 custom suites, 729 tests, all pass: `security-regression-tests.ts` (46, Phase 0), `rbac-matrix-tests.ts` (287, Phase 1) and `phase1-integrity-tests.ts` (49, Phase 1) among them; `scripts/smoke-security.mjs` replays the exploits against a running server | Unit + integration + eval + E2E | PARTIAL — no E2E/UI tests, no load test (FX-63) |
| Agent evals | `src/domains/ai/eval/golden-dataset.ts` + `evaluation.service.ts`; no `test:eval` script | Gated eval suite | PARTIAL |
| Git | Local git repository: `main` (baseline) ← `phase-0-containment` ← `phase-1-access-control`; `.gitignore` keeps out env files, `.data/`, `.backups/` and generated seeds | Versioned, PR-reviewed | PARTIAL — no remote, no CI, branches not merged or tagged |

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

**Open from Phases 0 and 1:**
- **N6 (Medium, contained)** — Phase 0 stopped the public widget from sending visitor phone/email into identity resolution, so a visitor can no longer pose as a known customer. What's still missing:
  - a verified-contact design;
  - real placeholders instead of the made-up `+8801700…` phones given to customers who have none (FX-30).
- **N8 (Medium)** — `platform-tenant.service.ts` provisions the tenant owner as `INVITED` with a disabled password, and nothing lets them set one. Provisioned workspaces are unusable until an owner-setup flow exists (FX-37).
- **N3 (Low)** — `src/types/declarations.d.ts` shadows `@types/node` (hidden by `skipLibCheck`). Fold into FX-38.
- **Low:**
  - Timing and responses still reveal whether an account exists or is disabled: the `!disabled` hash short-circuits, tenant login has no dummy compare, and invitation accept answers differently.
  - Courier webhook secrets are per provider and shared across tenants, and the signature doesn't cover `wh`. Fix: per-endpoint secrets.
  - The website server-to-server HMAC has no timestamp.
  - `tests/connectors-tests.ts` contains a fake `npg_` string, so FX-00's literal grep matches it. No real credential is in the history.
- **Deferred from Phase 1** (see ADR-104 deviations):
  - Pages don't all render a 403 state (only navigation is filtered).
  - The role review with the product owner (FX-10 step 7) is pending.
  - Human-facing numbers (PO numbers, SKU suffixes) wait for FX-35 sequences.
  - Enterprise Developer API keys are neither wired nor removed (FX-18 step 6, decision D2).
  - Rate limits and step-up replay state are per process (one replica until FX-45).
  - Workspace users have no MFA.

**Next — Phase 2 (FX-20…FX-24):** coalesced persistence, pure GETs, the analytics truncation fix (C6, C7, H6, H8).
**Hardening:** C6, C7, H6–H9, H11, H12, H14, M1–M3, M11.
**Hygiene:** H15, M5–M8, M15–M17, L3–L7.

When you fix a finding: update the row in §2 (if the status changed), and add a line to §5.

---

## 5. Change log of status (newest first)

| Date | Change | Finding IDs | Verified by |
|---|---|---|---|
| 2026-09-28 | Phase 1 access control and integrity (FX-10…FX-19): RBAC on 140 handlers, payment verification rules, strict update schemas, tenant-scoped lookups and enterprise organization ownership, rate limiting, TOTP MFA and revocable sessions, cryptographic IDs, generic 500s and security headers, scoped service tokens, creator-scoped workflows; Auth / Tenant RBAC / Platform / Webhooks / Tests / Git rows updated | H2, H3, H4, H10, H13, M4, M9, M10, M12, M13, L1, L2, L8, N2, N4, N5 | all 22 suites (729), `npm run type-check` (12, unchanged), `scripts/smoke-security.mjs` |
| 2026-09-27 | Phase 0 containment (FX-00…FX-08): backdoors removed, secrets fail closed, per-purpose token audiences, HMAC-signed courier/payment webhooks, strict social ingress, real super-admin sign-in, invitation accept requires the account's password; Auth / Webhooks / Tests / Git rows updated | C1–C5, C8, H1, H5, H10, M14, N1, N6 | `npm test` (all suites pass), `npm run type-check` (12, unchanged), `scripts/smoke-security.mjs` against a throwaway dev server (16/16) |
| 2026-09-27 | `.agent/` governance restructured; STATUS.md created to replace PROJECT_STATE.md | I2 | — |

---

## 6. Known documentation gaps

- `DATA_MODEL.md` and `API_CONTRACTS.md` describe the target schema; the JSON store's actual shapes live in the `*Record` interfaces in `src/infrastructure/db/index.ts` and `src/types/*.ts`.
- `DEVOPS.md`, `SYSTEM_DESIGN.md`, `EVENT_ARCHITECTURE.md` are TARGET designs.
- `ROADMAP.md` phase "COMPLETED" markers mean "code written", not "LIVE" by the definitions above.
