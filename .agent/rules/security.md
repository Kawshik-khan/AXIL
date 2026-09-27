---
trigger: always_on
description: Auth, secrets, webhooks, input validation — no backdoors
---

# Security Engineering Rules

1. **Identity & tenant resolution**:
   - Resolve the user and `tenant_id` only via `extractRequestContext` / `extractPlatformContext` (`src/lib/api-response.ts`) from a verified token. Never from body, query, params, or headers the client controls.
   - Missing or invalid credentials → `AuthenticationError` (401). There is no "dev fallback" identity (audit H1).

2. **No backdoors — ever** (audit C1, C3, C8, H10):
   - No master passwords, universal passwords, or pass-the-hash comparisons.
   - No request headers or query flags that grant roles (`x-test-*`, `?asAdmin=`), in any environment, including tests. Tests obtain real tokens through the login/session helpers.
   - Step-up / MFA must verify a real factor (TOTP/WebAuthn). If it isn't implemented, the gate must fail closed and STATUS.md must say TARGET.
   - `JWT_SECRET` and encryption keys: fail closed at startup if missing or equal to a known default; use separate keys per purpose (audit C2, M14).

3. **Secrets**:
   - Never commit real credentials. `.env.example` holds placeholders only (`DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB`). A credential that has been committed must be rotated, not just deleted (audit C5).
   - Every new env var goes into `.env.example` with a placeholder and comment.
   - Mask secrets in responses and logs (last 4 chars at most).

4. **Webhooks** (audit C4, H5):
   - Verify HMAC/signature over the raw body with `crypto.timingSafeEqual` before parsing; reject if older than 300 s; deduplicate by idempotency key.
   - Resolve the tenant from server-side config for that endpoint/secret — never from the payload, and never fall back to "first tenant".
   - No hard-coded fallback secrets.

5. **Input handling**:
   - Validate with Zod `.strict()` schemas; never spread a raw request body into a stored record (mass assignment, audit H4).
   - Use `crypto.randomUUID()` / `crypto.randomBytes` for IDs and tokens — never `Math.random()` (audit M4).
   - Parameterize all SQL; never interpolate identifiers from request input (audit L5).
   - Treat social/customer text as untrusted input to the LLM (prompt injection boundary).

6. **Errors**: 500 responses return a generic message plus `request_id`; internal messages go to logs only (audit L1).

7. **Outbound calls**: only to allow-listed provider hosts; block loopback, link-local, and metadata IPs (SSRF, audit M17).
