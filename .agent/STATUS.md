# CommerceOS — Current Status (Source of Truth)

**Last verified:** 2026-09-27 · **Evidence:** [`AUDIT_REPORT_2026-09-27.md`](../AUDIT_REPORT_2026-09-27.md) · **Remediation plan:** [`FIX_IMPLEMENTATION_PLAN.md`](../FIX_IMPLEMENTATION_PLAN.md)

> This file is the one place that says what **actually works**. Architecture docs in `.agent/` describe the
> **target** design. When a doc and this file disagree, this file wins for "what exists"; the doc wins for
> "what we are building toward". Never report a target-design capability as working unless this file says LIVE.

**Overall posture: NOT production-ready. Do not expose to any network.** Phase 0 containment (FX-00…FX-08, [ADR-103](DECISIONS.md#adr-103-fail-closed-authentication-secrets-and-webhook-signatures-phase-0-containment)) is implemented on branch `phase-0-containment` (2026-09-27). It closes the unauthenticated exploits C1–C4, C8, H1 and H5, and contains H10. Still open, and Phase 1 (FX-10…FX-19) is next: missing RBAC (H2), payment verification (H3), mass assignment (H4), IDOR (H13), no rate limiting and no MFA.

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
| Auth | jose JWTs with issuer + one audience per purpose; bcrypt-only password checks; `JWT_SECRET` / `CREDENTIALS_ENCRYPTION_KEY` fail closed (no defaults); dev bypass only with `DEV_AUTH_BYPASS=1` and no token; platform role read from the stored membership; step-up returns 501 | Verified JWT, MFA, step-up | PARTIAL — backdoors removed (C1–C3, C8, H1, N1; ADR-103). No MFA/TOTP (FX-15), no rate limiting (FX-14); a workspace admin can change a member's global account status (N5) |
| Tenant RBAC | `RbacService.assertCan` exists; ~100 mutation routes skip it | Every route guarded | PARTIAL (H2, H13) |
| Platform control plane | Services under `src/domains/platform/services/`; kill switches / flags / entitlements not enforced | Enforced gates | PARTIAL (H11) |
| Webhooks | Courier/payment: per-endpoint `?wh=` id, HMAC of `<timestamp>.<raw body>`, 300 s window, tenant from the webhook row. Social: strict channel resolution, Meta signature mandatory, verify token only from env | HMAC + replay defense | PARTIAL — C4 and H5 closed. Gateway event-id dedup never completes its lock (N2); provider-native signature formats not built (Phase 5); n8n relay workflows don't sign yet, so they get 401 (FX-18) |
| External integrations | Social send, courier booking, payment verification, connectors all stubbed but report success | Real adapters | SIMULATED (H9) |
| Analytics | Hard-coded baselines + 50-row truncation | Real aggregates | BROKEN (H6, H7) |
| Docker / deploy | No Dockerfile; `n8n/docker-compose.yml` only | Multi-stage image, readiness probe | TARGET (readiness probe always "ready", L3) |
| Lint | `npm run lint` has no ESLint config | Enforced lint | TARGET |
| Type-check | `npm run type-check` reports 12 errors, all in the unwired `customer.repository.ts` / `social.repository.ts` (H15); unchanged by Phase 0 | Zero errors | BROKEN |
| Tests | `npm test` → 20 custom suites, 387 tests, all pass. `tests/security-regression-tests.ts` (40 tests) covers the Phase 0 exploits; `scripts/smoke-security.mjs` replays them against a running server | Unit + integration + eval + E2E | PARTIAL — no RBAC-matrix, IDOR or E2E tests yet (FX-61) |
| Agent evals | `src/domains/ai/eval/golden-dataset.ts` + `evaluation.service.ts`; no `test:eval` script | Gated eval suite | PARTIAL |
| Git | Local git repository (branch `phase-0-containment`); `.gitignore` keeps out env files, `.data/`, `.backups/` and generated seeds | Versioned, PR-reviewed | PARTIAL — no remote, no CI |

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
- N1 (found during Phase 0): `POST /api/v1/invitations/[token]` signed in an *existing* account without its password. Anyone who can create an invitation, including a self-registered workspace owner, could mint a session for any existing email. The route now requires that account's password.
- H10 is contained: step-up fails closed and no session claims MFA. Real TOTP is FX-15.
- C5 is closed in the repository: `.env.example` has placeholders only, and `.gitignore` is in place. **The owner must still rotate the Neon database password that was in `.env.example`.**

**Phase 1, next (FIX_IMPLEMENTATION_PLAN FX-10…FX-19):** H2, H3, H4, H13, rate limiting (FX-14), TOTP and session hygiene (FX-15), n8n machine credentials (FX-18).

**New findings (found during Phase 0, not fixed yet):**
- **N5 (High)** — `PATCH /api/v1/users/[id]` with `status` changes the member's *global* account (`users.status`), not their membership in this workspace. `status` is also unvalidated. Any workspace admin can therefore suspend or deactivate a member everywhere, including a platform operator such as the seeded `superadmin@`, who is a member of `ten_default_dhaka`. Fix in Phase 1 with FX-10/FX-12: add a per-membership status and validate with Zod.
- **N2 (Medium)** — Webhook gateway replay check (`webhook-gateway.service.ts`, step 4): the idempotency lock is acquired but never marked completed, so a repeated event id is not suppressed at the gateway. Signatures now bind the timestamp, so a replay only works within 300 s, and courier sync has its own idempotency. Fix with FX-18 / FX-35.
- **N3 (Low)** — `src/types/declarations.d.ts` declares a minimal global `process` and `fs` / `path` stubs that shadow `@types/node`; `skipLibCheck` hides it. Fold into FX-38.
- **N4 (Low)** — `platform-user.service.ts` stores `mfa_enabled: true` by default and the seed marks operators MFA-enabled, although no MFA exists. Phase 0 no longer displays or trusts the flag. Fix with FX-15.

**Hardening:** C6, C7, H6–H9, H11–H14, M1–M3, M11, M13.
**Hygiene:** H15, M4–M10, M12, M15–M17, L1–L8.

When you fix a finding: update the row in §2 (if the status changed), and add a line to §5.

---

## 5. Change log of status (newest first)

| Date | Change | Finding IDs | Verified by |
|---|---|---|---|
| 2026-09-27 | Phase 0 containment (FX-00…FX-08): backdoors removed, secrets fail closed, per-purpose token audiences, HMAC-signed courier/payment webhooks, strict social ingress, real super-admin sign-in, invitation accept requires the account's password; Auth / Webhooks / Tests / Git rows updated | C1–C5, C8, H1, H5, H10, M14, N1 | `npm test` (all suites pass), `npm run type-check` (12, unchanged), `scripts/smoke-security.mjs` against a throwaway dev server (16/16) |
| 2026-09-27 | `.agent/` governance restructured; STATUS.md created to replace PROJECT_STATE.md | I2 | — |

---

## 6. Known documentation gaps

- `DATA_MODEL.md` and `API_CONTRACTS.md` describe the target schema; the JSON store's actual shapes live in the `*Record` interfaces in `src/infrastructure/db/index.ts` and `src/types/*.ts`.
- `DEVOPS.md`, `SYSTEM_DESIGN.md`, `EVENT_ARCHITECTURE.md` are TARGET designs.
- `ROADMAP.md` phase "COMPLETED" markers mean "code written", not "LIVE" by the definitions above.
