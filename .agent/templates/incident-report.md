# Incident Post-Mortem Report Template

## 1. Incident Overview
- **Incident ID**: [INC-YYYY-XXXX]
- **Severity**: [P0 / P1 / P2]
- **Date & Time**: [Start Time] to [Resolved Time]
- **Duration**: [X hours, Y minutes]
- **Lead Responder**: [Name]

---

## 2. Customer & Business Impact
- Number of affected tenants / merchants.
- Total dropped orders / unverified transactions / failed courier bookings.
- Operational revenue at risk.

---

## 3. Incident Timeline
- **09:00**: Issue first detected via [monitoring alert / merchant ticket].
- **09:15**: Triage initiated by on-call engineer.
- **09:35**: Root cause identified as [cause].
- **09:50**: Mitigation deployed [hotfix / rollback].
- **10:05**: Telemetry verified normal operations restored.

---

## 4. Root Cause Analysis (5 Whys)
1. Why did the failure occur?
2. Why did our safeguards fail to catch it?
3. Why was detection delayed?

---

## 5. Preventative Action Items
| Action Item | Owner | Target Due Date | Status |
| :--- | :--- | :--- | :--- |
| Add regression test for edge case | [Name] | [Date] | Open |
| Tighten Policy Engine threshold | [Name] | [Date] | Open |
