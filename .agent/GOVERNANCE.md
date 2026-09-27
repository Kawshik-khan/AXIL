# CommerceOS Governance — Invariants, Boundaries & Definition of Done

This is the canonical home for the platform's **inviolable invariants**, the **11 assessment questions**, and the
**Definition of Done**. Other files link here instead of repeating them. Entry point for agents: [`../AGENTS.md`](../AGENTS.md).
What exists today: [`STATUS.md`](STATUS.md).

CommerceOS is a multi-tenant agentic e-commerce OS for Bangladeshi commerce (website, Facebook, Instagram, WhatsApp).

---

## 1. Separation of concerns (target architecture)

```
AGENT RUNTIME   = Reasoning and tool choice            (src/domains/ai/agents, runtime, router)
POLICY ENGINE   = Authorization, validation, HITL      (src/domains/ai/policy/agent-policy.service.ts)
COMMERCE API    = Authoritative business logic         (src/app/api/v1/** -> src/domains/**)
DATABASE        = Source of truth                      (today: JSON store; target: Neon Postgres — see STATUS.md)
RAG             = Tenant-isolated knowledge retrieval  (src/domains/ai/rag)
n8n             = Workflow orchestration only          (n8n/workflows, src/domains/automation)
FRONTEND        = Human control plane                  (src/app/(dashboard), src/app/super-admin)
```

## 2. Zero-tolerance invariants

1. An LLM / agent never reads or writes storage directly. Path is always `Agent -> Policy Engine -> Commerce API/Domain Service -> Store`.
2. An LLM never makes arbitrary outbound HTTP calls; tools target internal, validated services only.
3. AI output is never the source of truth for: stock, prices/discounts/totals, payment status, order/fulfilment state, courier status, customer identity, financial/refund records.
4. n8n never holds business logic or authoritative state.
5. `tenant_id` comes only from the verified session/API key (`extractRequestContext`) — never from body, query, or params.
6. Chain-of-thought and system prompts are never shown to end users; show structured metadata (agent, tools, sources, confidence).
7. No authentication shortcuts of any kind: no master passwords, no test headers, no "dev fallback" identities, no step-up that accepts arbitrary input. (See `rules/security.md`.)
8. Nothing reports success for an effect that did not happen. Simulated integrations say so. (See `rules/truthfulness.md`.)
9. No fabricated metrics in UI or API; empty data renders an empty state.
10. Never claim something works without running verification (type-check + relevant tests + wiring trace).

## 3. Operational boundaries

| Layer | Permitted | Prohibited |
|---|---|---|
| Agent runtime | Reason, select allow-listed tools, synthesize from tool/RAG output | Storage access, raw SQL, unvetted HTTP |
| Policy engine | RBAC, rate/budget limits, business rules, require human approval | Performing mutations itself |
| Commerce API / domain services | Validate with Zod, run transactions, emit events | Trusting LLM assertions for facts |
| Store | Authoritative state, tenant scoping | Plaintext secrets |
| n8n | Webhooks, schedules, retries, fan-out via `/api/v1/automation/*` | Direct DB access, holding state |
| Frontend | Render, call authenticated API routes | Direct DB or LLM calls |

## 4. Platform scope vs tenant scope

| | Platform scope | Tenant scope |
|---|---|---|
| Identity | `PlatformMembership` | Tenant membership |
| Context | `PlatformContext` (`extractPlatformContext`) | `RequestContext` (`extractRequestContext`) |
| Enforcer | `PlatformAuthorizationService.assertCan` (`src/domains/platform/services/platform-authorization.service.ts`) | `RbacService.assertCan` (`src/domains/rbac/service.ts`) |
| Roles | `SUPER_ADMIN`, `PLATFORM_ADMIN`, `PLATFORM_OPERATIONS`, `PLATFORM_SUPPORT`, `PLATFORM_FINANCE`, `PLATFORM_SECURITY`, `PLATFORM_ANALYST` | `RoleName` in `src/lib/permissions.ts` (`OWNER`, `ADMIN`, `DEV`, `MANAGER`, `SALES`, `SUPPORT`, `MARKETING`, `INVENTORY`, `FINANCE`, `ANALYST`) |
| Routes | `/api/v1/platform/*` | `/api/v1/*` (non-platform) |

Invariants:
- A tenant role never implies platform authority (`OWNER` ≠ `SUPER_ADMIN`). Never merge the two role sets.
- A platform member never becomes a tenant user implicitly (audit M10). Access to tenant data goes only through governed impersonation (`rules/impersonation.md`).
- Check granular permissions, never role names (`if (role === "SUPER_ADMIN")` is forbidden).
- Authorization ≠ entitlement ≠ feature flag; all three must allow (`rules/platform-operations.md` §3).

## 5. The 11 assessment questions (platform or privileged work)

Answer these in your plan before touching platform/control-plane code:

1. What is the resource?
2. What is its scope — `PLATFORM` or `TENANT`?
3. Who is the actor — `PlatformUser`, `TenantUser`, `SystemWorker`, `AgentRuntime`?
4. Which authorization domain applies — `PlatformAuthorizationService` or `RbacService`?
5. Is tenant context required?
6. Is platform context required?
7. What is the risk tier — `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` (`rules/privileged-actions.md`)?
8. Does policy require human (dual-custodian) approval?
9. Does it require step-up authentication?
10. What must be audited (actor, effective actor, reason, before/after diff, correlation id)?
11. How will it be verified (post-state check + automated negative test)?

## 6. Definition of Done

A change is done only when **all** apply:

- [ ] Behaviour matches the request / feature spec; scope did not silently grow.
- [ ] Inputs validated with Zod at the route/tool boundary; no `any` added.
- [ ] Tenant scope resolved from context; permission checked with `assertCan`.
- [ ] Errors use the `AppError` family (`src/lib/errors.ts`) and the envelope from `src/lib/api-response.ts`.
- [ ] UI (if touched) uses tokens from `src/styles/tokens.css` and handles the 6 states (`UX_RULES.md`).
- [ ] `npm run type-check` error count did not increase; relevant `tests/*-tests.ts` suite passes; a new test covers the change (and fails without it).
- [ ] Wiring traced end-to-end: UI call → route → service → store (no calls to non-existent endpoints).
- [ ] No simulated effect reports success; no fabricated numbers.
- [ ] `STATUS.md` updated if a capability's status changed; `DECISIONS.md` ADR added if schema, auth, tenant isolation, or agent boundaries changed.
- [ ] Final report states what was verified, what was not, and anything simulated.
