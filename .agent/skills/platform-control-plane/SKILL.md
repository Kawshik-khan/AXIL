---
name: platform-control-plane
description: Build or change CommerceOS super-admin / SaaS control-plane features — platform RBAC, tenant lifecycle, billing & entitlements, feature flags, kill switches, DLQ, support impersonation, platform audit. Use for anything under src/domains/platform, src/app/api/v1/platform, or src/app/super-admin.
---

# Platform Control Plane

## 1. Before you write code
1. Answer the 11 questions in `.agent/GOVERNANCE.md` §5 in your plan.
2. Check `.agent/STATUS.md` — several platform gates are currently **not enforced** (H11) and platform auth has open
   CRITICAL findings (C3, C8, H1, H10, M10). If your change sits on those paths, fix or explicitly scope around them.
3. Find the existing service before creating one:

| Area | Service (`src/domains/platform/services/`) | Rule |
|---|---|---|
| Authorization | `platform-authorization.service.ts` | `rules/platform-authorization.md` |
| Tenants / lifecycle | `platform-tenant.service.ts` | `rules/platform-billing.md` §3, `specs/platform/tenant-*.md` |
| Plans / subscriptions | `platform-subscription.service.ts` | `rules/platform-billing.md` |
| Entitlements | `platform-entitlement.service.ts` | `rules/platform-billing.md` §2 |
| Feature flags | `platform-feature-flag.service.ts` | `rules/platform-operations.md` §3 |
| Kill switches / safety | `platform-safety.service.ts` | `rules/platform-operations.md` §2, `specs/platform/emergency-kill-switch.md` |
| Settings | `platform-settings.service.ts` | `specs/platform/platform-config-change.md` |
| Support impersonation | `platform-support.service.ts` | `rules/impersonation.md`, `specs/platform/support-impersonation.md` |
| Audit | `platform-audit.service.ts` | `rules/platform-audit.md` |
| Incidents | `platform-incident.service.ts` | `workflows/incident-response.md` |
| Analytics | `platform-analytics.service.ts` | `rules/platform-data-access.md` (aggregates only, no PII) |
| Platform users | `platform-user.service.ts` | `rules/platform-security.md` §3 |

Automation fleet services (DLQ, circuit breakers, n8n provider, idempotency) live in `src/domains/automation/services/`.

## 2. Route skeleton

```ts
import { extractPlatformContext, apiSuccess, apiError } from "@/lib/api-response";
import { PlatformAuthorizationService } from "@/domains/platform/services/platform-authorization.service";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await extractPlatformContext(request);               // rejects tenant tokens
    PlatformAuthorizationService.assertCan(ctx, "tenant.suspend");   // granular permission, never role names
    const input = SuspendSchema.parse(await request.json());          // reason >= 10 chars (privileged-actions §2)
    // HIGH/CRITICAL: verify step-up + approval, fail closed if not implemented
    const result = await PlatformTenantService.suspend(ctx, params.id, input);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
```

Actor identity for approvals, audit, and "performed by" fields always comes from `ctx`, never the request body (audit H2).

## 3. Scope resolution (how `PlatformContext` must be built)
1. Verify the platform session token (signature, TTL, `scope === "PLATFORM"`); otherwise 401/403.
2. Load the active `PlatformMembership` for the user; inactive → 403.
3. Resolve permissions from the role; attach `mfaVerified` from a **real** factor check.
4. No header, query flag, or environment fallback may set the role (audit C3, H1).

## 4. Operational invariants
- **Tenant lifecycle** changes go through the tenant service state machine; every transition is authorized, audited (before/after), idempotent, and emits `tenant.*` events.
- **Entitlements**: ask `EntitlementService` "can this tenant do X?"; never `if (plan === "PRO")`. Warn at 80% and 100% of quota.
- **DLQ replay** needs `dlq.retry`, generates a fresh idempotency key, and keeps `correlation_id` back to the failed execution.
- **Kill switches** persist state (not an in-memory boolean), are checked on every dispatch path, and are reversible.
- **Impersonation** = target user's tenant permissions only, `READ_ONLY` by default, 30-minute max, amber banner, dual-actor audit.
- **Audit** is append-only; corrections are new entries linked by `correlation_id`; secrets are stripped from diffs.
- **Data access**: aggregates and metadata only; no PII outside an audited impersonation session; no raw query consoles.

## 5. Done checklist (plus GOVERNANCE §6)
- [ ] `extractPlatformContext` + `assertCan` with a granular permission on every route.
- [ ] Risk tier declared; HIGH/CRITICAL enforce step-up (and approval for CRITICAL) or fail closed.
- [ ] Audit record with actor, reason, before/after diff, result, `correlation_id`.
- [ ] Response is aggregate/metadata only; secrets masked.
- [ ] Negative tests in `tests/super-admin-tests.ts`: no token → 401; tenant `OWNER` token → 403; under-privileged platform role → 403.
- [ ] UI (in `src/app/super-admin/`) uses dark-variant tokens, 6 states, confirmation modal for HIGH/CRITICAL.
- [ ] Run the `platform-security-review` workflow.
