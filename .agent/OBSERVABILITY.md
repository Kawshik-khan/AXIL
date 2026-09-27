# CommerceOS Observability & Telemetry Standard

> **Status:** Mostly TARGET. No structured logger, tracing, or metrics exist yet — see `skills/observability`.

## 1. Structured Logging Specification

Every operational event, API call, agent execution, and n8n trigger produces a structured JSON log entry:
```json
{
  "timestamp": "2026-09-19T09:36:12.450Z",
  "level": "INFO",
  "trace_id": "trc_01J8M5V9B1",
  "request_id": "req_01J8M5V9B2",
  "tenant_id": "ten_550e8400e29b41d4a716446655440000",
  "actor": {
    "type": "AGENT",
    "id": "agent_sales"
  },
  "service": "commerce.agent_gateway",
  "event": "tool.executed",
  "duration_ms": 142,
  "data": {
    "tool_name": "product.search",
    "query": "linen panjabi",
    "results_count": 3
  }
}
```

### 1.1 Platform Control Plane Structured Log Entry
Platform operations and support impersonation sessions require dual-actor attribution:
```json
{
  "timestamp": "2026-09-24T10:45:00.000Z",
  "level": "AUDIT",
  "scope": "PLATFORM",
  "trace_id": "trc_plat_01J8M5V9B1",
  "request_id": "req_plat_01J8M5V9B2",
  "actor": {
    "type": "PLATFORM_USER",
    "id": "usr_superadmin_01",
    "platform_role": "SUPER_ADMIN"
  },
  "effective_actor": {
    "type": "TENANT_USER",
    "id": "usr_tenant_owner_09",
    "tenant_id": "ten_550e8400e29b41d4a716446655440000"
  },
  "impersonation": {
    "session_id": "imp_99887766-5544",
    "mode": "READ_ONLY",
    "reason": "Investigating Steadfast webhook delivery failure ticket #8821"
  },
  "service": "platform.tenant_governance",
  "event": "tenant.diagnostics_inspected",
  "result": "SUCCESS"
}
```

---

## 2. Key Metrics & Monitoring Dashboards

CommerceOS monitors 4 golden signals across subsystems:

| Domain | Metrics Tracked | Alert Threshold |
| :--- | :--- | :--- |
| **API Health** | P95/P99 latency, HTTP 5xx error rate | Latency $> 500\text{ms}$, 5xx rate $> 1\%$ |
| **Database** | Active connections, pool exhaustion, slow queries ($> 100\text{ms}$) | Connection pool $> 80\%$ |
| **Redis & Queues**| Queue length, dead-letter count, memory usage | DLQ items $> 0$, Backlog $> 1000$ |
| **AI Agents** | Token consumption, latency per run, tool failure rate, escalation rate | Run latency $> 8\text{s}$, Tool failure $> 3\%$ |
| **Integrations** | Webhook verification failures, bKash API timeouts, Steadfast latency | Consecutive webhook failures $> 5$ |

---

## 3. Health & Readiness Endpoints

- `GET /health/live`: Fast liveness check returning HTTP 200 `{ "status": "ok" }`.
- `GET /health/ready`: Checks PostgreSQL pool connectivity, Redis cluster ping, and critical background worker heartbeats.
- Rules: Never leak stack traces, database credentials, or internal IPs in health checks.
