# Workflow: Tenant Suspension Procedure

Follow this 12-step governed procedure when suspending a tenant workspace:

```
[ Step 1: Inbound Suspension Request ]
               │
               ▼
[ Step 2: Resolve Target Tenant Record ]
               │
               ▼
[ Step 3: Verify Current State (Must be 'ACTIVE' or 'PAST_DUE') ]
               │
               ▼
[ Step 4: Verify Platform Authorization ('tenant.suspend') ]
               │
               ▼
[ Step 5: Policy Evaluation (Check enterprise contract clauses) ]
               │
               ▼
[ Step 6: Validate Mandatory Justification Reason ]
               │
               ▼
[ Step 7: Dual Approval Check (Required if tenant active > 30 days) ]
               │
               ▼
[ Step 8: Execute Tenant Suspension Domain Operation ]
               │
               ▼
[ Step 9: Verify Post-State Invariants (is_active == false, status == 'SUSPENDED') ]
               │
               ▼
[ Step 10: Emit Domain Event ('tenant.suspended') ]
               │
               ▼
[ Step 11: Write Append-Only Platform Audit Log ]
               │
               ▼
[ Step 12: Dispatch Operator & Merchant Notifications ]
```

---

## Detailed Step Protocol

1. **Inbound Suspension Request**: Initiated via `POST /api/v1/platform/tenants/:id/suspend`.
2. **Resolve Target Tenant**: Load tenant record from PostgreSQL. Return 404 if not found.
3. **Verify Current State**: Target must currently be `ACTIVE` or `PAST_DUE`. Reject if already `SUSPENDED` or `ARCHIVED`.
4. **Platform Authorization**: Call `PlatformAuthorizationService.assertCan(context, 'tenant.suspend')`.
5. **Policy Evaluation**: Check whether tenant is on a custom enterprise SLA requiring executive notification.
6. **Validate Justification Reason**: Operator must provide text justification (minimum 15 characters, e.g. *"Fraudulent payment activity detected ticket #1029"*).
7. **Approval Gate**: If tenant is on an Enterprise plan or active for $> 30$ days, mandate second-operator approval.
8. **Execute Suspension**:
   - Update `tenants.status = 'SUSPENDED'` atomically.
   - Deactivate all incoming webhook endpoints for that tenant.
   - Pause all scheduled and queued automations in the retry queue.
   - Invalidate all active user session tokens for that tenant.
9. **Verify Post-State**: Assert that subsequent authenticated requests for that tenant fail with HTTP 403 `TenantSuspendedError`.
10. **Emit Event**: Publish `tenant.suspended` to Redis Pub/Sub.
11. **Write Audit Log**: Log actor, tenant ID, reason, before/after snapshot to `platform_audit_logs`.
12. **Dispatch Notifications**: Send automated email/SMS alert to tenant owner explaining suspension and resolution steps.
