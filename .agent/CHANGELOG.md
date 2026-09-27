# CommerceOS Changelog

All notable changes to the CommerceOS platform architecture, specification, and implementation are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
