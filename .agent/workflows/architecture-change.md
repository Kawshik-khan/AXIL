---
description: Make an architectural change (schema overhaul, auth model, agent boundaries) with an ADR and staged migration
---

# Architectural Change Workflow

Foundational architecture changes in CommerceOS (e.g. database schema overhauls, authentication model changes, agent boundary shifts) must follow this protocol:

1. **Assess Impact & Risks**:
   - Evaluate consequences on multi-tenancy, transactional consistency, API contracts, n8n workflows, and security.

2. **Draft Architectural Decision Record (ADR)**:
   - Create a new entry in `.agent/DECISIONS.md` using the ADR template.
   - Document: Context, Alternatives Considered, Chosen Decision, Trade-offs, and Consequences.

3. **Peer Review & User Alignment**:
   - Present the ADR to system architects or the user for approval. Proceed only upon formal approval.

4. **Plan Staged Migration**:
   - Maintain backward compatibility during transition.
   - Never break active production clients or webhook contracts in a single hard cutover.

5. **Execute Incremental Changes**:
   - Update database migrations and domain services first.
   - Update API contracts and integration adapters second.
   - Update frontend control plane and agent tools third.

6. **Update `.agent` Operating System**:
   - Update `ARCHITECTURE.md`, `SYSTEM_DESIGN.md`, and relevant rules to match the new paradigm.
