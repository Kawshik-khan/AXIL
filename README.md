<div align="center">

# CommerceOS

**An agentic commerce operating system for Bangladeshi online sellers.**
One multi-tenant platform for web, Facebook, Instagram and WhatsApp orders: catalog, inventory, orders, couriers, payments, analytics and AI agents that answer customers in Bangla, Banglish and English.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-Neon-336791?logo=postgresql&logoColor=white)
![Status](https://img.shields.io/badge/status-pre--production-orange)

</div>

> **Status: pre-production.** The security remediation phases are done and the app runs end to end, but it has not been deployed to production
> or load-tested on real traffic. [`.agent/STATUS.md`](.agent/STATUS.md) is the one source of truth for what works, what is simulated and what is open.
> This README describes the system as built; the design docs in [`.agent/`](.agent/) describe the target.

## Why it exists

Social sellers in Bangladesh run shops out of chat inboxes: hundreds of "vai price koto?" messages a day, orders typed in by hand, Cash on Delivery
(COD) parcels that come back, payment screenshots that may be fake, and courier money to reconcile. CommerceOS puts the shop's data in one place and
lets AI agents do the repetitive work, with the AI never allowed to invent a price, a stock level or an order status.

## What it does

| Area | What you get |
|---|---|
| **Commerce core** | Products, variants, pricing, multi-warehouse inventory with reservations, an order state machine (one writer for status), customers, returns and refunds, coupons |
| **Social inbox** | Unified conversations for Facebook Messenger, Instagram, WhatsApp and a website widget, with signed webhook ingestion per channel |
| **Agentic AI** | A deterministic router over specialised agents (sales, support, orders, inventory, payments, delivery, marketing and more), a tool registry, a policy engine with human approval for risky actions, RAG over the shop's knowledge base |
| **Bangladesh specifics** | COD flows, bKash / Nagad payment records, Steadfast / Pathao courier handling, delivery-zone fees from tenant settings, district geography and RTO analytics |
| **Automation** | n8n workflows (order notifications, low-stock alerts, cart recovery, courier sync, payment verification) called with authenticated requests |
| **Intelligence and growth** | Analytics that read every row, stored snapshots, forecasts, campaigns, audiences and experiments |
| **Enterprise** | Organizations, hierarchies, governance, data lineage, integrations hub |
| **Platform control plane** | A super-admin console: tenant lifecycle, plans and limits, feature flags, kill switches that are enforced, support sessions that are read-only and audited, operator MFA |

Some integrations are **simulated** until real credentials are connected (for example a courier or a messaging provider that isn't configured). They report
`SIMULATED` or `NOT_SENT` and never claim success. The exact state of each is in [`.agent/STATUS.md`](.agent/STATUS.md).

## How it is built

```
Browser ──> Next.js 16 app (UI + REST API, one service)
              │  every handler runs in withStore: a write request is one unit of work
              ├─ In-memory store  <──sync──>  Postgres (Neon): system of record, row-versioned, change log
              ├─ Qdrant           : tenant-filtered vectors for RAG (+ in-process BM25)
              ├─ OpenAI-compatible LLM provider (Groq, OpenAI, OpenRouter, Ollama, ...) + optional fallback
              ├─ Upstash Redis
              └─ n8n Cloud        : authenticated calls out, signed or token-authenticated webhooks in
```

- **Multi-tenant by construction.** The tenant comes from the session, never from a request body; every lookup by id filters by tenant; every mutation calls `assertCan`.
- **Fail closed.** Secrets are validated at start-up, webhooks need signed timestamps, and outbound requests go through one SSRF-guarded client.
- **Honest integrations.** A simulated provider says so, and metrics are never invented.
- **Read-only GETs.** GET handlers never write; a test sweeps all of them.
- **A long-lived Node service.** The store lives in memory and syncs from Postgres, so it deploys to a server such as Render rather than to serverless functions.

## Tech stack

Next.js 16 (App Router) · React 18 · TypeScript (strict) · Zod · jose + bcryptjs · Postgres on Neon (PGlite in tests) · Qdrant · Upstash Redis · n8n · GitHub Actions · Render.

## Quick start

Requires Node 20.9 or newer (the project pins 22 in `.nvmrc`).

```bash
npm ci
npm run dev        # http://localhost:3000, after creating .env.local (below)
```

Copy `.env.example` to `.env.local` and fill in at least:

- `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY`: two *different* random values of 32+ characters.
  Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- `SEED_ADMIN_PASSWORD` (14+ characters), so the seeded demo accounts can sign in.
- For AI: `LLM_BASE_URL` and `LLM_API_KEY`, **or** `AI_DEMO_MODE=1` for an offline, clearly labelled demo AI.

Without `DATA_BACKEND=pg` the app keeps its data in a local JSON file under `.data/`. Every variable is documented in [`.env.example`](.env.example).
Never commit `.env.local` or real keys.

## Tests and quality gates

| Command | What it runs |
|---|---|
| `npm run type-check` | TypeScript, strict; 0 errors |
| `npm test` | 27 suites: security regressions, RBAC matrix, persistence, analytics, commerce, social, AI, enterprise, connectors and more |
| `npm run test:pg` | The same suites with the store persisted to in-memory Postgres and compared record by record |
| `node scripts/smoke-security.mjs` | Replays the audit's exploits against a running server (start it without a dev auth bypass) |

The CI pipeline (eval gate, dependency audit gate, migration safety check, secret scan, deploy and smoke test) lives on the `ci/pipeline` branch and is described in
`docs/ci-setup.md` once merged.

## Deployment

The target is one always-on Render web service with Postgres on Neon. The blueprint (`render.yaml`), runbook (`docs/render-runbook.md`) and the production-readiness
audit (`docs/production-readiness.md`) arrive with the `ops/render-backend` branch. Until then see [`.agent/DEVOPS.md`](.agent/DEVOPS.md) for the design.

## Repository map

```
src/app/(dashboard)/**       merchant UI                 src/app/super-admin/**   platform UI
src/app/api/v1/**            REST API                    src/domains/<domain>/    business logic
src/domains/ai/              agents, tools, policy, RAG  src/infrastructure/      store, Postgres, Qdrant, Redis
src/lib/                     auth, rate limits, SSRF guard, safety gate
n8n/workflows/               exported n8n workflows      tests/                   test suites
.agent/                      design docs, rules, ADRs, STATUS.md (start here to contribute)
```

## Security

The project went through a full audit and staged remediation (authentication, tenant isolation, RBAC on every mutation, webhook signatures, SSRF guard,
persistence integrity). Findings and fixes are in [`AUDIT_REPORT_2026-09-27.md`](AUDIT_REPORT_2026-09-27.md) and [`FIX_IMPLEMENTATION_PLAN.md`](FIX_IMPLEMENTATION_PLAN.md).
If you find a vulnerability, please report it privately to the maintainer rather than opening a public issue.

## Contributing

Read [`AGENTS.md`](AGENTS.md) and [`.agent/GOVERNANCE.md`](.agent/GOVERNANCE.md) first: they list the non-negotiable rules (tenant from context only, `assertCan` on every mutation,
no secrets in code, smallest safe change) and the definition of done. Work on a branch and open a pull request.

## License

No license has been chosen yet, so all rights are reserved. Add a `LICENSE` file before accepting outside contributions.
