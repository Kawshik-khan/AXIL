---
trigger: glob
description: 20 threat vectors, server-side resolution, privileged sessions
globs: src/domains/platform/**/*, src/app/api/v1/platform/**/*, src/lib/security.ts
---

# Platform Security & Threat Defense Rules

## 1. Zero-Trust Defense Boundaries
The Platform Control Plane manages the entire SaaS infrastructure. It enforces active defenses against 20 critical vulnerability vectors:

1. **Privilege Escalation**: Tenant roles can never attain platform scopes; platform roles are strictly validated against `PlatformMembership`.
2. **Insecure Direct Object Reference (IDOR)**: Object access is resolved via cryptographic token claims, never untrusted IDs in request bodies.
3. **Broken Access Control**: Every endpoint verifies both role and granular permissions via `PlatformAuthorizationService`.
4. **Cross-Tenant Leakage**: Queries strictly include tenant isolation parameters; platform aggregates only return sanitized summaries.
5. **Session Fixation**: Session tokens are cryptographically regenerated upon any privilege change or authentication step-up.
6. **Stolen Privileged Sessions**: Inactivity timeout (15 min), absolute session cap (4 hrs), and IP/User-Agent binding.
7. **CSRF**: Strict SameSite cookies, custom authorization headers, and origin verification.
8. **XSS**: Strict Content Security Policy (CSP), automated HTML escaping in UI templates, zero `dangerouslySetInnerHTML`.
9. **SSRF**: Outbound webhooks and provider adapters restrict destinations to validated provider domains; internal cloud metadata endpoints (`169.254.169.254`) and loopback (`127.0.0.1`) are hard-blocked.
10. **SQL Injection**: 100% parameterized queries via typed ORM/query builder; zero string concatenation.
11. **Mass Assignment**: Strict Zod schema parsing; unexpected payload keys are stripped or cause validation errors.
12. **Secret Leakage**: Tokens and credentials in platform settings are encrypted at rest using AES-256-GCM; masked in all UI responses (`******`).
13. **Audit Tampering**: Audit tables are append-only; update and delete statements are blocked by database trigger rules.
14. **Replay Attacks**: Mutating platform requests require correlation ID and timestamp drift verification (< 300s).
15. **Webhook Attacks**: Inbound provider hooks mandate cryptographic HMAC verification with constant-time comparison.
16. **Credential Exposure**: Zero commit policy; environment variables and secret stores manage all platform keys.
17. **Race Conditions**: Concurrent operations on critical platform resources (plans, subscriptions, kill switches) use distributed locks.
18. **Unauthorized Bulk Actions**: Bulk tenant mutations require staged progressive rollout, dry-run simulation preview, and explicit approval.
19. **Malicious Impersonation**: Governed by short-lived `READ_ONLY` sessions, dual-custodian approvals, and persistent UI alerts.
20. **Insecure Break-Glass Access**: Multi-party authorization, short duration (<60 min), and immediate automated notification to security responders.

---

## 2. Inviolable Server-Side Authoritative Resolution
**NEVER** trust client-supplied input for authoritative security decisions:
- **Do NOT trust client-supplied**: `role`, `permissions`, `tenant_id`, `user_id`, `plan`, `entitlements`, or `mfa_status`.
- **Authoritative Resolution**: Always resolve identity, memberships, plan limits, and active permissions server-side from the verified JWT payload and database source of truth.

---

## 3. Privileged Session Security & MFA Enforcement
- **MFA Enforcement**: All accounts holding platform roles must have two-factor authentication (TOTP or WebAuthn) permanently active.
- **Short Session Lifetime**: Platform session tokens have a 15-minute sliding TTL and a 4-hour absolute maximum lifetime.
- **Failed Login Defense**: Exponential rate limiting on failed authentication attempts (5 consecutive failures locks the account for 30 minutes and triggers a high-severity security alert).
- **Session Revocation**: An operator or security admin can instantly terminate all active sessions for a user across all devices.

---

## 4. Governed Break-Glass Emergency Access
Break-glass emergency procedures exist solely for catastrophic system recovery when standard identity providers fail:
- Requires multi-party cryptographic authorization or offline vault keys.
- Strictly time-limited to a maximum of 60 minutes.
- Emits high-priority emergency alerts across all operational monitoring channels.
- Produces immutable, unalterable emergency audit records.
- **NEVER** allow break-glass mechanisms to become an undocumented permanent backdoor.
