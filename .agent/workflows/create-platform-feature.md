---
description: Build a super-admin / platform control-plane feature through the 15-step governed lifecycle
---

# Workflow: Create Platform Control Plane Feature

Follow this 15-step disciplined lifecycle when proposing, designing, or implementing ANY platform control plane feature:

```
[ Step 1: Inspect Architecture ] ───► [ Step 2: Identify Scope (PLATFORM vs TENANT) ]
               │
               ▼
[ Step 3: Identify Actor ] ─────────► [ Step 4: Define Granular Permission ]
               │
               ▼
[ Step 5: Define Policy & Gate ] ───► [ Step 6: Define Risk Tier (LOW-CRITICAL) ]
               │
               ▼
[ Step 7: Define Domain Service ] ──► [ Step 8: Define API Contract (/api/v1/platform/*) ]
               │
               ▼
[ Step 9: Define Audit Event ] ─────► [ Step 10: Define Observability & Telemetry ]
               │
               ▼
[ Step 11: Define Bento UI Card ] ──► [ Step 12: Define Automated Test Suite ]
               │
               ▼
[ Step 13: Security Review Gate ] ──► [ Step 14: Update .agent Documentation ]
               │
               ▼
[ Step 15: Run Full Verification Suite & Zero Regression Check ]
```

---

## Detailed Step Protocol

1. **Inspect Existing Architecture**: Read `.agent/GOVERNANCE.md` §4–5, `.agent/skills/platform-control-plane/SKILL.md`, and relevant `rules/platform-*.md`. Check `src/domains/platform/services/` for an existing service.
2. **Identify Scope**: Strictly resolve whether the feature is `PLATFORM` or `TENANT`. Never mix the two.
3. **Identify Actor**: Determine who executes the feature (`PlatformUser`, `SystemWorker`, `AgentRuntime`).
4. **Define Permission**: Assign or create a granular permission in `PLATFORM_PERMISSIONS` (e.g. `tenant.suspend`).
5. **Define Policy**: Establish constraints (e.g., minimum tenant status, business hours, geofencing).
6. **Define Risk Tier**: Classify as `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`.
7. **Define Domain Service**: Implement typed business logic inside `src/domains/platform/*` with transactional ACID guarantees.
8. **Define API**: Document route under `/api/v1/platform/*` in `.agent/API_CONTRACTS.md` with strict Zod validation.
9. **Define Audit Event**: Formulate audit schema capturing before/after diffs, actor, and reason.
10. **Define Observability**: audit entry plus structured log (see `skills/observability`); metrics TARGET.
11. **Define UI**: Design Bento Card adhering to Charcoal (`#242529`) / Lime (`#C7F900`) palette with all 6 UX states.
12. **Define Tests**: Implement unit, integration, and security negative test cases.
13. **Security Review**: Execute `platform-security-review.md` checklist covering all 20 threat vectors.
14. **Update Documentation**: Synchronize `.agent/DATA_MODEL.md`, `API_CONTRACTS.md`, and `STATUS.md`.
15. **Verify Regression**: Run the entire automated test suite to ensure zero regressions.
