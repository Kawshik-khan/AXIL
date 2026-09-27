---
trigger: glob
description: Platform control-plane areas and scope separation
globs: src/domains/platform/**/*, src/app/api/v1/platform/**/*, src/app/super-admin/**/*
---

# Platform Administration & SaaS Owner Governance Rules

## 1. Scope separation & assessment questions
Canonical text: `GOVERNANCE.md` §4 (platform vs tenant scope) and §5 (the 11 assessment questions). Answer the 11
questions in your plan before designing or changing any control-plane code, tool, or endpoint.

Summary: platform administration is **not** a tenant feature; `OWNER` never implies `SUPER_ADMIN`; platform roles live
only in `PlatformMembership` and are checked through `PlatformAuthorizationService.assertCan` with granular permissions.

---

## 2. Platform Operational Domains
All platform administrative workflows are organized across 18 authoritative control areas:
1. **Command Center**: SaaS fleet health, real-time MRR, tenant counts, active incidents.
2. **Tenants**: Provisioning, lifecycle management, status, diagnostics.
3. **Users**: Platform operator identities, global account security.
4. **Subscriptions**: SaaS billing tiers, renewal cycles, payment status.
5. **Plans**: Plan definitions, pricing versioning, feature packaging.
6. **Entitlements**: Quotas, limits, tenant-specific overrides.
7. **Usage**: Real-time quota consumption telemetry.
8. **Automations**: Cross-tenant automation health, throughput, error rates.
9. **n8n**: Worker cluster topology, versions, rolling restarts.
10. **Providers**: Gateway circuit breakers (couriers, MFS, AI providers).
11. **System Health**: Database connection pools, Redis memory, queue depth.
12. **Incidents**: Outage declarations, status updates, post-mortems.
13. **Security**: Security event feed, failed login velocity, IP blocks.
14. **Audit**: Immutable, tamper-evident platform action log.
15. **Support**: Governed impersonation with short-lived read-only sessions.
16. **Feature Flags**: Global toggles, percentage canaries, tenant allowlists.
17. **Maintenance**: Scheduled service windows and tenant notifications.
18. **Settings**: Centralized AI routing, storage defaults, compliance rules.

Implementation lives in `src/domains/platform/services/` (one service per area) and `src/app/api/v1/platform/**`;
UI in `src/app/super-admin/`. Several gates (kill switches, flags, entitlements) are not yet enforced — see STATUS.md (H11).
