---
trigger: glob
description: Single source of truth, target vs current, ADRs
globs: .agent/**/*.md, AGENTS.md, CLAUDE.md
---

# Documentation Maintenance Rules

1. **One source of truth per topic** — link, don't copy:
   - Invariants, 11 questions, Definition of Done → `GOVERNANCE.md`
   - What works today → `STATUS.md`
   - Design tokens → `src/styles/tokens.css` (docs describe usage, not values)
   - Roles & permissions → `src/lib/permissions.ts` and `platform-authorization.service.ts`
   - Numeric thresholds (RAG cutoffs, fees, limits) → the constant in code; docs cite the file, not the number.

2. **Sync with code**: when you change an API contract, schema, permission, agent tool allow-list, or architecture, update the matching `.agent/` doc in the same change. When you change what works, update `STATUS.md`.

3. **Target vs current**: architecture docs describe the target. Any section describing unbuilt behaviour carries `STATUS: TARGET`. Never describe target behaviour in the present tense as if it exists.

4. **ADRs**: changes to schema, authentication, tenant isolation, or agent boundaries need an ADR in `DECISIONS.md` (template: `templates/adr.md`) and a row in its index.

5. **Honest gaps**: write `STATUS: NOT IMPLEMENTED` or `TBD — <owner/question>` rather than inventing detail. Every doc must still give concrete examples for what *is* specified.

6. **Where things go**:
   - `rules/` — short, enforceable constraints (≤ ~60 lines each).
   - `skills/` — how-to knowledge for coding agents, with real file paths and commands.
   - `workflows/` — step-by-step development procedures.
   - `runtime-agents/` — behaviour specs for CommerceOS's own product agents (sales, support, …).
   - `specs/` — product procedures the software must implement (tenant suspension, impersonation, …).
