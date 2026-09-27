---
name: observability
description: Add logging, tracing, audit events, health checks and agent-run telemetry to CommerceOS. Use when adding log statements, metrics, readiness checks, or AI run tracking.
---

# Observability

Target design: `.agent/OBSERVABILITY.md` (mostly TARGET).

## Current reality
- There is **no structured logger** yet; the codebase has ~80 `console.*` calls. Don't add more.
- If you need logging and `src/lib/logger.ts` doesn't exist, create it once (JSON lines: `timestamp`, `level`, `event`, `request_id`, `trace_id`, `tenant_id`, `duration_ms`) and use it — record that in STATUS.md.
- Request identity: `ctx.requestId` and `ctx.traceId` from `RequestContext` (`src/lib/context.ts`).
- Audit trail (who did what): `src/domains/audit/service.ts` (tenant) and `platform-audit.service.ts` (platform). Audit ≠ logs: audit is append-only business history.
- Readiness: `src/app/health/ready/route.ts` must check real dependencies (audit L3).
- Audit/event IDs must be collision-free (`crypto.randomUUID()`, not `Date.now()`, audit L4).

## Rules
- Never log secrets, tokens, full phone numbers, addresses, or message bodies; mask PII.
- AI runs: record agent, tools called, token usage (when a real provider exists), latency, outcome, handoff reason.
- Metrics shown in UI come from real data; unknown → "Telemetry pending".
