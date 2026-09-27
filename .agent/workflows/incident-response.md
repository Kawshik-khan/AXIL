---
description: Respond to a production incident — classify severity, contain, diagnose, remediate, post-mortem
---

# Incident Response & Outage Mitigation Workflow

Follow this procedure during critical production incidents (P0/P1) in CommerceOS:

## 1. Severity Classification

- **P0 (Critical Outage)**: System unavailable, database corrupted, cross-tenant data leak, or payment processing offline.
- **P1 (Major Degradation)**: Courier booking failing, social messaging webhook ingress stalled, or agent hallucination affecting orders.
- **P2 (Minor Issue)**: Non-critical dashboard card error, analytics delay, or isolated UI defect.

---

## 2. Response Protocol (P0 / P1)

1. **Containment**:
   - For LLM outages or hallucinations: Switch Agent Orchestrator to *Deterministic Fallback Mode* (disables agent autonomy, forces human operator handoff).
   - For payment gateway errors: Disable affected payment method and fall back to Cash on Delivery (COD).
   - For security leaks: Invalidate active sessions immediately.

2. **Triage & Diagnosis**:
   - Query structured logs using `trace_id` and `request_id`.
   - Inspect PostgreSQL connection pool, Redis memory, and queue backlog.

3. **Remediation**:
   - Apply hotfix following `.agent/workflows/bug-fixing.md` or roll back to last known good container image.

4. **Post-Mortem & Incident Report**:
   - Within 24 hours of resolution, author an incident report using `.agent/templates/incident-report.md`.
   - Identify timeline, root cause, impact, and preventive action items.
