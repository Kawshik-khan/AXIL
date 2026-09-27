---
name: testing
description: Write and run CommerceOS tests — the custom ts-runner suites in tests/, tenant-isolation and auth negative tests, regression tests for audit findings, and agent eval runs against the golden dataset. Use whenever adding or verifying behaviour.
---

# Testing

Rules: `.agent/rules/testing.md`. Strategy (target): `.agent/TESTING.md`.

## How the harness works
- `tests/ts-runner.cjs` transpiles TypeScript on the fly, loads `.env.local`, and sets `NODE_ENV=test`.
- Each suite (`tests/<area>-tests.ts`) defines `runTest(name, fn)` with `assert`, and calls `db.clearAllForTesting()` — an **in-memory** store that is never persisted, so `.data/` is safe.
- `npm test` runs 19 suites sequentially. `npm run test:db` hits live Neon/Pinecone/Upstash (ask first).

| Area | Suite |
|---|---|
| Auth, tenants, RBAC core | `tests/run-tests.ts` |
| Catalog, orders, inventory, payments, shipping | `tests/commerce-tests.ts` |
| Social inbox / webhooks | `tests/social-tests.ts` |
| AI agents, policy, evals | `tests/ai-tests.ts`, `tests/agentic-rag-tests.ts`, `tests/jev-system-one-tests.ts` |
| Automations / n8n / connectors | `tests/automation-hub-tests.ts`, `tests/connectors-tests.ts` |
| Super admin / platform | `tests/super-admin-tests.ts` |
| Others | `growth`, `marketing`, `analytics`, `operations`, `enterprise`, `autonomous`, `intelligence`, `orchestration`, `bulk-import`, `google-sheets-connector` |

## Writing a test
```ts
await runTest("tenant B cannot read tenant A product by id", async () => {
  const p = await ProductService.createProduct(ctxA, { /* ... */ });
  await assert.rejects(() => ProductService.getProduct(ctxB, p.id), NotFoundError);
});
```
- Build contexts through real registration/login helpers (see top of `tests/commerce-tests.ts`) — never through bypass headers or master passwords.
- Regression tests reference the finding: `runTest("C4: unsigned courier webhook is rejected", …)`.
- Assert on behaviour **and** on absence of side-effects (e.g. order not marked PAID).

## Running
```bash
node tests/ts-runner.cjs ./tests/commerce-tests.ts   # one suite
npm test                                             # everything
npm run type-check                                   # compare error count to baseline
```

## Agent evals
Golden cases: `src/domains/ai/eval/golden-dataset.ts`; runner: `src/domains/ai/eval/evaluation.service.ts` (exercised from `tests/ai-tests.ts`). When prompts, tools, or policies change, add cases (Banglish queries, injection attempts, missing-data escalation) and report pass/fail counts. The LLM is mocked today, so evals test the policy/tool layer — say so in your report.
