---
trigger: glob
description: SaaS billing vs store payments, entitlements, tenant lifecycle
globs: src/domains/platform/**/*, src/domains/tenants/**/*
---

# Platform Billing & SaaS Entitlement Governance Rules

## 1. Prime Directive: Domain Segregation of Payments
CommerceOS strictly decouples **SaaS Platform Billing** from **Tenant Store Payments**:

```
┌────────────────────────────────────────────────────────┐
│                   PAYMENT DOMAIN FIREWALL              │
├──────────────────────────┬─────────────────────────────┤
│  SAAS SUBSCRIPTION BILLING│   TENANT COMMERCE PAYMENTS  │
├──────────────────────────┼─────────────────────────────┤
│ Target: Merchant Tenant   │ Target: Retail Customer     │
│ Purpose: CommerceOS SaaS  │ Purpose: Product Orders     │
│   subscription plans     │   (Linen Panjabi, Sarees)   │
│ Flow: Tenant -> Platform  │ Flow: Customer -> Merchant  │
│ Gateway: SaaS Invoicing   │ Gateway: bKash, Nagad, COD  │
│ Ledger: Platform Billing  │ Ledger: Store General Ledger│
└──────────────────────────┴─────────────────────────────┘
```

- **NEVER** mix customer store order payments with merchant SaaS subscription fees.
- **NEVER** process SaaS subscription renewals through tenant-configured store payment adapters.
- SaaS billing events are handled by the Platform Control Plane; retail commerce transactions are handled by the Commerce Core `PaymentService`.

---

## 2. Entitlement-Driven Architecture
- **Avoid Scattered Plan Checks**:
  - **NEVER** write ad-hoc conditional logic across application code such as:
    ```typescript
    // FORBIDDEN ANTI-PATTERN:
    if (tenant.plan === "PRO") { ... }
    ```
- **Centralized Entitlement Service**:
  - Feature access, concurrency limits, and quotas must be evaluated via a centralized service:
    ```typescript
    // MANDATED PATTERN:
    await EntitlementService.assertHasEntitlement(tenantId, "channels.max_connected");
    ```
  - Code asks: *"Does this tenant have the capability?"* rather than *"What tier is this tenant on?"*
  - Allows platform operators to assign custom overrides or grandfathers to specific tenants without modifying business code.

---

## 3. Authoritative Tenant Lifecycle State Machine
Tenant status transitions must follow a governed, domain-driven state machine. Destructive or arbitrary status changes directly from API route handlers or database clients are prohibited:

```
[ PROVISIONING ]
       │
       ▼ (Onboarding Success)
   [ TRIAL ] ◄──────────────┐
       │                    │
       ▼ (Plan Subscribed)  │ (Grace Reinstatement)
   [ ACTIVE ] ──────────────┤
       │                    │
       ▼ (Payment Overdue)  │
  [ PAST_DUE ] ─────────────┘
       │
       ▼ (Grace Expired / Operator Action)
  [ SUSPENDED ]
       │
       ├─────────────────────┐
       ▼ (Voluntary Churn)   ▼ (Administrative Purge)
  [ CANCELLED ]         [ ARCHIVED ]
```

### Lifecycle Operations
All status changes must be initiated through `TenantLifecycleService`:
1. **`createAndProvision()`**: Initializes database schemas, seed defaults, initial plan, and owner user in `PROVISIONING` state.
2. **`activate()`**: Transitions tenant to `ACTIVE` upon successful billing or trial confirmation.
3. **`markPastDue()`**: Restricts creation of new outbound marketing campaigns while preserving core order processing for 7 days.
4. **`suspend()`**: Disables all ingress webhooks, pauses automations, and presents a suspension notice to staff.
5. **`reactivate()`**: Resolves overdue billing and restores active operational state.
6. **`archive()`**: Puts workspace into an immutable, read-only tombstone state.
7. **`purge()`**: Governed deletion respecting data retention windows and requiring dual-custodian approval.
