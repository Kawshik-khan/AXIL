---
trigger: glob
description: Need-to-operate data access, masking, no raw DB consoles
globs: src/domains/platform/**/*, src/app/super-admin/**/*
---

# Platform Data Access & Operational Telemetry Rules

## 1. Prime Principle: Need-To-Operate vs Access-Everything
Platform administration adheres strictly to the **Need-To-Operate** standard:
- Operators access the minimum necessary data required to diagnose an incident, monitor fleet health, or perform governed SaaS tasks.
- Having a `SUPER_ADMIN` platform role is **NOT** a mandate for unrestricted raw database access or arbitrary record browsing.

---

## 2. Inviolable Data Access Invariants
1. **Aggregates & Telemetry Over Raw Records**:
   - Platform dashboards must display aggregated performance metrics, system throughput, error rates, and tenant metadata.
   - Platform dashboards must **NOT** query or display unmasked customer PII (e.g. customer delivery phone numbers, personal notes, home addresses) unless operating under an approved, audited support impersonation session.

2. **Absolute Prohibition of Direct Database Browsing**:
   - **NEVER** expose direct database connection strings, database credentials, or connection pools to client browsers.
   - **NEVER** build or deploy a web interface that provides arbitrary SQL execution, ad-hoc raw query consoles, or unconstrained table browsers.
   - All data queries must route through typed domain services with strict parameterization and access controls.

3. **Masking of Sensitive Secrets & Credentials**:
   - The following credentials must **NEVER** be displayed in plain text within platform UI views or API responses:
     - User password hashes
     - Session tokens and refresh tokens
     - API keys and Webhook signing secrets (display only the last 4 characters, e.g. `sk_live_...4f9a`)
     - Third-party OAuth client secrets
     - bKash, Nagad, and bank API credentials
     - Private RSA/ECDSA signing keys
     - Database connection URLs

4. **Zero Fake Metrics (Truth in Telemetry)**:
   - Platform consoles must display genuine, authoritative data:
     - Real database counts
     - Real operational telemetry
     - Real Redis queue metrics
     - Real provider latency timings
   - **NEVER** hardcode fictional figures, mock revenue numbers, or fabricated uptime statistics in production code.
   - If a subsystem has no data or is not yet initialized, the interface must explicitly render the empty state: `"No data available"` or `"Telemetry pending"`.
