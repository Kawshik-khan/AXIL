# CommerceOS Event-Driven Architecture & Envelope Specification

> **Status:** TARGET. Redis Streams/consumer groups are not implemented; events are recorded in-process. Envelope and catalog are the design reference.

## 1. Event Bus Model

CommerceOS uses an asynchronous event-driven architecture powered by Redis Streams and Pub/Sub for decoupling domain events from downstream side-effects (notifications, courier syncs, analytics, and n8n workflows).

```
   DOMAINS               REDIS STREAMS                     CONSUMERS
┌────────────┐         ┌───────────────┐               ┌───────────────┐
│ Orders     │────┐    │               │──────────────►│ Notifications │
└────────────┘    │    │               │               └───────────────┘
┌────────────┐    ├───►│  commerce.    │               ┌───────────────┐
│ Inventory  │────┤    │  events       │──────────────►│ n8n Webhooks  │
└────────────┘    │    │               │               └───────────────┘
┌────────────┐    │    │               │               ┌───────────────┐
│ Payments   │────┘    └───────────────┘──────────────►│ Audit Logger  │
└────────────┘                                         └───────────────┘
```

---

## 2. Standard Event Envelope Specification

Every event emitted across the platform must conform to this schema:
```json
{
  "event_id": "evt_01J8ABCXYZ1234567890",
  "event_type": "order.created",
  "tenant_id": "ten_550e8400e29b41d4a716446655440000",
  "timestamp": "2026-09-19T09:30:00.000Z",
  "source": "commerce.orders.service",
  "correlation_id": "corr_9876543210fedcba",
  "actor": {
    "type": "USER",
    "id": "usr_123456789"
  },
  "payload": {
    "order_id": "ord_99887766",
    "order_number": "ORD-2026-00451",
    "total_amount": 1850.00,
    "payment_method": "COD",
    "delivery_zone": "INSIDE_DHAKA"
  }
}
```

---

## 3. Authoritative Event Catalog

| Domain | Event Type | Description |
| :--- | :--- | :--- |
| **Customer** | `customer.created`<br>`customer.updated` | New customer registered or profile address updated |
| **Conversations** | `message.received`<br>`message.sent` | Inbound social message or outbound reply |
| **Leads** | `lead.created`<br>`lead.qualified`<br>`lead.converted` | Sales lead lifecycle transitions |
| **Products** | `product.created`<br>`product.updated` | Catalog changes, price updates, delisting |
| **Inventory** | `inventory.updated`<br>`inventory.low`<br>`inventory.stockout` | Stock movements and threshold alerts |
| **Cart** | `cart.created`<br>`cart.abandoned` | Cart activities used for recovery workflows |
| **Orders** | `order.created`<br>`order.confirmed`<br>`order.cancelled`<br>`order.completed` | Order state transitions |
| **Payments** | `payment.created`<br>`payment.verified`<br>`payment.failed`<br>`payment.refunded` | MFS / Gateway / COD payment statuses |
| **Shipments** | `shipment.created`<br>`shipment.in_transit`<br>`shipment.delivered`<br>`shipment.failed`<br>`shipment.returned` | Courier fulfillment lifecycle events |
| **Campaigns** | `campaign.created`<br>`campaign.approved`<br>`campaign.completed` | Marketing broadcasts |
| **AI Agents** | `agent.started`<br>`agent.completed`<br>`agent.failed`<br>`agent.escalated` | Autonomous agent execution telemetry |
| **Workflows** | `workflow.started`<br>`workflow.completed`<br>`workflow.failed` | n8n automation run states |

---

## 4. Delivery Guarantees & Dead-Letter Handling

- **At-Least-Once Delivery**: Redis consumer groups with explicit `XACK` acknowledge event processing.
- **Dead-Letter Queue (`DLQ`)**: Events failing after 5 attempts with exponential backoff are shifted to `commerce.events.dlq` for operator investigation.
- **Idempotent Consumers**: Every consumer checks the event's `event_id` in Redis before executing side-effects to eliminate duplicate processing.
