# Customer agent prompt changelog

The prompt's file name is its version id; every agent run records it (`agent_runs.prompt_version`). Change a prompt by
adding a new file and pointing `PROMPT_FILE` in `../runtime.ts` at it, never by editing a released one, and run the eval
gate on the new version first.

| Version | Date | Change |
|---|---|---|
| `customer-agent.system.v2.1-cod` | 2026-10-06 | v2.1 from `audit/prompts/customer-agent.system.v2.md` (measured in the AI audit: golden 93.5%, red-team 45/45 on gpt-oss:120b), plus: payment is cash on delivery only (owner decision: COD-only launch). |
