---
trigger: glob
description: Domain service design, Zod validation, transactions, events
globs: src/domains/**/*.ts, src/lib/**/*.ts
---

# Backend & Domain Engineering Rules

1. **Domain Isolation**:
   - Organize business logic by domain (`domains/orders/`, `domains/inventory/`, `domains/payments/`).
   - Domain services must encapsulate all business validation, invariant enforcement, and state transitions.

2. **Schema Validation**:
   - Every incoming HTTP request and internal tool argument must be validated at runtime using Zod.
   - Strip unrecognized fields and reject payloads failing type checks.

3. **Transaction Safety**:
   - Multi-step operations (e.g., checkout: create order + lock inventory + record payment initiation) must execute within an atomic PostgreSQL transaction.
   - If any step fails, roll back completely. Never leave orphaned or partially committed records.

4. **Event Emission**:
   - Domain services must emit typed domain events after successfully committing state transitions to the database.
