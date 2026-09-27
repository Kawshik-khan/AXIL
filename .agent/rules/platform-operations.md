---
trigger: glob
description: n8n fleet, kill switches, authorization vs entitlement vs flag
globs: src/domains/platform/**/*, src/domains/automation/**/*
---

# Platform Operations, Automation Fleet & Emergency Controls Rules

## 1. Governance of n8n Clusters & Workflow Automation
CommerceOS maintains clear architectural sovereignty between the application core and external automation engines:

```
┌────────────────────────────────────────────────────────┐
│                   SOVEREIGNTY INVARIANT                │
├──────────────────────────┬─────────────────────────────┤
│  COMMERCEOS PLATFORM     │   n8n ORCHESTRATION ENGINE  │
├──────────────────────────┼─────────────────────────────┤
│ - Immutable Source of Truth│ - Workflow Execution Graph │
│ - Cryptographic Auth     │ - Timed Cron Scheduling     │
│ - Policy Engine Checks   │ - External API Connectors   │
│ - Financial Transactions │ - Retry Backoff Runner      │
│ - Authoritative State    │ - Notification Fan-Out      │
└──────────────────────────┴─────────────────────────────┘
```

- **NEVER** allow n8n to become the primary transactional database or business logic layer.
- Super Admin controls n8n instances, health, workflow versioning, DLQ replays, and safety circuits via `PlatformAutomationService`.
- All n8n actions that mutate platform or tenant state must authenticate against CommerceOS REST APIs (`/api/v1/*`), passing through the Policy Engine.

---

## 2. Emergency Kill Switch Architecture
The emergency kill switch protects platform infrastructure during runaway execution loops, provider outages, or security anomalies:

### 2.1 Multi-Scope Hierarchy
Emergency stops can be triggered at 6 distinct granularities:
1. **`GLOBAL`**: Instantly halts all automation dispatching and background worker execution platform-wide.
2. **`TENANT`**: Freezes automation runs for a single misbehaving or compromised tenant.
3. **`WORKFLOW`**: Disables a specific workflow definition (e.g. `order-created-notification`) across all or specific tenants.
4. **`PROVIDER`**: Trips circuit breakers for a failing third-party gateway (e.g. Pathao or bKash).
5. **`CHANNEL`**: Pauses ingress/egress on a social channel (e.g. WhatsApp Cloud API during Meta outages).
6. **`ENVIRONMENT`**: Isolates staging or canary environments.

### 2.2 Kill Switch Invariants
- **Governed Domain Service**: A kill switch must **NEVER** be a simple in-memory boolean (`globalKillSwitch = true`). It must be managed by `PlatformKillSwitchService` backed by distributed Redis flags and persistent database state.
- **Draining & Safe Halting**:
  - Halts new inbound triggers immediately.
  - Active running executions are given a graceful drain window (up to 30 seconds) to checkpoint state or abort safely to DLQ.
- **Mandatory Requirements**:
  - Requires `automation.kill` permission.
  - Requires step-up authentication.
  - Requires explicit justification reason.
  - Generates immutable audit records and broadcasts immediate alerts to operators.
  - Must be fully reversible via `deactivateKillSwitch()`.

---

## 3. Disambiguation: Authorization vs Entitlement vs Feature Flags
Future agents must never conflate these three distinct control concepts:

| Dimension | Core Question | Managed By | Example |
| :--- | :--- | :--- | :--- |
| **Authorization** | *"Is this ACTOR permitted to perform this action?"* | `PlatformAuthorizationService` / `RbacService` | Platform Support has permission `tenant.suspend`. |
| **Entitlement** | *"Has this TENANT purchased/contracted access to this feature?"* | `EntitlementService` | Growth tier allows up to 5 social channels. |
| **Feature Flag** | *"Is this FEATURE currently turned ON by system operators?"* | `FeatureFlagService` | `flag.social_widget_v2` enabled for 20% canary rollout. |

- **Inviolable Invariant**: A feature flag being `true` does **NOT** bypass authorization or tenant entitlements. All three gates must evaluate to `ALLOW` for a feature to execute.
