---
name: security-engineering
description: Fix or build authentication, sessions, JWT, step-up MFA, webhook signature verification, secrets handling, tenant isolation and prompt-injection defenses in CommerceOS. Use for audit findings C1–C8, H1–H5, H10, H13, M4, M9, M13, M14, M17, L1, L8, or any change to src/lib/security.ts, src/lib/api-response.ts, or webhook routes.
---

# Security Engineering

Rules: `.agent/rules/security.md`, `.agent/rules/tenant-isolation.md`. Fix recipes: `FIX_IMPLEMENTATION_PLAN.md` (FX items).

## Hot spots
| File | Concern | Findings |
|---|---|---|
| `src/lib/security.ts` | password verify, JWT secret, encryption key, token generation | C1, C2, M4, M14 |
| `src/lib/api-response.ts` | context extraction, dev fallbacks, test header, error leakage | C3, H1, L1 |
| `src/app/api/v1/platform/auth/**` | platform login, step-up | C8, H10 |
| `src/domains/automation/services/webhook-gateway.service.ts`, `src/app/api/v1/automation/webhooks/[provider]/route.ts` | courier/payment webhook auth | C4 |
| `src/domains/social/webhooks/**`, `src/domains/social/channels/adapters/*.ts` | social webhook auth, tenant routing | H5 |
| `src/domains/automation/services/n8n-provider.service.ts` | outbound URL (SSRF) | M17 |

## Patterns
**Webhook verification**
```ts
import { createHmac, timingSafeEqual } from "crypto";
const raw = await request.text();                                  // verify BEFORE JSON.parse
const expected = createHmac("sha256", secretForEndpoint).update(raw).digest();
const given = Buffer.from(request.headers.get("x-signature") ?? "", "hex");
if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AuthenticationError();
if (Math.abs(Date.now() - Number(request.headers.get("x-timestamp"))) > 300_000) throw new AuthenticationError();
// tenant = the tenant that owns secretForEndpoint (server config), never payload.tenant_id
```
**Secrets at startup**: throw if `process.env.JWT_SECRET` is missing, shorter than 32 chars, or equals any known default string.
**Random values**: `crypto.randomUUID()`, `crypto.randomBytes(32).toString("base64url")`.

## Review questions for any auth change
1. Can a request with **no** token reach anything but public routes? (must be 401)
2. Can any header, cookie, or query flag change the role or tenant?
3. Does a tenant token work on `/api/v1/platform/*`? (must be 403)
4. Can an ID from another tenant be read, updated, approved, or tested?
5. Does any error response include internal messages or stack traces?

## Verify
- Negative tests in `tests/run-tests.ts` / `tests/super-admin-tests.ts` for each question above.
- `grep -rnE "x-test-|MASTER_PASSWORD|masterPassword|\\$2a\\$10\\$" src` returns nothing new.
- Get the `security-reviewer` subagent (Claude Code) or a second pass through `workflows/platform-security-review.md`.
