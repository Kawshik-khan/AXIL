---
description: Run the 20-point security review before marking platform/privileged work done
---

# Workflow: Platform Security Review Checklist

Before any privileged, platform, or administrative feature is marked **DONE**, an agent or engineer must complete this rigorous 20-point security audit checklist:

```
┌────────────────────────────────────────────────────────┐
│           PLATFORM SECURITY REVIEW CHECKLIST           │
├────┬───────────────────────┬───────────────────────────┤
│ #  │ Security Domain       │ Verification Requirement  │
├────┼───────────────────────┼───────────────────────────┤
│ 1  │ Authentication        │ PlatformSessionToken with │
│    │                       │ valid signature & TTL.    │
│ 2  │ Authorization         │ PlatformAuthorization     │
│    │                       │ Service.assertCan() used. │
│ 3  │ Scope Validation      │ Assert Scope == PLATFORM; │
│    │                       │ reject tenant JWTs.       │
│ 4  │ Tenant Isolation      │ No raw un-scoped tenant   │
│    │                       │ queries in controllers.   │
│ 5  │ IDOR Defense          │ IDs resolved from context │
│    │                       │ or ownership verified.    │
│ 6  │ Impersonation Safety  │ Scoped to target perms,   │
│    │                       │ READ_ONLY default.        │
│ 7  │ Secret Protection     │ Masked in API & UI;       │
│    │                       │ encrypted at rest.        │
│ 8  │ Session Security      │ 15m idle TTL, MFA enforced│
│    │                       │ global revocation ready.  │
│ 9  │ Audit Accountability  │ Append-only audit log with│
│    │                       │ diff, actor, and reason.  │
│ 10 │ CSRF Mitigation       │ SameSite cookies & custom │
│    │                       │ authorization headers.    │
│ 11 │ XSS Prevention        │ Auto-escaped templates;   │
│    │                       │ strict CSP headers.       │
│ 12 │ SSRF Prevention       │ Whitelisted provider URLs;│
│    │                       │ metadata IP blocked.      │
│ 13 │ SQL Injection Defense │ 100% parameterized ORM;   │
│    │                       │ zero raw string queries.  │
│ 14 │ Race Conditions       │ Redis distributed lock on │
│    │                       │ concurrent operations.    │
│ 15 │ Replay Protection     │ Timestamp drift verified  │
│    │                       │ (<300s); idempotency key. │
│ 16 │ Bulk Action Controls  │ Progressive rollout;      │
│    │                       │ dry-run simulation mode.  │
│ 17 │ Kill Switch Safety    │ Responds immediately to   │
│    │                       │ active emergency stop.    │
│ 18 │ Approval Gates        │ Dual-custodian signoff on │
│    │                       │ CRITICAL operations.      │
│ 19 │ Observability         │ Structured telemetry logs │
│    │                       │ and Prometheus metrics.   │
│ 20 │ Automated Test Proof  │ Unit, integration &       │
│    │                       │ negative security tests.  │
└────┴───────────────────────┴───────────────────────────┘
```

- Items that are not implemented platform-wide yet (MFA/step-up, CSP, rate limiting, Prometheus) must be marked **N/A — TARGET (finding ID)** in your review rather than ticked.
- **Definition of Done Requirement**: If ANY of the 20 checklist points fails, the PR or feature is rejected and cannot be merged or claimed as complete.
