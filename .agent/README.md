# `.agent/` — CommerceOS Agent Operating System

Entry point for agents is the repo root [`AGENTS.md`](../AGENTS.md). This file indexes everything in `.agent/`.

## Start here
| File | Purpose |
|---|---|
| [`STATUS.md`](STATUS.md) | **What actually works today.** Source of truth; wins over any other doc for "what exists". |
| [`GOVERNANCE.md`](GOVERNANCE.md) | Invariants, platform vs tenant scope, 11 assessment questions, Definition of Done. |

## Folders
| Folder | Contains | Used by |
|---|---|---|
| `rules/` | Short enforceable constraints with `trigger`/`globs` frontmatter (always-on or file-scoped). | Every coding agent |
| `skills/` | How-to knowledge for **coding** agents, with real paths, patterns, and verification commands. | Coding agents (Claude Code via `.claude/skills/` wrappers) |
| `workflows/` | Step-by-step **development** procedures (feature, bug fix, DB change, release, …). | Coding agents; invocable as slash commands |
| `runtime-agents/` | Behaviour specs for CommerceOS's own **product** agents (sales, support, order, payment, …). | Implementing/tuning `src/domains/ai/agents/*` |
| `specs/platform/` | Product procedures the software must implement (tenant suspension, impersonation, kill switch, …). | Implementing platform features |
| `templates/` | ADR, feature spec, agent spec, API spec, test plan, workflow spec, incident report. | Writing new specs |

## Skills (coding)
| Skill | Use for |
|---|---|
| `backend-engineering` | API routes, domain services, validation, errors |
| `security-engineering` | Auth, sessions, webhooks, secrets, audit C/H findings |
| `database-engineering` | JSON store, Neon repositories, migrations |
| `frontend-design` | Bento UI, tokens, six states, wiring |
| `platform-control-plane` | Super-admin: RBAC, lifecycle, billing, flags, kill switches, impersonation, audit |
| `commerce-domain` | Bangladesh order/payment/courier/fee knowledge |
| `rag-engineering` | Retrieval pipeline |
| `n8n-automation` | n8n workflows and automation backend |
| `observability` | Logging, audit, health, AI telemetry |
| `testing` | Test harness, negative tests, evals |

Third-party skills installed by `npx skills` live in `../.agents/skills/` (`neon`, `neon-postgres`).

## Reference docs (mostly TARGET design — each carries a status banner)
`ARCHITECTURE.md` · `SYSTEM_DESIGN.md` · `AI_ARCHITECTURE.md` · `RAG_ARCHITECTURE.md` · `EVENT_ARCHITECTURE.md` ·
`N8N_ARCHITECTURE.md` · `DATA_MODEL.md` · `API_CONTRACTS.md` · `SECURITY.md` · `INTEGRATIONS.md` · `OBSERVABILITY.md` ·
`MLOPS.md` · `DEVOPS.md` · `TESTING.md` · `EVALUATION.md` · `DESIGN_SYSTEM.md` · `UX_RULES.md` · `CODING_STANDARDS.md` ·
`PRODUCT.md` · `BANGLADESH_COMMERCE.md` · `ROADMAP.md` · `CHANGELOG.md` · `DECISIONS.md` (ADR index at top)

## Maintaining this folder
- Follow `rules/documentation.md`: one source of truth per topic, target vs current, honest gaps.
- Adding a coding skill: create `skills/<name>/SKILL.md` with `name` + `description` frontmatter, then add a wrapper in `../.claude/skills/<name>/SKILL.md` and a row above.
- Adding a workflow: `workflows/<name>.md` with `description` frontmatter + a `.claude/skills` wrapper.
- Changing what works: update `STATUS.md` §2 and §5.
- Previous layout is archived in `../.backups/agent-folder-2026-09-27.tar.gz`.
