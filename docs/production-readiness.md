# CommerceOS — Production Readiness Audit

**Date:** 2026-09-30 · **Scope:** audit only, no code changed · **Method:** read of `package.json`, `next.config.js`, `.env.example`,
`.agent/STATUS.md`, health routes, logger, rate limiter, store bootstrap, AI provider/runtime, connectors; `npm audit --omit=dev`.
Not done: no server was started, no load test, no Render/Vercel/Neon/Qdrant dashboards inspected, no `.env.local` or `.data/` read.

> **Naming.** This plan uses **R1–R5** for the rollout phases. The repo already uses "Phase 0–5" for security/persistence work
> (`.agent/STATUS.md`), so reusing those numbers would be confusing.

---

## 1. The premise in the brief does not match the repo

The brief assumes a separate backend (FastAPI/Node) on Render and a separate frontend on Vercel, in a monorepo with `/backend` and
`/frontend`, with pgvector/Pinecone. What exists:

| Brief assumes | Repo reality |
|---|---|
| Separate backend and frontend | **One Next.js 14.2.15 app.** Pages (`src/app/(dashboard)`, `src/app/super-admin`) and the REST API (`src/app/api/v1/**`) ship together. |
| Stateless API + DB | **In-process store.** The whole dataset is loaded into memory at boot (`src/instrumentation.ts` → `loadStore`), synced from Postgres about once a second, and every write request runs serialized under a per-server store lock (`src/lib/store-unit.ts`, ADR-109). |
| Pinecone / pgvector | **Qdrant** (`QDRANT_URL`) + in-process BM25. Embeddings from a configurable OpenAI-compatible provider. |
| Queue + worker | **None.** Background work is in-process timers; n8n (separate, self-hosted, not deployed) is the only async executor. |
| Git on GitHub | **Local repo, no remote**, no CI, no `render.yaml`, `vercel.json` or Dockerfile. |

**Consequence for the architecture decision (needs your call, see §7):** Vercel serverless functions are a poor host for this
app. Each cold start would load the full store, and the store lock and sync loop assume a long-lived process. The natural fit is
**one long-running Node service on Render** (web service, 1..n instances on one Postgres). Vercel would then either be dropped or
host only the UI, which means externalizing the API base URL and moving to same-site cookies. That is real work: today the UI
calls same-origin relative URLs and auth is a `SameSite=Lax` HttpOnly cookie.

---

## 2. Current state (what is already good)

Credit where due; do not redo these. All per STATUS.md plus what I spot-checked in code.

- **Security baseline:** fail-closed secrets, per-purpose JWT audiences, RBAC on every mutation handler, tenant scoping, HMAC-signed
  webhooks with dedup, HttpOnly/Secure/SameSite cookies, DB-backed shared rate limits (with in-memory fallback), cookie-session
  invalidation ("sign out everywhere"), operator TOTP MFA, kill switches and plan limits enforced (`src/lib/safety-gate.ts`).
- **Persistence:** Postgres system of record (`DATA_BACKEND=pg`), migrations run by an explicit command (`npm run db:migrate`), **not** at app
  start. That is the pattern the brief wants. Multi-server soak test exists (`scripts/soak-two-servers.mjs`).
- **Health endpoints exist:** `GET /health` (liveness) and `GET /health/ready` (readiness: store loaded, Postgres ping ≤2 s, staleness,
  refused rows → `degraded`). Unauthenticated and leak-free by design. Paths are `/health` and `/health/ready`, not `/healthz` `/readyz`.
