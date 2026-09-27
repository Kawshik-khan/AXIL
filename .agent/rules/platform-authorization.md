---
trigger: glob
description: Platform roles, 11-step authz pipeline, permission catalog
globs: src/domains/platform/**/*, src/app/api/v1/platform/**/*, src/lib/api-response.ts, src/lib/permissions.ts
---

# Platform Authorization & RBAC Architecture Rules

## 1. Dual-Domain Identity & Role Definitions
CommerceOS defines two independent, non-overlapping authorization matrices. Platform authority and Tenant authority are never merged:

### 1.1 Platform Roles (`PlatformMembership`)
Platform roles reside exclusively in `PlatformMembership` and govern the SaaS control plane:
- **`SUPER_ADMIN`**: Full platform authority across all infrastructure, tenants, security, and global kill switches.
- **`PLATFORM_ADMIN`**: Tenant provisioning, subscription and entitlement adjustments, platform settings.
- **`PLATFORM_OPERATIONS`**: n8n fleet health, dead-letter queue (DLQ) replay, provider circuit breaker resets, operational kill-switch execution.
- **`PLATFORM_SUPPORT`**: Tenant diagnostics, governed `READ_ONLY` support impersonation with step-up verification.
- **`PLATFORM_FINANCE`**: SaaS billing records, invoices, MRR analytics, plan pricing versions.
- **`PLATFORM_SECURITY`**: Full platform audit log inspection, security event triage, session revocation, break-glass oversight.
- **`PLATFORM_ANALYST`**: Cross-tenant aggregate telemetry, platform usage trends, churn analytics (no PII access).

### 1.2 Tenant Roles (`Membership`)
Tenant roles operate strictly within a single merchant tenant workspace:
- Canonical list: `RoleName` in `src/lib/permissions.ts` — currently `OWNER`, `ADMIN`, `DEV`, `MANAGER`, `SALES`, `SUPPORT`, `MARKETING`, `INVENTORY`, `FINANCE`, `ANALYST`. Permissions per role: `ROLE_PERMISSIONS` in the same file.

### 1.3 Inviolable Role Separation Invariants
- **NEVER** merge Platform Roles and Tenant Roles into a single enum or table column.
- **NEVER** use a tenant role as evidence of platform authority.
- **NEVER** infer: `tenant.owner == platform.admin`.
- **NEVER** infer: `tenant.role == OWNER` implies `platform.role == SUPER_ADMIN`.
- Platform authorization must be explicitly resolved from `PlatformMembership` records inside a verified `PlatformContext`.

---

## 2. Centralized Authorization Pipeline
Every platform operation must traverse an authoritative 11-step backend pipeline. Frontend checks (hiding buttons, disabling inputs, route guards) are for UX only and provide zero security:

```
[ Inbound Request ]
       │
       ▼
 1. Authentication (Verify PlatformSessionToken signature & TTL)
       │
       ▼
 2. Identity Resolution (Resolve PlatformUser & PlatformMembership)
       │
       ▼
 3. Scope Resolution (Assert Request Scope == PLATFORM)
       │
       ▼
 4. Permission Check (Verify actor has required PLATFORM_PERMISSION)
       │
       ▼
 5. Resource Authorization (Verify target resource exists & is platform-owned)
       │
       ▼
 6. Policy Check (Evaluate tenant suspension status, rate limits, geofencing)
       │
       ▼
 7. Step-Up Check (Enforce valid X-Step-Up-Token for HIGH / CRITICAL risks)
       │
       ▼
 8. Approval Check (Verify dual-custodian signoff if required by policy)
       │
       ▼
 9. Domain Operation Execution (Execute typed transactional domain logic)
       │
       ▼
10. Invariant Verification (Confirm post-state matches cryptographic expectation)
       │
       ▼
11. Immutable Audit Logging (Record actor, effective actor, diff, and reason)
```

---

## 3. Granular Platform Permissions Catalog
Hardcoded role checks in controllers (e.g. `if (role === 'SUPER_ADMIN')`) are strictly prohibited. Code must check granular permissions via `PlatformAuthorizationService.assertCan(context, permission)` (`src/domains/platform/services/platform-authorization.service.ts`). The authoritative permission list is the `PlatformPermission` type in code; the catalog below is the design reference — if they differ, update this file:

### Platform & Tenant Governance
- `platform.read`: Read platform overview and system metrics.
- `platform.manage`: Modify platform configuration settings.
- `tenant.read`: View tenant lists, profiles, and health.
- `tenant.create`: Provision new tenant workspaces.
- `tenant.update`: Modify tenant configuration and metadata.
- `tenant.suspend`: Suspend tenant access and automated executions.
- `tenant.activate`: Reactivate suspended tenant workspaces.
- `tenant.archive`: Archive tenant workspace into tombstone state.
- `tenant.users.read`: View users across tenant workspaces.
- `tenant.users.manage`: Reset credentials or manage staff memberships across tenants.

### SaaS Billing & Entitlements
- `subscription.read`: View tenant SaaS subscription states.
- `subscription.manage`: Change billing status, apply manual credits or extensions.
- `plan.read`: View plan tiers and catalog definitions.
- `plan.manage`: Create or update plan definitions and pricing versions.
- `entitlement.read`: View platform entitlement definitions.
- `entitlement.manage`: Apply tenant-specific quota overrides.
- `feature_flag.read`: View platform feature flags.
- `feature_flag.manage`: Toggle or reconfigure global and tenant-level feature flags.

### Platform Automation & n8n
- `automation.read`: View cross-tenant automation health and execution stats.
- `automation.manage`: Configure automation engine parameters.
- `automation.pause`: Temporarily pause automation dispatching.
- `automation.resume`: Resume automation dispatching.
- `automation.kill`: Trigger emergency automation kill-switch.
- `n8n.read`: View n8n cluster worker nodes and queues.
- `n8n.manage`: Perform rolling restarts and node scaling.
- `n8n.health`: Run diagnostics on n8n webhook ingress.
- `provider.read`: View external provider statuses and circuit breakers.
- `provider.manage`: Reset circuit breakers and update provider configurations.
- `execution.read`: View platform-wide execution records.
- `execution.retry`: Trigger replay of failed executions.
- `execution.cancel`: Terminate active running executions.
- `dlq.read`: Inspect dead letter queue entries.
- `dlq.retry`: Replay DLQ messages.
- `dlq.resolve`: Discard or mark DLQ messages as resolved.

### Support & Diagnostics
- `support.read`: View diagnostics data for a tenant.
- `support.impersonate`: Initiate a governed support impersonation session.

### Security, Audit & Maintenance
- `security.read`: View platform security events and threat feeds.
- `security.manage`: Revoke privileged sessions, configure IP blocks.
- `audit.read`: Read immutable platform audit logs.
- `audit.export`: Generate tamper-evident audit log export bundles.
- `maintenance.read`: View scheduled maintenance windows.
- `maintenance.manage`: Schedule and broadcast platform maintenance windows.
