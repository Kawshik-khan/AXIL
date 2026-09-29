# CommerceOS Changelog

All notable changes to the CommerceOS platform architecture, specification, and implementation are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - Phase 4, first stage: Postgres as the system of record (2026-09-29, branch `phase-4-postgres`)
See [ADR-108](DECISIONS.md#adr-108-postgres-as-the-system-of-record-behind-the-existing-store-api-phase-4-first-stage).

### Added
- `DATA_BACKEND=pg`: the store loads from and writes to Postgres (Neon) — one transaction per flush, a single-writer lease with fencing, refused rows set aside and reported instead of blocking every write. The JSON file stays the default until the cutover.
- Migration 006 (schema `commerceos`): core tables with constraints and tenant-scoped foreign keys, JSONB documents for the other collections.
- A migration runner that applies each file whole in one transaction.
- `npm run db:backfill` (dry run on in-memory Postgres, then `--apply`), `npm run db:verify-migration`, `scripts/export-pg-to-json.ts` (rollback).
- `npm run test:pg`: every suite on in-memory Postgres (PGlite), reloaded and compared; `tests/phase4-postgres-tests.ts`.
- `/health/ready` pings Postgres and reports unsaved rows.

### Fixed
- 55 record ids were built from the clock alone and collided within a millisecond (audit logs, stock movements, events, consent preferences, model deployments, …).
- A stock adjustment could create a row for another workspace's variant or warehouse (with that workspace's row id).
- The seed gave the super-admin a membership in a workspace that may not exist.
- `withTransaction` re-ran a failed transaction over HTTP after the rollback (M8); `execute()` reported returned rows instead of changed rows.

### Changed (action required)
- Migrations 001–005 moved to `migrations/legacy/` and no longer run.
- Scripts that change the store now open it through `scripts/lib/store-session.ts` (works for both backends; Postgres backups are JSON exports).
- To cut over, follow ADR-108 (migrate → backfill dry run → apply → verify → `DATA_BACKEND=pg`). Run against Neon only when you decide to.

## [Unreleased] - Phase 3 completion: safety controls, order lifecycle, AI provider (2026-09-29, branch `phase-3-truthful-data`)
See [ADR-107](DECISIONS.md#adr-107-enforced-safety-controls-one-order-writer-and-a-real-ai-provider-phase-3-completion).

### Security
- Platform kill switches, plan limits and feature flags are enforced (H11); the autonomous emergency halt stops execution.
- Support impersonation works, read-only, with the operator's own session and a banner; operators can't grant themselves write access.
- Invitation tokens are no longer listed to other members; provisioned owners set their password with a one-time link (N8).
- Enterprise stores, brands, business units and metrics respect the caller's enterprise scope (N13); stock can no longer land in another tenant's warehouse.

### Fixed
- One writer for order status: no skipped states, deliveries can't revive cancelled orders, stock is committed and COD marked paid on delivery, lapsed holds are released, order numbers are unique (H12, M2, M3).
- A real OpenAI-compatible AI provider, or a labelled offline demo; never a silent mock (H14).
- Broken buttons and advertised URLs work or are gone (M1); report CSV download exists.
- Districts instead of guessed "Chittagong"; delivery fees from settings everywhere; audience presets with real rules; text-only knowledge upload (M5, M6, M16).
- 0 type errors and `next build` passes (H15); dead code removed.
- The demo seed no longer writes made-up health, SLO, courier, provider or model figures.

### Added
- `/invite/[token]`, `POST /api/v1/autonomous/cycles`, `GET /api/v1/enterprise/reports/[id]/download`, `GET /api/v1/ai/status`, `DELETE /api/v1/auth/impersonation`.
- Scripts: `reencrypt-integration-credentials`, `clear-demo-telemetry`, `fix-warehouse-tenancy`, `fix-fabricated-data`.

### Changed (action required)
- Set `LLM_BASE_URL` (+ `LLM_API_KEY`, model names) for AI, or `AI_DEMO_MODE=1` for the offline demo; otherwise AI answers 424.
- Run the four data scripts once on existing stores, with the app stopped (dry run first).
- Illegal order transitions return 409 (was 400); `POST /orders` needs a district and whole positive quantities; `POST /connectors/test` etc. as in the Phase 3 entry below.
- Workspaces without a subscription are limited by the default entitlements (5 users, 500 products, 3 channels).

## [Unreleased] - Phase 3 truthful data and honest integrations (2026-09-28, branch `phase-3-truthful-data`)
See [ADR-106](DECISIONS.md#adr-106-truthful-data-and-honest-integrations-phase-3).

### Fixed
- No fabricated metrics (H7): analytics, intelligence, growth, marketing, enterprise, autonomous and super-admin screens show values computed from the workspace's data, or "—" / "Not measured". Period changes compare with the previous window; RTO tiers need 20+ shipments; unattributed orders are shown as such.
- The Command Center shows only the workspace's own orders, customers, stock, agent runs and intelligence (FX-39).
- Revenue in analytics queries and sales intelligence was 0 because it summed a field that doesn't exist.
- Nothing external reports success it didn't achieve (H9): social replies and marketing sends fail visibly, shipments are manual bookings with the courier's tracking number, connector tests say "not verified" unless the provider was actually checked, enterprise syncs and webhooks aren't reported as done, and n8n isn't called without a configured instance.
- Enterprise benchmarks, analytics, reports, overview and AI tools use the caller's real membership and scope (N11).

### Security
- Enterprise integration credentials are encrypted and never returned by the API or the AI tools; webhook listings don't return signing secrets.
- Connector tests need `settings.update` and are rate limited; only a provider's own public endpoint is ever contacted.
- n8n errors shown to tenants no longer name internal hosts.
- The autonomous context no longer counts other workspaces' enterprise records.

### Added
- `tests/phase3-truthfulness-tests.ts` (17 tests, including a grep gate for known fabrication patterns).
- `N8N_HOST` placeholder in `.env.example`.

### Changed (action required)
- API contracts:
  - many analytics and enterprise fields are now `number | null` (for example `conversion_rate_pct`, `period_change_pct`, benchmark `value`/`rank`/`cohort_average`, enterprise `consolidated_revenue_bdt` for store-scoped members);
  - new statuses: channel `UNATTRIBUTED`, RTO `INSUFFICIENT_DATA`, connector `health_status: "UNVERIFIED"` and test `status`, integration `NOT_VERIFIED`, webhook delivery `NOT_SENT`, benchmark `data_status`;
  - `POST /shipments` requires `tracking_number` and a known `courier_provider` (strict body);
  - enterprise integration sync answers 424 `INTEGRATION_NOT_CONFIGURED`;
  - `POST /connectors/test` needs `settings.update` (10 per minute per workspace).
- Set `N8N_HOST` (or configure an n8n instance) for automations to call n8n; without it executions fail with `N8N_NOT_CONFIGURED`.
- Workspace roles other than OWNER and ADMIN need an ACTIVE enterprise membership to use enterprise benchmarks, analytics, reports and overview.

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
