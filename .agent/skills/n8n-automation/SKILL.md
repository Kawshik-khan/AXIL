---
name: n8n-automation
description: Build or modify CommerceOS n8n workflows and the automation backend — webhook gateway, idempotency, retry queue, DLQ, circuit breakers, automation router. Use for n8n/workflows/*.json or src/domains/automation/**.
---

# n8n Automation

Rules: `.agent/rules/n8n.md`. Architecture: `.agent/N8N_ARCHITECTURE.md`. Workflow procedure: `.agent/workflows/n8n-workflow-development.md`.

## Map
| Concern | Location |
|---|---|
| Exported workflows | `n8n/workflows/commerceos-*.json` |
| Local n8n | `n8n/docker-compose.yml` (`npm run n8n:up` — ask first) |
| Inbound webhooks | `src/domains/automation/services/webhook-gateway.service.ts`, `src/app/api/v1/automation/webhooks/[provider]/route.ts` |
| Idempotency | `idempotency.service.ts` |
| Retries / DLQ | `retry-queue.service.ts`, `dead-letter.service.ts` |
| Provider health | `provider-circuit-breaker.service.ts`, `n8n-provider.service.ts` |
| Loop / rate / kill switch | `automation-safety.service.ts` |
| Routing & registry | `automation-router.service.ts`, `automation-registry.service.ts`, `src/domains/automation/templates/` |

## Workflow JSON conventions
- HTTP Request nodes use the shared credential (`genericAuthType: "httpHeaderAuth"`, credential "CommerceOS API") — no inline tokens.
- Base URL from `$env.COMMERCEOS_API_BASE_URL`.
- Send `x-idempotency-key` and a correlation header on every call; target `/api/v1/automation/*` only; never Postgres nodes.
- ≤ 20 nodes per workflow; shared steps become sub-workflows (Execute Workflow node).
- Every workflow has an Error Trigger path that reports to the DLQ endpoint.

## Backend invariants
- Webhook auth before parsing (signature + timestamp); tenant from endpoint config (audit C4).
- Kill switch and safety checks run on every dispatch (audit H11).
- Stubbed provider calls return `SIMULATED`, never success (audit H9).

## Verify
`node tests/ts-runner.cjs ./tests/automation-hub-tests.ts`; validate JSON (`node -e "JSON.parse(require('fs').readFileSync('n8n/workflows/<file>.json'))"`).
