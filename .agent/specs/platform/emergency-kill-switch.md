# Workflow: Emergency Kill Switch Activation & Recovery

Follow this dual-phase protocol when activating and deactivating an emergency kill switch:

---

## Phase A: Emergency Kill Switch Activation

```
[ Step 1: Detect Anomaly or Threat Incident ]
               │
               ▼
[ Step 2: Determine Required Scope (GLOBAL, TENANT, WORKFLOW, PROVIDER) ]
               │
               ▼
[ Step 3: Verify Platform Authorization ('automation.kill') ]
               │
               ▼
[ Step 4: Enforce Step-Up Authentication (MFA / WebAuthn Challenge) ]
               │
               ▼
[ Step 5: Input Incident Justification Reason (min 20 characters) ]
               │
               ▼
[ Step 6: Policy Check (Assess blast radius & affected subsystems) ]
               │
               ▼
[ Step 7: Activate Kill Switch State in Redis & Persistent Database ]
               │
               ▼
[ Step 8: Verify Ingress Halt (New triggers blocked immediately) ]
               │
               ▼
[ Step 9: Drain or Abort In-Flight Executions (30s grace window) ]
               │
               ▼
[ Step 10: Commit Append-Only Audit Record ]
               │
               ▼
[ Step 11: Emit High-Priority Platform Security Event ]
               │
               ▼
[ Step 12: Dispatch Emergency Alert to Operations Team (SMS / Slack / Pager) ]
```

---

## Phase B: Post-Incident Recovery & Deactivation

```
[ Step 1: Post-Incident Review Completed & Threat Mitigated ]
               │
               ▼
[ Step 2: Verify Platform Authorization ('automation.kill') ]
               │
               ▼
[ Step 3: Enforce Step-Up Challenge (MFA Proof) ]
               │
               ▼
[ Step 4: Deactivate Kill Switch State in Redis & Persistent Database ]
               │
               ▼
[ Step 5: Verify Normal Execution Dispatches Resume Cleanly ]
               │
               ▼
[ Step 6: Commit Recovery Audit Record & Close Security Event ]
```

---

## Scope Behavior Specifications
- **`GLOBAL`**: Blocks all automation event ingestion, halts Redis queue workers, disables outbound webhooks.
- **`TENANT`**: Filters inbound events matching `tenant_id = :target`; drops or redirects executions to tenant dead-letter queue.
- **`WORKFLOW`**: Blocks specific workflow ID across tenants (e.g. during a buggy template release).
- **`PROVIDER`**: Trips circuit breaker for target adapter (`Pathao`, `bKash`, `Meta`), queuing calls for retry.
