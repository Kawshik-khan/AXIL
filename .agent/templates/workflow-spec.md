# n8n Workflow Specification Template

## 1. Workflow Metadata
- **Workflow ID**: [e.g. WF-ORD-02]
- **Workflow Name**: [e.g. COD Order Confirmation Ping]
- **Domain**: [Orders / Payments / Couriers / Marketing]
- **Trigger**: [Webhook / Cron / Event Bus]

---

## 2. Ingress & Security
- **Authentication**: [HMAC Signature / Bearer API Key]
- **Idempotency Key**: [e.g. `event:<id>` or `order:<id>`]
- **Tenant Context Resolution**: [Header token / Webhook payload field]

---

## 3. Node Execution Flow
1. **Trigger Node**: Ingests payload and validates timestamp/signature.
2. **Idempotency Node**: Queries Redis key to prevent duplicate runs.
3. **Core Action Node**: Calls Commerce API (`POST /api/v1/orders/...`).
4. **Notification Node**: Dispatches WhatsApp or SMS alert.
5. **Completion Node**: Emits completion event to event bus.

---

## 4. Error Handling & Retries
- Retry strategy: [Exponential backoff, 3 retries]
- Dead-letter destination: [`commerce.events.dlq`]
- Alerting channel: [Slack #alerts channel / Operator dashboard]
