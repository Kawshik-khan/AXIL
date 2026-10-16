# Customer agent prompt changelog

The prompt's file name is its version id; every agent run records it (`agent_runs.prompt_version`). Change a prompt by
adding a new file and pointing `PROMPT_FILE` in `../runtime.ts` at it, never by editing a released one, and run the eval
gate on the new version first.

| Version | Date | Change |
|---|---|---|
| `customer-agent.system.v2.1-cod` | 2026-10-06 | v2.1 from `audit/prompts/customer-agent.system.v2.md` (measured in the AI audit: golden 93.5%, red-team 45/45 on gpt-oss:120b), plus: payment is cash on delivery only (owner decision: COD-only launch). |
| `customer-agent.system.v2.3-cod` | 2026-10-18 | v2.2 plus: handoff is called first in the same turn and beats other rules; explicit triggers with Banglish examples (G37–G43); a "Payment discrepancy" section (money deducted, no order: hand off with reason payment_problem, never claim refund/order without tool confirmation, no claim of handoff success on failure); policy questions (incl. payment methods, G45) must call search_policy instead of being answered from the prompt. v2.2 is unchanged. Not yet measured: run the eval gate. |
