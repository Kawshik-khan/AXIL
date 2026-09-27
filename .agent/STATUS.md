# CommerceOS — Current Status (Source of Truth)

**Last verified:** 2026-09-27 · **Evidence:** [`AUDIT_REPORT_2026-09-27.md`](../AUDIT_REPORT_2026-09-27.md) · **Remediation plan:** [`FIX_IMPLEMENTATION_PLAN.md`](../FIX_IMPLEMENTATION_PLAN.md)

> This file is the one place that says what **actually works**. Architecture docs in `.agent/` describe the
> **target** design. When a doc and this file disagree, this file wins for "what exists"; the doc wins for
> "what we are building toward". Never report a target-design capability as working unless this file says LIVE.

**Overall posture: NOT production-ready. Do not expose to any network.** Phase 0 security fixes (FX-01…FX-10) come before any feature work.

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
| Auth | jose JWT + bcrypt, **with backdoors** (master passwords, public default secret, `x-test-platform-role` header, dev OWNER fallback, fake step-up) | Verified JWT, MFA, step-up | BROKEN (C1–C3, C8, H1, H10) |
| Tenant RBAC | `RbacService.assertCan` exists; ~100 mutation routes skip it | Every route guarded | PARTIAL (H2, H13) |
| Platform control plane | Services under `src/domains/platform/services/`; kill switches / flags / entitlements not enforced | Enforced gates | PARTIAL (H11) |
| Webhooks | Courier/payment/social ingress accepts unsigned requests | HMAC + replay defense | BROKEN (C4, H5) |
| External integrations | Social send, courier booking, payment verification, connectors all stubbed but report success | Real adapters | SIMULATED (H9) |
| Analytics | Hard-coded baselines + 50-row truncation | Real aggregates | BROKEN (H6, H7) |
| Docker / deploy | No Dockerfile; `n8n/docker-compose.yml` only | Multi-stage image, readiness probe | TARGET (readiness probe always "ready", L3) |
| Lint | `npm run lint` has no ESLint config | Enforced lint | TARGET |
| Type-check | `npm run type-check` reports errors (H15) | Zero errors | BROKEN |
| Tests | `npm test` → 19 custom suites, all pass, **but cover none of the risky paths** (I1) | Unit + integration + eval + E2E | PARTIAL |
| Agent evals | `src/domains/ai/eval/golden-dataset.ts` + `evaluation.service.ts`; no `test:eval` script | Gated eval suite | PARTIAL |
| Git | **Project is not a git repository** | Versioned, PR-reviewed | TARGET |

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

**Phase 0 — ship together (see FIX_IMPLEMENTATION_PLAN §Phase 0):** C1, C2, C3, C4, C5, C8, H1, H3, H4, H10, H2.
**Hardening:** C6, C7, H5–H9, H11–H14, M1–M3, M11, M13.
**Hygiene:** H15, M4–M10, M12, M14–M17, L1–L8.

When you fix a finding: update the row in §2 (if the status changed), and add a line to §5.

---

## 5. Change log of status (newest first)

| Date | Change | Finding IDs | Verified by |
|---|---|---|---|
| 2026-09-27 | `.agent/` governance restructured; STATUS.md created to replace PROJECT_STATE.md | I2 | — |

---

## 6. Known documentation gaps

- `DATA_MODEL.md` and `API_CONTRACTS.md` describe the target schema; the JSON store's actual shapes live in the `*Record` interfaces in `src/infrastructure/db/index.ts` and `src/types/*.ts`.
- `DEVOPS.md`, `SYSTEM_DESIGN.md`, `EVENT_ARCHITECTURE.md` are TARGET designs.
- `ROADMAP.md` phase "COMPLETED" markers mean "code written", not "LIVE" by the definitions above.
