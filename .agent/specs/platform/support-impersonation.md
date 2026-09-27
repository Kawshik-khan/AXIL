# Workflow: Governed Support Impersonation Execution

Follow this 12-step sequence when initiating and terminating an impersonation session:

```
[ Step 1: Select Target Tenant ]
               │
               ▼
[ Step 2: Select Target User ]
               │
               ▼
[ Step 3: Enter Support Ticket & Justification Reason ]
               │
               ▼
[ Step 4: Verify Platform Permission ('support.impersonate') ]
               │
               ▼
[ Step 5: Step-Up Authentication Challenge (Verify TOTP/WebAuthn) ]
               │
               ▼
[ Step 6: Policy Engine Validation (Tenant Active & Impersonation Allowed) ]
               │
               ▼
[ Step 7: Issue Short-Lived Impersonation Token (Max 30 min) ]
               │
               ▼
[ Step 8: Scope Role to Target User's Tenant Permissions (READ_ONLY by default) ]
               │
               ▼
[ Step 9: Render Persistent Amber Alert Banner in Frontend Shell ]
               │
               ▼
[ Step 10: Emit 'impersonation.session.started' Audit Event ]
               │
               ▼
[ Step 11: Execute Diagnostic Inspection under Dual-Attribution ]
               │
               ▼
[ Step 12: Session Expiration or Manual Termination ──► Emit 'impersonation.session.ended' ]
```

---

## Detailed Step Protocol

1. **Select Tenant**: Operator searches for tenant in the Platform Command Center.
2. **Select User**: Select the specific user experiencing the issue (e.g. store manager or staff).
3. **Enter Reason**: Mandatory support ticket reference (e.g. `TICKET-8841`) and explanation (min 15 chars).
4. **Permission Check**: Assert caller holds `support.impersonate` permission.
5. **Step-Up Challenge**: Prompt operator for two-factor authentication token; verify server-side.
6. **Policy Check**: Confirm target tenant is not under legal hold or configured with an enterprise "No-Impersonation" compliance policy.
7. **Issue Token**: Generate an ephemeral JWT containing `impersonation_session_id`, `actor_id`, `effective_actor_id`, and `exp = now + 1800s`.
8. **Enforce READ_ONLY**: By default, block all mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`).
9. **Amber Banner**: UI mounts a top banner displaying target user, countdown clock, and immediate exit button.
10. **Emit Start Audit**: Write immutable record to `platform_audit_logs`.
11. **Perform Diagnostics**: Operator inspects error logs, order timelines, or webhook traces within the merchant workspace.
12. **Termination & End Audit**: When time expires or operator clicks "Terminate Session", revoke the token in Redis and write an `impersonation.session.ended` audit log capturing session duration.