- **Structured logging:** `src/lib/logger.ts` emits JSON lines; every API response carries a `request_id`.
- **Honest integrations:** simulated providers report `SIMULATED`/`NOT_SENT`; the AI provider is a real OpenAI-compatible client or an explicitly labelled demo.
- **Quality gates locally:** `type-check` 0 errors, `next build` passes, 27 suites / 872 tests, plus the same suites on Postgres (`npm run test:pg`).
- **Timeouts on outbound calls:** LLM 30 s default (`AbortSignal.timeout`), Qdrant, n8n, connector tests 5 s; agent runtime 15 s wall-clock budget.
- **Security headers:** `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, HSTS in production; CSP present but Report-Only.

---

## 3. Gaps, ranked

Severity: **P0** = blocks any internet-facing deploy; **P1** = fix before real customers / paid LLM spend; **P2** = harden after launch.
"Verify" means I saw a signal but did not prove it.

### P0

| ID | Gap | Evidence |
|---|---|---|
| P0-1 | **No CI/CD, no remote, no branch protection.** Nothing gates a merge or deploy; the brief's whole Phase 5 has no starting point. | No `.github/`, `git remote -v` empty |
| P0-2 | **No deploy artifact.** No `render.yaml`, Dockerfile or documented start command / Node version pin (`engines` missing). | repo root listing |
| P0-3 | **Known vulnerable framework.** `npm audit --omit=dev`: `next` (critical: DoS via Server Actions, dev-server origin exposure; range `0.9.9 – 16.3.0-preview.10`) and bundled `postcss` (high). `npm audit fix --force` proposes Next 16, a breaking jump. Need the smallest patched 14.2.x if one exists. | `npm audit` |
| P0-4 | **Neon database password rotation still owed** by the owner (it was once in `.env.example`). Confirm rotated, and that the app role is least-privilege. | STATUS.md §4 |
| P0-5 | **Readiness is not wired to anything.** Endpoints exist, but no platform health check is configured, and there is no verification of behavior on SIGTERM in Linux (handler at `src/infrastructure/db/index.ts:10203`, untested on Windows; unflushed writes are the risk). | STATUS.md deferred list |
| P0-6 | **Single-process memory model is unsized.** Every instance holds the full dataset in RAM. Dev store is ~39 MB JSON; no memory budget, no `--max-old-space-size`, no instance sizing for N tenants. OOM on a small Render instance would drop acknowledged in-flight writes. | `db` design, ADR-109 |

### P1

| ID | Gap | Evidence |
|---|---|---|
| P1-1 | **No queue or worker.** Autonomous cycles are recorded but no worker executes their steps; no scheduled intelligence recompute; campaign scheduling has no scheduler; RAG ingestion and agent runs execute in the request. | STATUS.md "open" lists |
| P1-2 | **Readiness checks only Postgres.** Qdrant, Redis (Upstash, "largely unused") and LLM provider are not reported. Decide which are hard dependencies (fail ready) vs soft (report degraded). | `src/app/health/ready/route.ts` |
| P1-3 | **No retries/backoff on LLM calls, fallback unproven.** Provider has a timeout but no retry loop; `LLM_FALLBACK_*` exists; verify it is actually used on 429/5xx/timeouts, not only on config. | `openai-compatible.provider.ts`, `agent-router.ts` |
| P1-4 | **Cost and token budgets look partly stubbed.** `agent-runtime.ts` contains fixed cost constants (`costUsd: 0.0001`, `costBdt: 0.012`) alongside a `LLM_PRICING_JSON` option; verify no fabricated numbers reach `/ai/usage`. No per-user or per-tenant spend cap found. Violates the "no fabricated metrics" rule if confirmed. | `agent-runtime.ts:59–142, 201` |
| P1-5 | **LLM-endpoint rate limits.** A shared limiter exists; verify each LLM-backed route (`/ai/*`, social reply, RAG, copilot) has a per-user and per-tenant limit, not just login. | `src/lib/rate-limit.ts` |
| P1-6 | **SSRF surface unguarded.** Outbound fetches take tenant-configured hosts (`connectors/service.ts`, `google-sheet.ts`, `n8n-provider.service.ts`, `N8N_HOST`). I found no private-range / metadata-IP / redirect blocking. | grep for `isPrivate`, `169.254`, allowlist: none |
| P1-7 | **No streaming for agent/chat UI.** No `text/event-stream` or `ReadableStream` in `src/`. Long agent runs block a request behind the store lock. | grep |
| P1-8 | **Memory store has no retention/TTL** (`src/domains/ai/memory/memory.service.ts`). Isolation by tenant exists; per-user isolation and TTL do not. PII retention policy needed (also for the audit log). | grep `ttl/retention` |
| P1-9 | **CSRF depends on `SameSite=Lax` only.** The origin check I found in `api-response.ts` is in the dev-bypass path. Verify whether cookie-authed mutations reject cross-site `Origin`. If the UI moves to Vercel with a different site, Lax stops working. | `api-response.ts:213` |
| P1-10 | **CSP is Report-Only with `unsafe-inline` scripts** and no report endpoint, so it currently protects nothing. | `next.config.js` |
| P1-11 | **Client-controlled `x-request-id`** is accepted verbatim into logs and responses (log injection / correlation spoofing). Generate server-side; keep the client value in a separate field, length-capped. | `api-response.ts:101, 248` |
| P1-12 | **Prompt-injection guardrails: not proven active.** Mentions in policy/context-builder/router; the golden dataset exists but is not a gate, and there is no `test:eval` script. | STATUS.md "Agent evals PARTIAL" |
| P1-13 | **Secret and dependency scanning absent** (no gitleaks, no dependabot/renovate, no lockfile audit in CI). | no CI |
| P1-14 | **n8n deployment unspecified.** Only a local docker-compose (`n8nio/n8n:latest` unpinned, `http`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, localhost URLs). Production hosting (n8n Cloud vs Render private service) undecided. | `n8n/docker-compose.yml` |

### P2

| ID | Gap |
|---|---|
| P2-1 | 60 raw `console.*` calls in `src/`; route them through `logger` and add a redaction helper (no prompts, message bodies, phones). `logger` relies on callers being careful. |
| P2-2 | No ESLint config; `npm run lint` is unusable. Scripts in `scripts/` are outside `type-check`. |
| P2-3 | No embedding cache or repeatable-response LLM cache (Upstash exists but is unused). |
| P2-4 | Dashboard pages do not all render a 403 state; role review with product owner pending (STATUS). |
| P2-5 | No `engines`/`.nvmrc`; no Next `output: "standalone"`; no bundle-size budget; no `next/image` policy review. |
| P2-6 | Legacy Neon `public` schema tables (001–005) remain unused. Drop via a later migration after cutover. |
| P2-7 | Free-tier spin-down documentation (see §5). |
| P2-8 | Backups: Neon PITR window, restore drill and Qdrant snapshot policy are undocumented. |

---

## 4. Phased plan with acceptance criteria

Rules for every phase: one branch + one PR; no secrets in code; no prod env-var change, destructive DB operation, or force-push without
asking; each PR states **verify** and **rollback**. Nothing below starts until you approve.

### R0 — Pre-work (no product code; you and I)
1. Create the GitHub repo/remote; push `main` and the `release/*` tags. *(You: needs your GitHub account; I will not create it.)*
2. Confirm Neon password rotated and app role least-privilege. *(You.)*
3. Decide the deployment shape (§7).
**Accept:** remote exists, default branch is `main`, decisions recorded.

### R1 — Backend hardening on Render (PR `ops/render-backend`)
- `render.yaml`: `web` service (`npm ci && npm run build`, start `next start -p $PORT`, `healthCheckPath: /health/ready`, `preDeployCommand: npm run db:migrate`), env-var group with `sync: false` for secrets, region matched to the Neon region, `autoDeploy: false` until R5. Optional `worker` and `cron` entries stubbed and disabled until R1b.
- `engines.node`, `.nvmrc`; `NODE_OPTIONS=--max-old-space-size` tied to the instance plan; `TRUST_PROXY=1`, `TRUST_PROXY_HOPS` set per Render's proxy count.
- Verify SIGTERM flush on Linux (test: write, `kill -TERM`, restart, record present); Render's shutdown grace window ≥ flush time.
- Request timeouts: global body-read timeout exists (`STORE_BODY_READ_TIMEOUT_MS`); add per-route deadline for LLM/RAG routes returning 504.
- Pool: confirm `STORE_POOL_MAX` × instances ≤ Neon pooled connection limit; document sizing table.
- Logging: server-generated `request_id` (P1-11); replace `console.*`; log-redaction test.
- Document cold start / free-tier spin-down: the process reloads the entire store on wake, and readiness stays 503 until loaded, so a Render Free instance is not acceptable for production (also loses webhooks during spin-down); minimum a paid always-on plan.
**Accept:** blueprint validates (`render blueprint validate`); deploy to a *staging* service passes `/health/ready`; SIGTERM test passes; migration pre-deploy runs once per deploy; no request path logs a prompt or message body (test). **Rollback:** Render "Rollback" to previous deploy; migrations follow expand/contract so previous code still runs; delete the blueprint file.
- **Migration policy (in this PR's docs):** expand → deploy → contract in separate releases; no column drop/rename in the same release as code that stops using it; each migration has a written rollback.

### R1b — Queue + worker (PR `feat/job-queue`), *only after R1 is stable*
- Postgres-backed job table (no new infra) with `FOR UPDATE SKIP LOCKED`, retries, dead-letter, idempotency key; a `worker` process type running the same code.
- Move first: RAG ingestion/embedding, scheduled intelligence recompute, campaign schedule ticks, autonomous cycle steps. Agent runs stay synchronous but time-boxed until streaming exists.
- Note: the worker must not use the request store lock semantics implicitly. Decide whether it loads the whole store (memory cost) or uses direct SQL.
**Accept:** kill the worker mid-job → job retried once, no duplicate side effect (test); DLQ visible in super-admin. **Rollback:** flag off, jobs run inline as today.

### R2 — Frontend delivery (PR `ops/frontend-delivery`), shape depends on §7
- If **UI+API together on Render** (recommended): Vercel is dropped or used only for PR previews pointed at staging; document this.
- If **UI on Vercel**: `NEXT_PUBLIC_API_BASE_URL` per environment, custom same-site domain for cookies (`api.<domain>`), CORS allowlist, CSRF token or Origin check, `vercel.json` headers, Preview → staging backend only (enforced by env scoping, verified by a test that fails if a preview build's API URL matches the prod host).
- Either way: enforce CSP (report endpoint first, then drop `unsafe-inline` where possible), bundle-size budget, streaming chat UI (SSE) with error/timeout states.
**Accept:** no `NEXT_PUBLIC_*` value contains a secret (CI grep); preview deployment cannot reach prod API; CSP violations = 0 for a week before enforcing. **Rollback:** revert PR; headers are config-only.

### R3 — Cross-origin & security (PR `sec/hardening`)
- Fix or verify P1-5, P1-6, P1-9, P1-10, P1-12: rate-limit matrix for LLM routes; SSRF guard (block private/link-local/metadata ranges, re-resolve after DNS, no redirects to blocked hosts, https-only) with tests; CSRF/Origin check for cookie-authed mutations; output filtering test.
- **Patch `next`/`postcss` (P0-3)** to the smallest patched 14.2.x; run the full suite and `test:pg`. (Pull this forward as its own PR immediately after R0.)
- Prompt-injection guardrail proof: adversarial cases in the golden dataset, asserting policy refusals; report which guard fired.
**Accept:** `npm audit --omit=dev` shows 0 high/critical or documented exceptions; SSRF tests hit `127.0.0.1`, `169.254.169.254`, `10.x`, IPv6 loopback, DNS-rebinding stub → all refused; `scripts/smoke-security.mjs` passes against staging.

### R4 — AI/LLM production concerns (PR `ai/prod-controls`)
- Retry with jittered backoff on 429/5xx/timeout (max 2), then fallback provider; circuit breaker; tests with the stub server.
- Real cost accounting from provider `usage`; remove fixed constants (P1-4); per-tenant daily and per-request token/cost caps enforced before the call, with a 429-style refusal and audit row.
- Embedding cache (hash → vector) in Postgres or Upstash; response caching only for deterministic, non-tenant-data prompts.
- Memory retention: TTL config per memory type, purge job (uses R1b), per-user isolation test.
- Kill switch: platform GLOBAL/tool switches already exist. Add a documented runbook and a test that the switch stops tool execution within one request.
**Accept:** injected provider 429 → retried → fallback used, recorded in the run; a run exceeding budget is refused; usage numbers equal provider-reported tokens in test. **Rollback:** feature flags per control.

### R5 — GitHub CI/CD (PR `ci/pipeline`)
- Workflows: `ci.yml` (Node pinned; `npm ci`, `type-check`, `npm test`, `npm run test:pg`, `next build`), `security.yml` (`npm audit --omit=dev --audit-level=high`, gitleaks, dependency review), migration check (fail when a migration lacks a rollback note or contains `DROP`/`RENAME` without an `-- allow-destructive: <reason>` marker).
- Eval gate: `evals/thresholds.json` + a `test:eval` script over the golden dataset using the demo AI or a stub (no paid calls); fails on regression.
- Deploy: Actions calls the Render **deploy hook** (stored as a GitHub secret) after CI passes on `main`; Render `autoDeploy` off. Post-deploy smoke job: `/health/ready` plus one critical flow (login → create order → read back) on a dedicated smoke tenant; notification on failure.
- Branch protection on `main`: required checks, 1 review, no force-push, linear history. *(Requires repo admin; I will give you the exact settings, not apply them.)*
- Path filters are moot with one app; add them only if the repo later splits.
**Accept:** a PR with a failing test cannot merge; a deliberately lowered eval score fails the gate; a `main` merge deploys staging first, then production after smoke passes. **Rollback:** disable workflow, re-enable Render auto-deploy, or Render "Rollback".

Suggested order: R0 → Next patch → R1 → R5 (CI early, it protects the rest) → R3 → R1b → R2 → R4.

---

## 5. Cold start / spin-down (the brief asks for this)

- Render Free web services sleep after ~15 min idle and take tens of seconds to wake. Here wake means Node boot + load the entire
  store from Postgres; `/health/ready` returns 503 `STORE_NOT_READY` until loaded, and `db.data` answers 503 meanwhile.
- **Impact:** inbound Meta/courier/payment webhooks arriving during wake can hit 503 and depend on the sender's retry; Meta may disable a webhook after repeated failures.
- **Mitigation:** paid always-on instance for production; Free only for staging. A keep-alive ping is not a fix (Free also has monthly hour limits).
- Neon also scales to zero: the first query after idle adds latency; the store's background sync makes this visible in readiness. Decide the suspend timeout.

---

## 6. Rollback/verification summary

| Change type | Verify | Roll back |
|---|---|---|
| Config/headers | curl headers on staging; smoke script | revert commit; redeploy |
| Migration | rehearse on a Neon branch (as done for 006); `db:verify-migration` | previous code still works (expand/contract); documented down-step; Neon PITR as last resort |
| Dependency patch | full suite + `test:pg` + build | revert lockfile commit |
| Feature behind flag (AI controls, queue) | tests + staging soak | flip flag |

---

## 7. Decisions I need from you before implementing

1. **Deployment shape:** (a) whole app on Render, Vercel only for previews or dropped **(recommended)**; (b) UI on Vercel + API on Render (needs same-site domain, CORS, CSRF work; higher risk).
2. **Render plan/region and Neon region** (must match); expected tenant count/data size for memory sizing.
3. **Hard vs soft dependencies** for readiness: is Qdrant/Redis/LLM down = not ready, or degraded?
4. **n8n hosting:** n8n Cloud or self-hosted on Render?
5. **GitHub:** repo name/org; may I add the workflows and a deploy-hook secret name (you set the secret value).
6. **Which LLM provider(s)** for production and monthly budget, for the cost caps.
7. Your brief was **cut off** at "Branch protection rules and required…"; tell me if there was more.
8. Worktree `G:/OLama/CommerceOS-fx45` holds branch `phase-5-stage-1` (n8n changes, 3 commits ahead) and `main` has an uncommitted edit to
   `n8n/deployment/environment.example`. Should either be merged/committed first?

---

## 8. What I did not verify

Live behavior of any endpoint; Render/Vercel/Neon/Qdrant/Upstash settings; whether LLM fallback, per-route rate limits and CSRF checks are enforced at runtime (marked *verify*); memory footprint of the store; whether a patched Next 14.2.x clears the audit findings.

---

## 9. Decisions recorded (2026-09-30)

1. Whole app on Render; Vercel only for PR previews. 2. Render Oregon kept (Neon is AWS us-east-2; a matching `ohio` Render region exists, not chosen). Both on Free plans today; production needs a paid always-on Render plan.
3. Qdrant, Redis and the LLM provider down = full readiness reports not-ready (`READY_REQUIRED`); Render's restart check uses `?scope=core` so a provider outage can't cause restart loops. 4. n8n on n8n Cloud (Header Auth token, optional HMAC). 5. Repo name AXIL (not yet created). 6. Production LLM and monthly budget: still open.

**Progress:** R1 is on branch `ops/render-backend` (blueprint, readiness dependencies, server-generated request ids, runbook). Already done outside this plan: SSRF guard for outbound calls (P1-6), signed n8n calls, secret scrub of `.env.example`, Postgres-shared rate limits.

**Finding while doing R5 (P0-3 is bigger than first reported):** Next 14.x will get no more security fixes. `next@14.2.35` is the last 14.x release, and `npm audit` still reports 15 distinct high/critical advisories whose fixes exist only in 15.5.x (up to 15.5.24) or 16.x. Applied mitigations: 14.2.35, image optimizer switched off (`images.unoptimized`; no `next/image` is used), no server actions in the code, Linux hosting. The remaining exposure is accepted temporarily in `security/audit-exceptions.json` (expires 2026-11-30). The real fix is a Next 15.5.x upgrade, which requires React 19 for the App Router: a separate project, not yet scheduled.

**R5 progress:** on branch `ci/pipeline`: workflows, eval gate, audit gate, migration check, smoke test, dependabot, `docs/ci-setup.md`. Not yet run on GitHub.
