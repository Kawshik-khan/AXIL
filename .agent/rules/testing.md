---
trigger: glob
description: Real-path tests, negative security tests, eval gating
globs: tests/**/*
---

# Testing & Verification Rules

1. **Every change has a test that would fail without it.** Add it to the matching suite in `tests/*-tests.ts` (run one suite with `node tests/ts-runner.cjs ./tests/<name>-tests.ts`). Bug fixes start with a failing regression test.

2. **Test the real path, not the mock.** A test that only exercises a stub or a mock provider proves nothing about the feature. Security tests go through the real auth path — never through a bypass header or seeded master password.

3. **Negative tests are mandatory** for anything touching auth, tenant scoping, or platform routes:
   - Tenant A cannot read/update/delete Tenant B's records (including by-ID lookups).
   - Tenant tokens (including `OWNER`) get 403 on `/api/v1/platform/*`.
   - Missing/invalid token → 401, never a fallback identity.
   - Unsigned or stale webhooks are rejected.

4. **External providers**: unit tests never call live bKash, couriers, Meta, LLMs, Neon, Pinecone, or Upstash. `npm run test:db` does hit live services — run it only with the user's consent.

5. **Type-check**: record the `npm run type-check` error count before your change; it must not increase.

6. **Agent evals**: changes to prompts (`src/domains/ai/prompts/`), tool schemas, or agent policies must be run against `src/domains/ai/eval/golden-dataset.ts` via `tests/ai-tests.ts` / `tests/agentic-rag-tests.ts`, and the report must include pass/fail counts. Required outcome: zero policy violations and zero fabricated prices/stock/order states in the golden set.
