@AGENTS.md

## Claude Code specifics

- **Skills** in `.claude/skills/` are thin wrappers: each one tells you to read the canonical file in `.agent/`. The
  `.agent/` copy is the source of truth; edit it, not the wrapper. Workflows are invocable as `/feature-development`,
  `/bug-fixing`, `/database-change`, `/create-platform-feature`, `/platform-security-review`, etc.
- **Subagents** in `.claude/agents/`: use `security-reviewer` after touching auth, tenant scoping, webhooks, or
  platform routes; use `done-verifier` before claiming a task is complete.
- **Hooks** (`.claude/hooks/`): edits to `.env*` (except `.env.example`), `.data/`, `.backups/`, `.next/`, and
  `node_modules/` are blocked. New code is scanned for backdoor patterns, client-supplied `tenant_id`, embedded
  credentials, `any`, `console.log`, and raw hex colors in TSX. Treat hook feedback as a required fix.
- Large files: `src/infrastructure/db/index.ts` (~9k lines), `src/app/super-admin/page.tsx`,
  `src/app/(dashboard)/agents/page.tsx`, `src/domains/connectors/service.ts` — use Grep and ranged Reads.
- Plan mode is recommended for anything touching Phase 0 findings or more than ~3 files.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
