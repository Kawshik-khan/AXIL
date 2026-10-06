# CommerceOS on Render — runbook (production readiness R1)

Blueprint: [`render.yaml`](../render.yaml). Audit and plan: [`production-readiness.md`](production-readiness.md).

## What is deployed

Two always-on Node web services (`next start`), region **oregon**, database on Neon (AWS us-east-2): `commerceos`
(production) and `commerceos-staging` (FX-86: same settings, its own Neon branch, Qdrant collection, Upstash database and
LLM/Gemini keys). The app holds the whole dataset in memory and syncs it from Postgres, so it is not a serverless workload
and each instance needs RAM for the data. Background work (customer-agent jobs, the domain-event outbox, health alerts)
runs inside the web process (`CUSTOMER_AGENT_WORKER`); scheduled jobs are triggered by n8n (`/api/v1/jobs/{job}/run`).

**Staging setup (FX-86):**
- Render: deploy the Blueprint; fill `commerceos-staging`'s `sync: false` variables with **staging** values only (a Neon
  branch made from an **empty or seeded parent, never from production** (production holds customers' data and staff
  password hashes), a separate Qdrant collection and Upstash database, an Ollama Cloud staging/eval key, a Gemini key, new
  `JWT_SECRET` / `CREDENTIALS_ENCRYPTION_KEY` / `JOBS_TOKEN_SHA256`). Never copy production secrets across.
- GitHub: repository variable `STAGING_BASE_URL`, secrets `STAGING_DEPLOY_HOOK_URL`, `STAGING_SMOKE_EMAIL`,
  `STAGING_SMOKE_PASSWORD`; then `AGENT_EVAL_GATE=on` with the `evals` environment (see docs/customer-agent-rollout.md).
  CI then deploys staging, smoke-tests it and runs the agent eval smoke before production.
- Local development: point your local env file at the staging stores (never production ones).
- Staging enforces the Content-Security-Policy (`CSP_ENFORCE=1`); production stays Report-Only until the monitoring job
  reports `csp.ready_to_enforce` for a full week, then set `CSP_ENFORCE=1` on production and redeploy (the header is
  built into the app at build time).
- Restore rehearsal each quarter: docs/restore-log.md.

> Oregon ↔ Ohio adds a coast-to-coast round trip (tens of ms) to every database call. Render's `ohio` region would remove
> it; the region was kept as chosen. Revisit if write latency matters.

## First deploy (staging first)

1. Create the GitHub repo, push, then in Render: **New → Blueprint**, pick the repo. Render reads `render.yaml`.
2. Fill every `sync: false` variable in the dashboard. `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` are two different random
   values of 32+ characters. `DATABASE_URL` is the **direct** Neon URL (the migration needs it); `DATABASE_URL_POOLED` is what the app uses.
   Use a Neon **branch** for staging, never the production branch.
3. Deploy. The pre-deploy step runs `npm run db:migrate`; if it fails, the deploy is cancelled and nothing changes.
4. Verify (below).

## Verify a deploy

```bash
curl -si "https://<service>.onrender.com/health"                   # 200, liveness
curl -si "https://<service>.onrender.com/health/ready?scope=core"  # 200 "ready": store loaded, Postgres answers
curl -si "https://<service>.onrender.com/health/ready"             # 200 only if Qdrant, Redis and the LLM provider also answer
```

Response bodies carry states and reason codes only (`QDRANT_UNREACHABLE`, `REDIS_UNREACHABLE`, `LLM_UNREACHABLE`,
`DATABASE_UNREACHABLE`, ...). Details are in the service log (`health.not_ready`, `health.dependency_probe_failed`).

**Why Render's health check uses `?scope=core`:** a failing health check makes Render restart the instance, and every restart
reloads the entire store. A Qdrant or LLM outage is not fixed by a restart, so the platform check must not depend on them. Use the
full URL for uptime monitors, alerts and the post-deploy smoke test (R5).

`READY_REQUIRED` (default `qdrant,redis,llm`) picks which services fail the full check. A service with no configuration is
skipped, not reported down. Note that `redis` is required by default but the app barely uses Upstash today: if you don't
want an Upstash outage to page anyone, drop it from the list.

## Sizing (fill in with real numbers)

| Plan | RAM | `--max-old-space-size` (in `NODE_OPTIONS`) | `STORE_POOL_MAX` × instances |
|---|---|---|---|
| starter | 512 MB | 384 | 5 × n |
| standard | 2 GB | 1536 | 5 × n |

Rules: the V8 heap limit stays below the instance RAM (leave room for buffers and the OS); the total pool across instances must stay
below the Neon pooled-connection limit for your compute size. **Measure** the resident size of your real dataset after load
(`process.memoryUsage()` or Render's memory graph) before choosing a plan; the local development store is ~39 MB of JSON, and memory
use is several times the file size.

## Shutdown

Render sends SIGTERM and waits `maxShutdownDelaySeconds` (60). The store's handler flushes pending writes, then exits.
`NEXT_MANUAL_SIG_HANDLE=1` is set so Next.js's own handler doesn't exit first. **Verify on Linux before relying on it** (this
cannot be tested on Windows): on staging, create a record through the API, immediately trigger a deploy or restart from the
dashboard, then confirm the record is present after the service is back up, and that the log shows no `db.shutdown_with_unsaved_changes`.

## Migrations (policy)

Migrations run in the pre-deploy step, never at app start. While the new version deploys the old one is still serving, so a migration must
work with both versions of the code: **expand → deploy → contract**.

- Adding a nullable column, a table or an index is safe in one release. Create indexes `CONCURRENTLY` on large tables.
- Never rename or drop a column or table, or add a `NOT NULL` without a default, in the same release as the code change. Ship the code that
  stops using it first, then remove it in a later release.
- Every migration file states its rollback in a comment (the SQL that undoes it, or "irreversible: restore from Neon PITR").
- Rehearse on a Neon branch first (`db:migrate` with `DATABASE_URL` pointing at the branch).

## Cold start and the Free plan

A Free web service sleeps after about 15 minutes idle. Waking means booting Node and loading the whole store; until then `/health/ready`
answers 503 `STORE_NOT_READY`. Webhooks from Meta and the couriers that arrive meanwhile get 503 and depend on the sender's retry. Use
the Free plan only for staging; production is `starter` or larger. Neon also scales to zero, so the first query after idle is slower.

## Roll back

| What | How |
|---|---|
| A bad deploy | Render dashboard → the service → Events → **Rollback** to the previous deploy. Migrations are backward compatible, so the old code still runs. |
| A bad migration | Run the rollback SQL noted in the migration file; if there is none, restore from a Neon point-in-time branch. Ask before touching production data. |
| This blueprint | Delete the service (or the blueprint file). Nothing else depends on it. |
| A wrong setting | Change the variable in the dashboard; Render redeploys. |
