---
name: commerce-domain
description: Bangladeshi e-commerce domain knowledge for CommerceOS — order lifecycle, inventory reservation, COD, bKash/Nagad, courier flow, delivery zones and fees, RTO. Use when implementing or reviewing order, payment, shipping, inventory, or pricing logic.
---

# Commerce Domain (Bangladesh)

Deeper background: `.agent/BANGLADESH_COMMERCE.md`, `.agent/INTEGRATIONS.md`.

## Order lifecycle
Authoritative states and transitions: `src/domains/orders/order-state-machine.ts` (read it; don't restate it).
- Inventory is **reserved** when an order is placed and **committed** when it ships; cancellation/expiry releases the reservation. Reservation expiry needs a sweeper (audit M2).
- Only the state machine changes order status. Courier sync and shipping must call it, not write status directly (audit H12). A `CANCELLED` order can never become `DELIVERED`/`PAID`.

## Delivery zones & fees
- Zones: `INSIDE_DHAKA`, `OUTSIDE_DHAKA` (some couriers add sub-Dhaka zones). Record the real district — don't default to one city (audit M5).
- **Fees are tenant settings** (Settings → delivery fees). Common market defaults are ~৳60 inside / ~৳120 outside Dhaka, but code must read the tenant's configured value. Hard-coded fees in `src/domains/ai/prompts/prompt-registry.ts` and `src/domains/ai/context/context-builder.ts` are debt — replace with tenant settings when touching them.
- Merchants may require the delivery fee in advance for outside-Dhaka COD orders.

## Payments
- Methods: COD, bKash, Nagad, card/SSLCommerz.
- MFS: the customer submits a TrxID; it is verified against the provider API, must match the amount, and can be used **once** across all orders (audit H3). Screenshots and customer claims are never proof.
- COD: cash collected by the courier, minus delivery charge and COD commission (commonly ~1%), settled in batches — reconcile settlements against delivered orders.
- Refunds always require human approval.

## Couriers
Steadfast, Pathao, RedX, Paperfly, eCourier, Sundarban. Normalized statuses and sync: `src/domains/automation/services/courier-sync.service.ts`. Webhooks must be signed (audit C4).

## Key metrics (definitions)
- AOV = revenue ÷ completed orders.
- RTO rate = returned-to-origin ÷ shipped.
- Compute from full data sets — never from the newest 50 rows (audit H6).
