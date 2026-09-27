---
trigger: glob
description: Persistence, tenant scoping, migrations, indexes
globs: src/infrastructure/**/*, src/domains/**/*.repository.ts
---

# Database & Persistence Rules

Current reality (STATUS.md): runtime data lives in the JSON store (`src/infrastructure/db/index.ts` → `.data/commerceos.json`).
Neon repositories (`src/domains/**/*.repository.ts`, `src/infrastructure/neon/client.ts`) exist but are not wired. Migration to Neon is FX work, not ad-hoc.

1. **Tenant invariants** (both stores):
   - Every tenant-owned record has a non-null `tenant_id`. In SQL: `tenant_id UUID NOT NULL REFERENCES tenants(id)`.
   - Every read and write filters by the context's `tenant_id` — including `get*ById` accessors (audit H13). A by-ID accessor without a tenant argument is a bug.
   - Updates whitelist fields; `id` and `tenant_id` are never updatable (audit H4).

2. **JSON store while it exists**:
   - Don't add new whole-store persists inside loops or GET handlers (audit C6, H8). GETs are pure reads.
   - Don't add default row limits to aggregate queries (audit H6).
   - New record types get a typed `*Record` interface; no `any`.

3. **SQL migrations** (`src/infrastructure/db/migrations/`):
   - New numbered file per change: `NNN_description.sql`. Never edit an applied migration.
   - Include a matching rollback (`NNN_description.down.sql`) for new migrations. Seed data goes in `src/infrastructure/db/seeds/` or `scripts/`, not in schema migrations.
   - `npm run db:migrate` targets the live Neon database — ask the user before running it.
   - Create indexes on large tables with `CONCURRENTLY`.

4. **Indexes**: `(tenant_id, <lookup>)` composites for common lookups (`email`, `order_number`, `status`, `created_at DESC`).

5. **Transactions**: multi-entity mutations (order + reservation + payment) are atomic. Fix `withTransaction` (audit M8) before relying on it.

6. **Soft delete**: products, customers, and orders use `deleted_at`; financial records are never hard-deleted.
