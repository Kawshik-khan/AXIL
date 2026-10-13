---
trigger: glob
description: Product-agent tool allowlists, policy engine, loop limits
globs: src/domains/ai/**/*
---

# Agent Execution & Tool Allowlist Rules

Applies to CommerceOS's **product** agents (`src/domains/ai/agents/`, `src/domains/ai/orchestration/`). Behaviour specs per agent: `.agent/runtime-agents/`.

1. **Least-privilege allowlists**:
   - Each agent declares `allowedTools` (see `base-agent.ts`); the tool registry (`src/domains/ai/tools/tool-registry.ts`) only exposes those.
   - Support agents never get `order.cancel`, `refund.issue`, `inventory.adjust`. No agent gets universal tools.

2. **Policy engine on every call**: each tool invocation passes `src/domains/ai/policy/agent-policy.service.ts` before execution. High-risk actions (refunds, confirmed-order changes, broadcasts, discounts above policy) become `PENDING_HUMAN_APPROVAL`, never auto-execute.

3. **Agents act as a least-privilege identity**: tool execution uses the requesting user's context or a scoped system actor — never a synthetic `OWNER` (audit M12).

4. **Loop limits**: `maxIterations` in `base-agent.ts` caps tool iterations per turn; repeated identical calls end the run with a human handoff. Change the constant, not docs, to tune it.

5. **Structured outputs**: tool inputs/outputs use Zod schemas; free-form text never triggers a state mutation.

6. **Honest provider status**: `ModelRouter` uses an OpenAI-compatible provider only when configured; `AI_DEMO_MODE=1` selects the offline keyword mock and must be labeled DEMO. With neither configured, AI calls fail closed. Check `.agent/STATUS.md` before describing provider verification or availability.
