# CommerceOS Coding Standards & Quality Guidelines

## 1. Core Principles

- **Strict TypeScript**: `strict: true` (tsconfig). No new `any` — use `unknown` + Zod narrowing. (~288 existing `any` are debt; don't add more.) `exactOptionalPropertyTypes` is TARGET.
- **Domain-driven layout**: business code lives in `src/domains/<domain>/`; routes stay thin.
- **Contracts**: shared types in `src/types/<area>.ts` or next to the domain; Zod schemas at every boundary.
- **Pure core logic**: totals, VAT, delivery fees, discount caps are pure deterministic functions.

---

## 2. Directory Structure (actual)

```
src/
├── app/
│   ├── (auth)/                login, register
│   ├── (dashboard)/<area>/    merchant control plane pages
│   ├── super-admin/           platform control plane UI
│   ├── health/ready/          readiness probe
│   └── api/v1/<resource>/     REST route handlers (platform routes under api/v1/platform/)
├── components/
│   ├── bento/  navigation/  ui/  social/  catalog/
├── domains/<domain>/          *.service.ts, *.repository.ts, agents/, services/
│   └── ai/                    agents, policy, tools, prompts, rag, eval, orchestration, providers
├── infrastructure/
│   ├── db/                    JSON store (index.ts), migrations/, seeds/, migrate.ts
│   ├── neon/  pinecone/  redis/
├── lib/                       api-response, context, errors, permissions, security
├── styles/                    tokens.css, globals.css
└── types/                     shared type modules per area
```

New code follows this layout. Don't create `src/agent/`, `src/integrations/`, or other parallel trees — provider adapters go inside their domain (e.g. `src/domains/social/channels/adapters/`).

---

## 3. Error Handling Standard

Use typed, structured error classes extending a base `AppError`:
```typescript
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InsufficientStockError extends AppError {
  constructor(sku: string, available: number, requested: number) {
    super(
      "INSUFFICIENT_STOCK",
      `Only ${available} units of SKU '${sku}' are available (requested: ${requested}).`,
      409,
      { sku, available, requested }
    );
  }
}
```

---

## 4. Linting, Formatting & Code Cleanliness

- **No Magic Numbers**: Extract delivery rates, timeout thresholds, and tax percentages into named constants or tenant configuration.
- **No Monolithic Files**: new files stay under ~300 lines (pages ~500). Don't grow the existing giants (`db/index.ts` ~9k lines, several 1.2k–2.4k-line pages); extract what you touch.
- **No new console logging**: use the structured logger (see `skills/observability` — create `src/lib/logger.ts` if it doesn't exist yet).
- **Errors**: the real `AppError` family is in `src/lib/errors.ts`; reuse it before adding a subclass.
