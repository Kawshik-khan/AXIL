---
trigger: glob
description: Append-only platform audit ledger schema and invariants
globs: src/domains/platform/**/*, src/domains/audit/**/*
---

# Platform Audit & Immutable Ledger Rules

## 1. Prime Directive: Immutable Forensic Accountability
Every privileged, mutating, or administrative action on the SaaS Platform Control Plane must generate an immutable, tamper-evident audit record:

```
┌────────────────────────────────────────────────────────┐
│              IMMUTABLE AUDIT LOG LIFECYCLE             │
│                                                        │
│ 1. Privileged Action Triggered                         │
│ 2. Context Captured (Actor, Role, Reason, Request ID)  │
│ 3. State Pre-Check (Before Snapshot)                   │
│ 4. Domain Mutation Executed                            │
│ 5. State Post-Check (After Snapshot)                   │
│ 6. Audit Record Emitted (Append-Only Write)            │
│ 7. Verification Invariant Checked                      │
│ 8. Security Stream Notification (if HIGH/CRITICAL)     │
└────────────────────────────────────────────────────────┘
```

---

## 2. Mandatory Audit Record Schema
Every platform audit log entry must strictly populate the following fields:
- `id`: Unique UUID.
- `actor_id`: Global user ID of the platform operator.
- `effective_actor_id`: User ID of the target user if operating under impersonation (or null).
- `platform_role`: Active platform role at time of action (`SUPER_ADMIN`, `PLATFORM_ADMIN`, etc.).
- `target_tenant_id`: Affected tenant UUID (or null if purely global platform resource).
- `action`: Canonical action string (e.g. `TENANT_SUSPENDED`, `PLAN_UPGRADED`, `KILL_SWITCH_ACTIVATED`).
- `resource_type`: Domain entity type (`tenant`, `plan`, `subscription`, `kill_switch`, `provider`).
- `resource_id`: Identifier of the modified entity.
- `reason`: Mandatory text explanation provided by the operator or ticket system.
- `before_state`: Sanitized JSON snapshot prior to mutation.
- `after_state`: Sanitized JSON snapshot following mutation.
- `result`: Execution outcome (`SUCCESS`, `FAILED`, `BLOCKED`).
- `error_message`: Error details if the operation failed.
- `request_id`: Tracing request ID.
- `correlation_id`: Distributed correlation ID linking across services.
- `impersonation_session_id`: UUID of impersonation session if active.
- `ip_address` & `user_agent`: Network origin metadata.
- `timestamp`: UTC ISO timestamp generated via `clock_timestamp()`.

---

## 3. Inviolable Audit Ledger Invariants
1. **Append-Only Immutability**:
   - Platform audit tables are strictly append-only.
   - **NEVER** issue `UPDATE` or `DELETE` SQL queries against `platform_audit_logs`.
   - Database trigger constraints and table permissions must prohibit updates or deletions by application service accounts.

2. **Audit Corrections via Compensating Entries**:
   - If an operational mistake is made, operators cannot edit previous audit records.
   - Any corrective or compensating action must generate a **new**, independent audit record linking back to the original event via `correlation_id`.

3. **Zero Secrets in Audit State Diffs**:
   - Passwords, session tokens, cryptographic private keys, and payment credentials must be stripped or masked before serializing `before_state` and `after_state` diffs.

4. **Tamper-Evident Exporting**:
   - Exported audit logs must include a cryptographic checksum (HMAC-SHA256) calculated across sequential records to guarantee that logs have not been truncated or altered in transit.
