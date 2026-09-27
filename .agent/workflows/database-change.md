---
description: Change persistence — JSON store records, Neon repositories, SQL migrations with rollback
---

# Database Change & Migration Workflow

Follow this procedure for making any schema or indexing changes to the PostgreSQL database in CommerceOS:

1. **Impact Analysis & Tenant Scoping Review**:
   - Verify that any new table includes `tenant_id UUID NOT NULL REFERENCES tenants(id)`.
   - Confirm foreign key cascade behaviors and index coverage.

2. **Draft Reversible Migration**:
   - Write `src/infrastructure/db/migrations/NNN_<name>.sql` plus `NNN_<name>.down.sql`. Keep seed data out of schema migrations.
   - Avoid long exclusive table locks on large production tables (e.g. use `CONCURRENTLY` for index creation).

3. **Local Migration & Rollback Test**:
   - Run migration `UP`. Inspect schema and test queries.
   - Run migration `DOWN`. Verify database returns cleanly to its previous state.
   - Re-run `UP`.

4. **Update ORM / Query Definitions**:
   - Update the `*Record` interface and accessors in `src/infrastructure/db/index.ts` (JSON store, live today) **and** the matching Neon repository in `src/domains/**/*.repository.ts`. There is no ORM.

5. **Update `.agent/DATA_MODEL.md`**:
   - Update the authoritative schema documentation in `.agent/DATA_MODEL.md`.

6. **Deploy Migration**:
   - There is no CI yet. `npm run db:migrate` runs against live Neon — ask the user before running it. Add an ADR to `DECISIONS.md`.
