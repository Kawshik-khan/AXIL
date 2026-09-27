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
