---
trigger: glob
description: Governed read-only support impersonation
globs: src/domains/platform/services/platform-support.service.ts, src/app/api/v1/platform/**/*
---

# Support Impersonation Security & Boundary Rules

## 1. Prime Directive: Governed Diagnostic Boundary
Support Impersonation is a tightly governed diagnostic mechanism for assisting merchants with operational anomalies. It is **NEVER** an escalation backdoor, persistent bypass, or tool for routine administrative browsing:

```
┌────────────────────────────────────────────────────────┐
│             SUPPORT IMPERSONATION LIFECYCLE            │
│                                                        │
│ 1. Request Initiated (Support Ticket & Reason entered) │
│ 2. Permission Check ('support.impersonate')            │
│ 3. Step-Up Authentication (MFA challenge verified)     │
│ 4. Policy Check (Target tenant must not be suspended)  │
│ 5. Session Generated (Short-lived token, max 30 min)   │
│ 6. Effective Role Assigned = TARGET USER'S ROLE ONLY   │
│ 7. Default Mode Enforced = READ_ONLY                   │
│ 8. Persistent Amber Banner Displayed in UI             │
│ 9. Dual-Attribution Audit Log on Every Request         │
│ 10. Automatic Expiration or Immediate Revocation       │
└────────────────────────────────────────────────────────┘
```

---

## 2. Inviolable Impersonation Invariants
1. **Zero Privilege Escalation**:
   - The effective permission set during an impersonation session is **EXCLUSIVELY** the target user's permissions within that specific tenant.
   - **Effective Permissions = Target User Permissions.**
   - **NOT:** `Super Admin Permissions + Target Permissions`.
   - The operator loses all platform capabilities while operating within the impersonated tenant context. Under no circumstances may an impersonated session invoke `/api/v1/platform/*` endpoints.

2. **Default `READ_ONLY` Enforcement**:
   - Every impersonation session defaults to `READ_ONLY` mode.
   - In `READ_ONLY` mode, all mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) are blocked at the API gateway layer with HTTP 403 `ImpersonationReadOnlyViolation`.
   - Modifying data (e.g. unblocking a stuck order) requires explicit `MUTATION_APPROVED` mode, requiring dual-custodian signoff and merchant ticket authorization.

3. **Mandatory Dual-Actor Audit Attribution**:
   - Every operational and audit log generated during an impersonation session must preserve:
     - `actor_id`: The platform operator's global user ID.
     - `effective_actor_id`: The impersonated tenant user's ID.
     - `tenant_id`: The target tenant ID.
     - `impersonation_session_id`: Unique UUID of the impersonation session.
     - `correlation_id` and `request_id`.
     - `reason`: The verified support ticket reference and justification.

4. **Time-Bounded & Instantly Revocable**:
   - Impersonation sessions expire in a hard maximum of 30 minutes from creation.
   - Any platform operator with `PLATFORM_SECURITY` or `SUPER_ADMIN` authority, or the merchant Tenant Owner, may immediately revoke an active session via `POST /api/v1/platform/impersonate/:id/revoke`.

5. **Persistent UI Visual Indicator**:
   - While an impersonation session is active, the frontend must render a prominent, non-dismissible, high-contrast amber banner across the top of the interface:
     - Clear text: *"OPERATING UNDER SUPPORT IMPERSONATION — [Target User] @ [Tenant Name]"*.
     - Session countdown timer.
     - Mode badge: `[READ ONLY]`.
     - Prominent "Terminate Impersonation" action button.
