---
description: Create or change an n8n workflow — trigger, idempotency, tenant resolution, API calls, DLQ, export
---

# n8n Workflow Development Workflow

Follow this procedure when creating or maintaining automated workflows in n8n for CommerceOS:

1. **Specify Workflow Trigger & Ingress**:
   - Determine trigger type: Webhook (event-driven) or Cron (scheduled).
   - Ensure external webhooks support cryptographic signature validation and timestamp checks.

2. **Establish Idempotency Key**:
   - Designate a unique idempotency key (e.g. `bkash:trx:<id>` or `event:<id>`).
   - Implement a Redis or database check to prevent duplicate executions.

3. **Define Tenant Resolution**:
   - Verify how the workflow identifies `tenant_id` from the secure payload.

4. **Target Authoritative Commerce API**:
   - Ensure the workflow executes operations by calling CommerceOS REST APIs (`/api/v1/*`) using bearer tokens.
   - Never write raw SQL nodes or connect directly to PostgreSQL from n8n.

5. **Implement Error & Retry Handling**:
   - Configure exponential backoff on network failures.
   - Add error catch triggers routing failed payloads to the dead-letter queue.

6. **Export & Version Workflow JSON**:
   - Export the n8n workflow definition to `n8n/workflows/<workflow_name>.json` in version control.
   - Document the workflow in `.agent/N8N_ARCHITECTURE.md`.
