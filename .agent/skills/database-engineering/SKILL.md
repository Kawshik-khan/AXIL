---
name: database-engineering
description: Change CommerceOS persistence — the current JSON store (src/infrastructure/db/index.ts), Neon repositories, SQL migrations, tenant-scoped accessors, indexes, and the JSON-to-Neon migration. Use before adding a record type, accessor, table, column, or migration.
---

# Database Engineering

Read `.agent/rules/database.md` first. Current reality: JSON store is live; Neon is not wired (STATUS.md).

## Map
| Thing | Location |
|---|---|
| JSON store class, `*Record` interfaces, accessors | `src/infrastructure/db/index.ts` (~9k lines — grep, don't read whole) |
| Persist logic (whole-file write) | same file, search `persist` / `writeFile` (audit C6, C7) |
| Neon client, `withTransaction` | `src/infrastructure/neon/client.ts` (fix M8 before use) |
| Base repository | `src/infrastructure/db/base-repository.ts` (identifier interpolation, L5) |
| Domain repositories | `src/domains/**/*.repository.ts` |
| SQL migrations / runner | `src/infrastructure/db/migrations/*.sql`, `src/infrastructure/db/migrate.ts` |
| Seeds | `src/infrastructure/db/seeds/`, `scripts/seed-*.ts` |
| Target schema reference | `.agent/DATA_MODEL.md` (TARGET) |

## Adding to the JSON store (while it exists)
1. Add a typed `XRecord` interface and a collection in the store's data shape + load defaults.
2. Accessors take `tenantId` and filter by it: `getXById(tenantId, id)`, `listX(tenantId, opts)`.
3. No default row limit on aggregate reads; paginate explicitly.
4. Mirror the change in the Neon schema (new migration) and repository so the migration path doesn't diverge.

## Adding a SQL migration
1. `src/infrastructure/db/migrations/NNN_<description>.sql` + `NNN_<description>.down.sql`.
2. New tenant table: `tenant_id UUID NOT NULL REFERENCES tenants(id)`, `created_at/updated_at TIMESTAMPTZ`, index `(tenant_id, …)`.
3. Financial tables: `ON DELETE RESTRICT`; soft delete via `deleted_at`.
4. Ask the user before `npm run db:migrate` (live Neon). Record the ADR in `DECISIONS.md` for schema changes.

## Verify
- Tenant-isolation test: create in tenant A, fetch by ID with tenant B context → `NotFoundError`.
- `npm run type-check` (no new errors); domain suite passes.
