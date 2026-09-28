# CommerceOS Changelog

All notable changes to the CommerceOS platform architecture, specification, and implementation are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - Phase 2 performance and read-path integrity (2026-09-28, branch `phase-2-performance`)
See [ADR-105](DECISIONS.md#adr-105-coalesced-persistence-write-free-reads-and-complete-analytics-phase-2).

### Performance
- Store writes are coalesced into one async flush every 250 ms (temp file, fsync, rename) instead of a synchronous whole-file write per mutation (C6).
- GET requests never write. Intelligence endpoints serve a stored snapshot or compute in memory: under 0.6 s cold on 10,000 customers, down from 79–405 s (H8).
- O(n) lookups in order search and hydration, inventory, product, customer and inventory intelligence, and campaign recipients (M7).

### Fixed
- Analytics, intelligence, growth, enterprise and operations numbers use every order, customer and product, not the first 50 (H6).
- Write failures are reported and retried; crash leftovers are quarantined; a second process, host or seed script refuses to start instead of overwriting the running app's data, and every write first checks the lock (C7).
- Audience, marketing, stockout, reconciliation, order-health and pricing screens no longer slow down with every row now counted (1–3 s → under 0.1 s at 10,000 customers).
- AI order lookups find any order, not only the newest 50. Recommendations shown live can be proposed as decisions.
- A recompute keeps an approve/reject decision only for the same entities and until it expires.
- `/health/ready` reflects persistence health, data-dir writability and writer-lock ownership (L3).
- Cohorts no longer mix tenants (N9); the marketing frequency cap counts all of a customer's messages (N10).
- Payment exceptions no longer disappear on the second page load; lifecycle lookups for unknown customers return 404.

### Added
- `POST /api/v1/intelligence/recompute` (`analytics.manage`) stores all intelligence snapshots in one idempotent pass and keeps decisions already made.
- `PERSIST_DEBOUNCE_MS`, `COMMERCEOS_DATA_DIR` and `COMMERCEOS_FORCE_LOCK` settings.
- Test suites `persistence-tests.ts`, `phase2-analytics-tests.ts` and `phase2-readonly-tests.ts`.

### Changed (action required)
- Run exactly one app process per data directory, and stop the app before running seed scripts. A second one exits with "CommerceOS refused to start".
- Intelligence recommendations, opportunities and risks are stored only by `POST /api/v1/intelligence/recompute` (no UI button yet), workflows and the intelligence agent; page views no longer create them.

## [Unreleased] - Phase 1 access control and integrity (2026-09-28, branch `phase-1-access-control`)
See [ADR-104](DECISIONS.md#adr-104-access-control-and-integrity-phase-1).

### Security
- 140 previously unguarded handlers check permissions (H2).
- Approvers come from the session, and high-risk campaigns need a second approver.
- Payment verification needs `payments.verify` and a single-use TrxID, and an order is PAID only when its total is covered (H3).
- Strict schemas on every PATCH/PUT. Store updates can't change `id`/`tenant_id`, and a campaign can no longer be set to APPROVED by editing it (H4).
- Store lookups are tenant-scoped, and enterprise organizations are owned by a workspace (H13).
- Rate limits on sign-in, registration, the widget, webhooks and AI endpoints (M13).
- Operator TOTP MFA with two-step sign-in and step-up; revocable sessions and "sign out everywhere"; no implicit OWNER role for platform staff (H10, M9, M10).
- AI workflows run with their creator's permissions (M12).
- Generic 500s, 404s for missing records, security headers, cryptographic IDs (L1, L2, L8, M4).
- Webhook duplicates are suppressed using signed data only (N2). Workspace-only suspension (N5). No fake MFA flags (N4).

### Changed (action required)
- Operators: sign in at `/super-admin/login`, then set up an authenticator from the step-up prompt to use high-risk actions.
- n8n: create a service token in **Settings → Service Tokens** and put it in the `CommerceOS API` credential.
- Workspaces that use Enterprise features must create their own organization.
- Some roles lose access they only had because checks were missing. Review ROLE_PERMISSIONS with the product owner.

### Added
- `tests/rbac-matrix-tests.ts` and `tests/phase1-integrity-tests.ts` (both in `npm test`).
- `src/lib/rate-limit.ts`, `src/lib/totp.ts`, `src/lib/validation.ts` and `src/lib/ids.ts`.
- Service tokens (`/api/v1/service-tokens`) and the Settings UI for them.

## [Unreleased] - Phase 0 security containment (2026-09-27, branch `phase-0-containment`)
See [ADR-103](DECISIONS.md#adr-103-fail-closed-authentication-secrets-and-webhook-signatures-phase-0-containment) and `.agent/STATUS.md`. Finding IDs refer to `AUDIT_REPORT_2026-09-27.md`.

### Security
- Removed the shared default passwords and pass-the-hash acceptance. Passwords are verified only with bcrypt (C1).
- Platform login now checks the password, and the token is set only in an httpOnly cookie (C8).
- `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` fail closed: there is no published default, and the two keys must differ. Every JWT carries an issuer and a per-purpose audience (C2, M14).
- Removed the `x-test-platform-role` header bypass and the dev OWNER/SUPER_ADMIN fallback. The platform role is read from the stored membership (C3, H1).
- Step-up returns 501 until TOTP exists, and no session claims MFA without a verified factor (H10).
- Courier and payment webhooks require a per-endpoint `?wh=` id and an HMAC of `<timestamp>.<raw body>` within 300 s. The tenant comes from the webhook row, and rows are never auto-created (C4).
- Social webhooks resolve the channel strictly, always verify the Meta signature, and have no built-in secrets or verify tokens (H5).
- Accepting an invitation for an existing account requires that account's password (N1).
- Meta batches are routed per entry, a Meta account can be connected to only one channel, and ambiguous ids are ignored (H5).
- The website widget no longer uses unverified phone/email to match existing customers (N6). The widget session endpoint no longer returns other visitors' IP or user agent, and widget visitor ids are 128-bit random.
- The opt-in dev bypass serves only loopback, same-site requests.
- `reset-seed-passwords.ts` deactivates the four seeded staff accounts by default (`--keep-staff` to opt out). `rotate-credential-key.ts` no longer disables website-chat channels and warns that its backup is effectively plaintext.
- `.env.example` holds placeholders only, and `.gitignore` / `.gitattributes` were added (C5).

### Changed (action required)
- `.env.local` must define `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY`: two different random values of at least 32 characters.
- Set `SEED_ADMIN_PASSWORD` (at least 14 characters) and run `scripts/reset-seed-passwords.ts --apply`; seeded accounts cannot sign in until then.
- Re-encrypt stored credentials with `scripts/rotate-credential-key.ts` (needs `OLD_JWT_SECRET`).
- Webhooks need `STEADFAST_WEBHOOK_SECRET`, `PATHAO_WEBHOOK_SECRET`, `BKASH_WEBHOOK_SECRET` and `NAGAD_WEBHOOK_SECRET`; social webhooks need `META_APP_SECRET` and `META_VERIFY_TOKEN`.
- All existing sessions are invalidated.
- The n8n courier/payment relay workflows get 401 until they sign their requests (FX-18).
- Super-admin actions that need step-up are unavailable until FX-15.

### Added
- `tests/security-regression-tests.ts`, which runs first in `npm test`.
- `scripts/smoke-security.mjs`, which replays the audit exploits against a running server.
- A super-admin sign-in page (`/super-admin/login`) and a shared platform fetch client.
- The Automations → Webhooks tab now shows each provider callback URL and whether its secret is set.
- `src/lib/logger.ts` (structured JSON logs).

## [0.2.0] - 2026-09-19
### Added
- **Phase 1: Core Platform Foundation** fully implemented and verified.
- Multi-tenant persistence layer with tenant isolation and atomic filesystem commits.
- Authentication engine with bcrypt hashing, JWT session cookies via `jose`, and expiring invitations.
- Complete RBAC engine with 9 canonical roles (`OWNER`, `ADMIN`, `MANAGER`, `SALES`, `SUPPORT`, `MARKETING`, `INVENTORY`, `FINANCE`, `ANALYST`) and `assertCan()` enforcement.
- Immutable append-only audit trail logging with actor and tenant context.
- Bangladesh-ready design system tokens (`#C7F900` Lime, `#242529` Charcoal, glassmorphism, responsive radii).
- Next.js Application Shell featuring a vertical detached Floating Navigation Dock (~68px wide) with zero traditional left sidebar, TopBar with AI Ready status, and `Cmd + K` Command Palette.
- 12-Column Bento Grid dashboard with zero fake metrics, clean placeholders, and Connect Store CTA.
- Settings management for delivery fees (Inside/Outside Dhaka), BDT currency, and team member management with role selector.
- Standard REST API v1 envelopes and endpoints for auth, sessions, tenants, users, invitations, and audit logs.
- Liveness and readiness observability endpoints (`/health`, `/health/ready`).
- Comprehensive automated test suite with 18 automated tests passing (including mandatory multi-tenant isolation tests).

## [0.1.0] - 2026-09-19
### Added
- Greenfield repository audit and initialization of the complete `.agent/` operating system.
- Global operating rules and zero-tolerance constraints defined in `AGENTS.md` (now `.agent/GOVERNANCE.md`).
- Product specifications, personas, and problem-solution definitions in `PRODUCT.md`.
- High-level architecture and subsystem topology documented in `ARCHITECTURE.md`.
- Distributed system design, concurrency control, and idempotency strategy in `SYSTEM_DESIGN.md`.
- PostgreSQL 16+ relational schema and `pgvector` data model defined in `DATA_MODEL.md`.
- Zero-trust security model, RBAC matrix, and prompt injection defense in `SECURITY.md`.
- Multi-agent orchestration, agent catalog, and tool calling protocol in `AI_ARCHITECTURE.md`.
- RAG knowledge pipeline, semantic chunking, and confidence thresholds in `RAG_ARCHITECTURE.md`.
- n8n automation hub architecture and 39-workflow catalog in `N8N_ARCHITECTURE.md`.
- Event-driven architecture, event envelope, and pub/sub topics in `EVENT_ARCHITECTURE.md`.
- REST API v1 contracts and standardized error envelopes in `API_CONTRACTS.md`.
- Design system tokens (Lime `#C7F900`, Charcoal `#242529`), Bento grid specs, and floating navigation dock in `DESIGN_SYSTEM.md`.
- Human control plane UX rules and 6 mandatory page states in `UX_RULES.md`.
- TypeScript strict coding standards and error handling guidelines in `CODING_STANDARDS.md`.
- Testing pyramid and evaluation benchmark plans in `TESTING.md`.
- AI evaluation framework for Bangla/Banglish and adversarial safety in `EVALUATION.md`.
- Observability standard, structured JSON logs, and golden signals in `OBSERVABILITY.md`.
- DevOps multi-stage Docker containerization and `.env.example` in `DEVOPS.md`.
- MLOps provider abstraction, prompt versioning, and drift loops in `MLOPS.md`.
- Third-party provider adapters for Steadfast, Pathao, bKash, and Meta in `INTEGRATIONS.md`.
- Bangladesh-first commerce domain specifications in `BANGLADESH_COMMERCE.md`.
- Phased implementation roadmap from Phase 0 to Phase 10 in `ROADMAP.md`.
- Initial Architectural Decision Records ADR-001 through ADR-006 in `DECISIONS.md`.
