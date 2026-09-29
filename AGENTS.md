# CommerceOS — Agent Entry Point

Multi-tenant agentic e-commerce OS for Bangladeshi commerce (web, Facebook, Instagram, WhatsApp).
Next.js 14 App Router · React 18 · TypeScript (strict) · Zod · jose/bcryptjs · Neon · Pinecone · Upstash Redis · n8n.

## 1. Read this first

- **The system is not production-ready.** [`.agent/STATUS.md`](.agent/STATUS.md) is the only source of truth for what works.
  Other `.agent/*` architecture docs describe the **target** design. Never claim a documented capability exists unless STATUS says LIVE.
- **Security remediation comes first.** Open findings are in `AUDIT_REPORT_2026-09-27.md` (IDs like C1, H4) and the
  step-by-step fixes in `FIX_IMPLEMENTATION_PLAN.md` (items `FX-nn`). Phase 0 items must ship together.
- Invariants, the 11 assessment questions, and the Definition of Done: [`.agent/GOVERNANCE.md`](.agent/GOVERNANCE.md).

## 2. Commands

| Purpose | Command | Notes |
|---|---|---|
| Dev server | `npm run dev` | http://localhost:3000. Needs `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` in `.env.local`: two different random values, 32+ chars each. AI needs `LLM_BASE_URL` (+ `LLM_API_KEY`) or `AI_DEMO_MODE=1`. `DEV_AUTH_BYPASS=1` is an opt-in for token-less local browsing and is logged. |
| Type-check | `npm run type-check` | 0 errors since FX-38; keep it at 0. `next build` also passes. |
| All tests | `npm test` | 27 custom suites via `tests/ts-runner.cjs`; the security, RBAC-matrix, Phase 1 integrity, Phase 2 persistence / analytics / read-only, Phase 3 truthfulness and Phase 4 Postgres suites run first; suites use the demo AI unless `TEST_LLM_LIVE=1`. `&&` stops at the first failing suite, so run a suite on its own to see everything |
| One suite | `node tests/ts-runner.cjs ./tests/<name>-tests.ts` | e.g. `security-regression-tests.ts`, `commerce-tests.ts` |
| Suites on Postgres | `npm run test:pg` | Every suite with the store persisted to in-memory PGlite (no server, no network), then reloaded and compared record by record. One suite: `COMMERCEOS_TEST_PG=1 node tests/ts-runner.cjs ./tests/<name>-tests.ts`. Run it after changing the store, a record shape, ids or migrations |
| Proxy config | `TRUST_PROXY=1`, `TRUST_PROXY_HOPS=<n>` | Only behind your own reverse proxy; enables per-client rate limits |
| Exploit replay | `BASE_URL=http://localhost:3000 node scripts/smoke-security.mjs` | Against a running server started without `DEV_AUTH_BYPASS`; run after touching auth, webhooks or platform routes |
| DB integration tests | `npm run test:db` | Hits real Neon/Pinecone/Upstash — ask before running |
| Migrations / seeds | `npm run db:migrate`, `npm run db:seed:*` | `db:migrate` hits real Neon — ask before running. `db:seed:*` write demo data into the JSON store file (and legacy SQL files); they refuse with `DATA_BACKEND=pg`. Rehearse with `node tests/ts-runner.cjs ./src/infrastructure/db/migrate.ts --pglite <dir>` |
| Backfill / verify | `npm run db:backfill`, `npm run db:verify-migration` | Dry run by default (in-memory PGlite). `--apply` and the verify hit real Neon — ask before running. See ADR-108 for the cutover |
| Lint | `npm run lint` | **No ESLint config yet** — don't rely on it |

There is no `test:eval`, `test:unit`, `test:e2e` or Dockerfile yet. The project is a local git repository with no remote (see STATUS §2).

## 3. Where things are

