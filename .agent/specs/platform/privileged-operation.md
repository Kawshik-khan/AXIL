# Workflow: Privileged Operation Execution Pipeline

Follow this authoritative 8-stage gatekeeper pipeline for executing any privileged or mutating platform operation:

```
[ 1. AUTHENTICATE ] ──► Verify PlatformSessionToken signature & TTL
         │
         ▼
[ 2. AUTHORIZE ] ────► PlatformAuthorizationService.assertCan(context, permission)
         │
         ▼
[ 3. POLICY ] ───────► Evaluate state guards, tenant status, rate limits
         │
         ▼
[ 4. STEP-UP ] ──────► Validate X-Step-Up-Token (Required if HIGH or CRITICAL)
         │
         ▼
[ 5. APPROVAL ] ─────► Verify dual-custodian approval record (Required if CRITICAL)
         │
         ▼
[ 6. EXECUTE ] ──────► Perform atomic domain mutation via typed domain service
         │
         ▼
[ 7. VERIFY ] ───────► Cryptographically assert post-state matches invariants
         │
         ▼
[ 8. AUDIT ] ────────► Commit append-only audit record (actor, reason, diff)
```

---

## Stage Rules & Requirements by Risk Tier

1. **`LOW` Risk Operations**:
   - Executes stages: **1 (AUTHENTICATE)** $\rightarrow$ **2 (AUTHORIZE)** $\rightarrow$ **3 (POLICY)** $\rightarrow$ **6 (EXECUTE)** $\rightarrow$ **7 (VERIFY)**.
   - Example: Read platform overview telemetry, view tenant details.

2. **`MEDIUM` Risk Operations**:
   - Executes stages: **1** $\rightarrow$ **2** $\rightarrow$ **3** $\rightarrow$ **6** $\rightarrow$ **7** $\rightarrow$ **8 (AUDIT)**.
   - Example: Update tenant plan, adjust entitlement quota.

3. **`HIGH` Risk Operations**:
   - Executes stages: **1** $\rightarrow$ **2** $\rightarrow$ **3** $\rightarrow$ **4 (STEP-UP)** $\rightarrow$ **6** $\rightarrow$ **7** $\rightarrow$ **8 (AUDIT)**.
   - Step-up challenge (MFA / WebAuthn) required within 5-minute sliding window.
   - Example: Suspend tenant workspace, initiate support impersonation, pause automation.

4. **`CRITICAL` Risk Operations**:
   - Executes all 8 stages: **1** $\rightarrow$ **2** $\rightarrow$ **3** $\rightarrow$ **4 (STEP-UP)** $\rightarrow$ **5 (APPROVAL)** $\rightarrow$ **6** $\rightarrow$ **7** $\rightarrow$ **8 (AUDIT)**.
   - Step-up challenge and two-person dual-custodian approval are strictly mandatory.
   - Example: Purge tenant workspace, activate global automation kill switch, modify platform security configuration.

- **Inviolable Invariant**: Stages 1 (AUTHENTICATE) and 2 (AUTHORIZE) can **NEVER** be skipped under any circumstance.
