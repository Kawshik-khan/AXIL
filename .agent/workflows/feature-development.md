---
description: Develop any CommerceOS feature end to end — spec, backend, UI, tests, verification, docs
---

# Feature Development Workflow

Follow this 16-step disciplined procedure for developing any new feature in CommerceOS:

```
[ Step 1: Understand Requirement ] ───► [ Step 2: Read .agent Instructions ]
                 │
                 ▼
[ Step 3: Inspect Codebase ] ──────────► [ Step 4: Write Feature Specification ]
                 │
                 ▼
[ Step 5: Define Architecture Impact ] ─► [ Step 6: Define Data & API Contracts ]
                 │
                 ▼
[ Step 7: Implement Backend & Domain ] ─► [ Step 8: Implement Frontend Bento UI ]
                 │
                 ▼
[ Step 9: Wire Agent / n8n Integrations ]► [ Step 10: Implement Automated Tests ]
                 │
                 ▼
[ Step 11: Run Linter & Typecheck ] ───► [ Step 12: Run Test Suites ]
                 │
                 ▼
[ Step 13: Security Audit ] ───────────► [ Step 14: UX & State Review ]
                 │
                 ▼
[ Step 15: Update .agent Docs ] ────────► [ Step 16: Update Roadmap & Changelog ]
```

---

## Detailed Step Protocol

1. **Understand Requirement**: Clarify user goals, target persona, and acceptance criteria.
2. **Read `.agent` Instructions**: Check domain rules in `rules/`, design system in `DESIGN_SYSTEM.md`, and relevant skills in `skills/`.
3. **Inspect Codebase**: Audit existing domain models, repositories, and UI components to maximize reuse and avoid duplication. Check `STATUS.md` and the audit for open findings in the area you're touching.
4. **Write Feature Spec**: Create specification using `.agent/templates/feature-spec.md`.
5. **Define Architecture Impact**: Ensure the feature respects boundary rules (no direct DB access from LLMs, no n8n as core backend).
6. **Define Data & API Contracts**: Document schema changes and REST API endpoints in `.agent/API_CONTRACTS.md`.
7. **Implement Backend & Domain**: Build domain service logic with strict Zod validation and atomic transactions.
8. **Implement Frontend UI**: Build Bento cards and pages using Vanilla CSS tokens and floating dock navigation.
9. **Wire Agent / n8n Integrations**: Register tool definitions in the Agent Gateway and configure n8n webhook triggers if required.
10. **Implement Automated Tests**: Write unit, integration, and UI state tests.
11. **Run Typecheck**: `npm run type-check` — the error count must not increase (baseline has pre-existing errors). `npm run lint` has no ESLint config yet.
12. **Run Test Suites**: the relevant `node tests/ts-runner.cjs ./tests/<area>-tests.ts`, then `npm test`.
13. **Security Audit**: Verify tenant isolation, RBAC permissions, and input sanitization.
14. **UX & State Review**: Validate that all 6 UI states (Loading, Success, Empty, Error, Unauthorized, No Permission) render cleanly.
15. **Update `.agent` Docs**: sync API/schema docs; update `STATUS.md` with the capability's honest status (LIVE only if traced end-to-end).
16. **Update Roadmap & Changelog**: Record milestone progress in `ROADMAP.md` and `CHANGELOG.md`.
