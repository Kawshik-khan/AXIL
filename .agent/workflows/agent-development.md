---
description: Create or change a CommerceOS product AI agent — prompt, tool allowlist, policy/HITL, eval cases, registration
---

# Agent Development & Tuning Workflow

Follow this procedure when creating or enhancing an autonomous agent in CommerceOS:

1. **Define Agent Responsibility & Purpose**:
   - Establish a concrete operational objective (e.g. qualify leads, diagnose delayed courier consignments). Do not create generic "do-everything" agents.

2. **Establish Explicit Tool Allowlist**:
   - Declare `allowedTools` on the agent class; tools must exist in `src/domains/ai/tools/tool-registry.ts`.
   - Forbid dangerous tools (e.g. direct order cancellation, arbitrary discounts, financial transfers).

3. **Draft Versioned System Prompt**:
   - Add or version the prompt in `src/domains/ai/prompts/prompt-registry.ts`; the agent class goes in `src/domains/ai/agents/<name>.agent.ts` extending `base-agent.ts`. Behaviour spec: `.agent/runtime-agents/<name>.md` (create from `templates/agent-spec.md`).
   - Incorporate: Role definition, operational boundaries, Banglish linguistic guidance, formatting rules, and strict negative constraints.

4. **Define Policy Engine Constraints**:
   - Configure which proposed actions require mandatory human approval (HITL) in `src/domains/ai/policy/agent-policy.service.ts`.

5. **Build Benchmark Evaluation Dataset**:
   - Add at least 20 scenarios to `src/domains/ai/eval/golden-dataset.ts` covering standard inquiries (Bangla, Banglish, English), missing-data escalation, and prompt-injection attempts.

6. **Run Automated Evaluation Suite**:
   - Run `node tests/ts-runner.cjs ./tests/ai-tests.ts` (and `agentic-rag-tests.ts` if RAG is involved).
   - Required: zero policy violations and zero fabricated prices/stock/order states; report pass/fail counts. The LLM is currently mocked, so state that the eval covers policy/tool behaviour only.

7. **Register in Agent Orchestrator & Dashboard**:
   - Register in `src/domains/ai/orchestration/agent-registry.ts` / `src/domains/ai/router/agent-router.ts`.
   - Surface agent status, metrics, and approval queue in the AI Agents Bento view.
