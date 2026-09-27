---
name: backend-engineering
description: Implement or change CommerceOS API routes and domain services — Zod validation, tenant-scoped context, RBAC checks, AppError handling, response envelopes, transactions and domain events. Use for work in src/app/api/v1/** or src/domains/**.
---

# Backend Engineering

## Layering
`src/app/api/v1/<resource>/route.ts` → `src/domains/<domain>/<name>.service.ts` → store (`db` from `@/infrastructure/db` today; `*.repository.ts` on Neon later).
Routes stay thin: context → permission → validate → call service → envelope. Business rules live in services.

## Route checklist
1. `const ctx = await extractRequestContext(request)` (`src/lib/api-response.ts`). Platform routes use `extractPlatformContext`.
2. `RbacService.assertCan(ctx, PERMISSIONS.X)` on **every** mutation and on reads of sensitive data (`src/domains/rbac/service.ts`, `src/lib/permissions.ts`). Add a new permission constant rather than reusing a broader one (audit H3).
3. Validate with a Zod `.strict()` schema. Never pass `await request.json()` straight into a service that spreads it into a record (audit H4).
4. Return `apiSuccess(data, meta?, status?)`; catch with `return apiError(err)`.
5. Throw `AppError` subclasses from `src/lib/errors.ts` (`NotFoundError` → 404, `ForbiddenError` → 403, `ConflictError` → 409, `ValidationError` → 400). `throw new Error("not found")` produces a 500 (audit L2).

## Service checklist
- First parameter is the `RequestContext`; derive `tenant_id` from `ctx.tenant.id` only.
- Every by-ID lookup checks `record.tenant_id === ctx.tenant.id` (or passes tenant to the accessor) → otherwise `NotFoundError` (audit H13).
- Updates whitelist fields; `id`, `tenant_id`, `created_at`, and status fields owned by a state machine are never client-writable.
- Order status changes go through `src/domains/orders/order-state-machine.ts` — one writer only (audit H12).
- IDs: `crypto.randomUUID()`; sequential numbers (order numbers) must be race-safe (audit M3).
- Money: integer or fixed-precision math in pure functions (e.g. `src/domains/pricing/pricing.service.ts`); never computed by an LLM.
- Emit a domain event / audit entry after a successful state change (`src/domains/audit/service.ts`).
- GET handlers are pure reads — no persists, no recompute side-effects (audit H8).

## Verify
```bash
npm run type-check                                  # error count must not increase
node tests/ts-runner.cjs ./tests/commerce-tests.ts  # or the suite for your domain
```
Then trace the caller: find the UI `fetch` for this route (`grep -rn "api/v1/<resource>" src/app src/components`) and confirm method + body shape match.
