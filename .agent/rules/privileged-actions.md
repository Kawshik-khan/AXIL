---
trigger: glob
description: Risk tiers, justification, step-up, dual approval
globs: src/domains/platform/**/*, src/app/api/v1/platform/**/*
---

# Privileged Action & Risk Governance Rules

## 1. 4-Tier Risk Classification Framework
Every administrative and platform action is categorized into one of four immutable risk tiers. Critical actions must NEVER become simple unverified frontend mutations:

| Risk Tier | Definition | Examples | Step-Up Required? | Approval Required? | Audit Requirements |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **`LOW`** | Read-only operations, operational views, non-sensitive telemetry. | View platform dashboard, inspect n8n health, view plan list, check worker node status. | No | No | Standard structured log. |
| **`MEDIUM`** | Routine operational mutations with reversible impacts on single entities. | Change tenant plan tier, update non-sensitive platform setting, adjust tenant entitlement quota. | No (within active session) | No | Mutation audit log with before/after state diff. |
| **`HIGH`** | Operations affecting tenant availability, automation execution, or security sessions. | Suspend tenant workspace, initiate support impersonation, pause automation dispatching, trigger manual DLQ replay. | **Yes** (MFA / WebAuthn token within 5 min) | Optional (Required if tenant active $> 30$ days) | Full privileged audit log with justification reason and IP attribution. |
| **`CRITICAL`** | Irreversible mutations, global kill switches, security policy changes, credential adjustments. | Purge/delete tenant data, activate global automation kill switch, modify platform auth keys, rotate root provider credentials. | **Yes** (Mandatory WebAuthn / Passkey) | **Yes** (Dual-custodian two-person rule) | Cryptographically signed immutable audit record, real-time security alert to ops team. |

---

## 2. Justification & confirmation (canonical — other docs link here)
- Every `MEDIUM`+ mutation requires a written reason of **at least 10 characters** (enforced today in `platform-support.service.ts`); `HIGH`/`CRITICAL` reasons must also reference a ticket or incident ID.
- `CRITICAL` actions additionally require typing the exact entity slug or confirmation phrase in the UI.

## 3. Inviolable Privileged Action Invariants
1. **Mandatory Specification Contract**:
   Every privileged action in code must explicitly declare:
   - `riskLevel`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`
   - `requiredPermission`: Valid permission from `PLATFORM_PERMISSIONS`
   - `requiredScope`: `PLATFORM` or `TENANT`
   - `stepUpRequired`: Boolean indicating mandatory TOTP/WebAuthn proof
   - `approvalRequired`: Boolean indicating dual-custodian authorization
   - `auditRequired`: Always `true` for mutating actions
   - `verificationStrategy`: Post-state invariant check function
   - `rollbackStrategy`: Documented compensating transaction or automated rollback

2. **Step-Up Verification Enforcement**:
   - `HIGH` and `CRITICAL` actions must validate the `X-Step-Up-Token` header.
   - A step-up token is valid for a maximum sliding window of 300 seconds (5 minutes) and is invalidated immediately following execution of a `CRITICAL` action.

3. **Dual-Custodian Approval Gate**:
   - `CRITICAL` actions cannot be executed unilaterally by a single operator.
   - An approval request must be submitted via `ApprovalService`, creating a pending approval record.
   - A second authorized operator with `SUPER_ADMIN` or `PLATFORM_SECURITY` authority must cryptographically sign and approve the request before execution can proceed.

4. **Honest gates**: if step-up or approval is not really implemented, the action must fail closed (`StepUpRequiredError` / `ApprovalRequiredError`) — never pass on arbitrary input (audit H10).

5. **Rollback & Compensating Actions**:
   - Every mutating privileged action must implement a documented recovery path. Destructive purge operations must require an intermediate soft-deleted tombstone state lasting a minimum of 14 days before physical eviction.