```
src/app/api/v1/<resource>/route.ts   REST routes (tenant); src/app/api/v1/platform/** (platform)
src/app/(dashboard)/**               Merchant UI          src/app/super-admin/**  Platform UI
src/domains/<domain>/                *.service.ts (logic), *.repository.ts (Neon, not yet wired)
src/lib/api-response.ts              extractRequestContext, extractPlatformContext, apiSuccess, apiError
src/lib/security.ts                  JWTs (issuer + per-purpose audience), bcrypt, credential encryption (ADR-103)
src/lib/validation.ts                parseOrThrow / readJson for strict Zod bodies (ADR-104)
src/lib/rate-limit.ts                enforceRateLimit / checkRateLimit (in-memory, single replica)
src/lib/safety-gate.ts               assertNotKilled, assertWithinLimit, isFeatureEnabled (enforced platform controls)
src/lib/impersonation.ts             read-only support sessions (cookie + operator session)
src/domains/orders/order-lifecycle.service.ts  the only writer of order status
src/domains/enterprise/organization-access.ts  resolveOrganizationId (own organizations only), resolveEnterpriseCaller (real enterprise scope)
src/lib/errors.ts                    AppError family (NotFoundError, ForbiddenError, ...)
src/lib/permissions.ts               PERMISSIONS, RoleName, ROLE_PERMISSIONS
src/domains/rbac/service.ts          RbacService.assertCan (tenant)
src/domains/platform/services/       PlatformAuthorizationService, entitlements, flags, audit, support
src/domains/ai/                      agents, policy, tools/tool-registry.ts, prompts, rag, eval
src/infrastructure/db/index.ts       The store (~9.8k lines — grep it, never read whole); getAll* for analytics, paged getters need a limit.
                                     DATA_BACKEND=pg: Postgres is the system of record (await db.ready() in scripts)
src/infrastructure/store/            Postgres persistence: pg-store.ts (load, diff, one-transaction writes, lease), store-schema.ts
                                     (collection → table), migrations.ts (runner), backfill.ts (backfill + verify)
src/infrastructure/db/migrations/    006_align_domain_model.sql (schema `commerceos`); legacy/ = old 001-005, never run
src/domains/intelligence/services/intelligence-snapshot.service.ts  GET reads (never write) vs recompute writes (ADR-105)
src/styles/tokens.css                Design tokens (canonical)
n8n/workflows/*.json                 Exported n8n workflows
tests/*-tests.ts                     Test suites
```

Never read `.data/` (39 MB, contains PII) or `.env.local`.

## 4. Canonical route pattern

```ts
import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { PERMISSIONS } from "@/lib/permissions";

const Body = z.object({ name: z.string().min(1) }).strict(); // never spread raw body into records

export async function POST(request: Request) {
  try {
    const ctx = await extractRequestContext(request);          // tenant from session only
    RbacService.assertCan(ctx, PERMISSIONS.PRODUCTS_WRITE);     // every mutation
    const input = Body.parse(await request.json());
    return apiSuccess(await SomeService.create(ctx, input), undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
```

## 5. Non-negotiables (full list: GOVERNANCE.md §2)

1. `tenant_id` only from context; never from body/query/params. Every lookup by id also filters by tenant.
2. Every mutation route calls `assertCan`; approver/actor identity comes from the session, never the body.
3. No auth shortcuts: master passwords, test headers (`x-test-*`), dev fallback identities, fake MFA.
4. No secrets in code or `.env.example` (placeholders only).
5. LLMs never touch storage and are never the source of truth for prices, stock, payments, order state.
6. Business config (delivery fees, thresholds) comes from tenant settings/constants in code — never hard-coded into prompts or docs.
7. Simulated integrations must report `SIMULATED`/`NOT_SENT`, never success. No fabricated metrics.
8. Smallest safe change; no drive-by rewrites; no new heavy dependencies without asking.
9. GET handlers never write (`tests/phase2-readonly-tests.ts` enforces it). Return defaults without storing them; computed
   intelligence is stored only by an explicit POST (e.g. `/api/v1/intelligence/recompute`). Analytics read every row
   (`db.getAll*`), never a paged result.

## 6. Task router — read before starting

| Task | Read |
|---|---|
| Any feature | `.agent/workflows/feature-development.md`, `.agent/rules/architecture.md` |
| Bug / audit finding | `.agent/workflows/bug-fixing.md` + the finding in the audit + its `FX-nn` item |
| API route | `.agent/rules/api.md`, `.agent/rules/backend.md`, `.agent/skills/backend-engineering/SKILL.md` |
| Auth, sessions, webhooks, secrets | `.agent/rules/security.md`, `.agent/rules/tenant-isolation.md`, `.agent/skills/security-engineering/SKILL.md` |
| Persistence / schema | `.agent/workflows/database-change.md`, `.agent/rules/database.md`, `.agent/skills/database-engineering/SKILL.md` |
| UI | `.agent/rules/frontend.md`, `.agent/rules/ux.md`, `.agent/skills/frontend-design/SKILL.md` |
| Super-admin / platform | `.agent/GOVERNANCE.md` §4–5, `.agent/skills/platform-control-plane/SKILL.md`, `.agent/workflows/create-platform-feature.md` |
| AI agents, tools, prompts | `.agent/workflows/agent-development.md`, `.agent/rules/agents.md`, `.agent/rules/ai.md`, `.agent/runtime-agents/<agent>.md` |
| RAG | `.agent/rules/rag.md`, `.agent/skills/rag-engineering/SKILL.md` |
| n8n / automation | `.agent/workflows/n8n-workflow-development.md`, `.agent/rules/n8n.md` |
| Tests | `.agent/rules/testing.md`, `.agent/skills/testing/SKILL.md` |
| Bangladesh commerce rules | `.agent/skills/commerce-domain/SKILL.md`, `.agent/BANGLADESH_COMMERCE.md` |

Full index of `.agent/`: [`.agent/README.md`](.agent/README.md).

## 7. Finishing

Follow the Definition of Done in `.agent/GOVERNANCE.md` §6. In your final message, state plainly what you verified
(commands + results), what you could not verify, and anything that is simulated. Update `.agent/STATUS.md` when a
capability's status changes.
