# Workflow: Tenant Provisioning & Onboarding

Follow this 9-step atomic procedure for provisioning new tenant workspaces:

```
[ Step 1: Create Tenant Record ] ───────► Status: 'PROVISIONING'
               │
               ▼
[ Step 2: Seed Default Configurations ] ── Currency, Timezone, Notification Templates
               │
               ▼
[ Step 3: Provision Owner User ] ─────── Password Hash, Tenant Membership: 'OWNER'
               │
               ▼
[ Step 4: Bind Initial SaaS Plan ] ───── Free Tier / Trial Subscription Record
               │
               ▼
[ Step 5: Initialize Entitlements ] ──── Quotas: Products, Orders, AI Tokens, Channels
               │
               ▼
[ Step 6: Provision Core Resources ] ─── Default Category, General Warehouse, Inbox Channel
               │
               ▼
[ Step 7: Invariant Verification ] ───── Assert DB Constraints, Foreign Keys & Scopes
               │
               ▼
[ Step 8: Transition Status ] ────────── Status: 'ACTIVE' (or 'TRIAL')
               │
               ▼
[ Step 9: Emit Provisioning Event ] ──── 'tenant.provisioned' emitted to Event Bus
```

---

## Failure Recovery & Idempotency Rules

1. **Failure State Transition**:
   - If ANY step between 1 and 7 fails (e.g. database timeout, email collision, plan lookup error), the tenant status must transition to `FAILED` with error details captured in `metadata.provisioning_error`.
   - Under no circumstance may a half-provisioned workspace remain in an indeterminate state.

2. **Idempotent Retry Protocol**:
   - The provisioning workflow is keyed by `idempotency_key = "provision:tenant:" + slug`.
   - Operators can trigger a retry via `POST /api/v1/platform/tenants/:id/retry-provision`.
   - The runner detects existing completed sub-resources (e.g. Owner user already exists) and resumes safely from the failed step.

3. **Verification Invariants**:
   - Before transitioning to `ACTIVE`, the engine verifies:
     - Tenant record exists and has valid slug.
     - Exactly one active user with `role = 'OWNER'` is bound via `memberships`.
     - Exactly one active `subscriptions` record is linked.
     - Default warehouse exists in `warehouses`.
     - Tenant isolation index is populated.
