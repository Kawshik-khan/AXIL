# Plan: Self-hosted Better Auth for workspace login

Status: **DRAFT, not started.** Nothing here is implemented. Needs an ADR (proposed ADR-121) and the owner's approval of
the decisions in §2 before any code is written. Adding `better-auth` is a new dependency (AGENTS.md §5.8).

Better Auth facts below were checked against the v1.7 docs (better-auth.com/docs) on 2026-10-26. Items marked
**[verify]** were not confirmed by the docs and must be checked against the installed package before relying on them.

## 1. Goal and scope

**Goal:** replace the hand-written workspace login/session code with Better Auth (the open-source library, running in
this Next.js app, storing data in our own store/Postgres), and gain Google + Facebook sign-in, email verification and
password reset, and a per-device session list — without weakening any Phase 0–4 security property.

**In scope:** workspace (merchant) users: register, login, logout, session, revoke-all, social sign-in, password reset,
email verification, session listing.

**Out of scope (stays as is):**
- Platform console login (`/api/v1/platform/auth/*`, `commerceos_platform_session`, TOTP at login). It has a stricter
  model and a separate cookie on purpose. Revisit only after workspace auth is stable.
- Support impersonation (`src/lib/impersonation.ts`), which keeps its own cookie and token.
- Workspace MFA and step-up (`WorkspaceMfaService`, `x-step-up-token`). They key on `user.id` and
  `session_version`, both of which survive. Moving them to the Better Auth `twoFactor` plugin is a later, optional phase (§9).
- RBAC, tenant scoping, `extractRequestContext`'s checks after identity is known.

## 2. Decisions to make first

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Where Better Auth stores data | **A custom adapter over the existing store** (`createAdapterFactory` from `better-auth/adapters`) | Keeps one system of record and one write path: JSON store in dev/tests, PGlite in `test:pg`, Postgres in prod, all with `withStore`'s unit of work and version-checked writes. A direct `pg` pool would bypass the store, break `npm test` without a database and give Better Auth a second, unsynchronised writer. |
| D2 | User table | **Reuse `users`**, map Better Auth's `user` model onto it (`modelName`, `fields`) | User ids, memberships, audit logs and MFA fields stay attached. No id migration. |
| D3 | Existing passwords | **Keep bcrypt** via `emailAndPassword.password.hash/verify` = `hashPassword`/`verifyPassword` from `src/lib/security.ts`; copy each `users.password_hash` into a `credential` account row | No forced password reset. |
| D4 | Active workspace | A session field `active_tenant_id`, set only by our code after checking membership | Tenant still comes only from the session (non-negotiable #1). |
| D5 | Social providers | **Google + Facebook** first | Facebook matters most for Bangladeshi merchants already on Meta. |
| D6 | Email sending (verification, reset) | Needs a real provider (none exists in `src/`). Until one is chosen, these flows report `NOT_SENT` and stay disabled in production | Non-negotiable #7: no simulated success. |
| D7 | Cutover | **Dual-run** behind `AUTH_PROVIDER=legacy\|dual\|better-auth`, then remove legacy | Old 7-day JWT cookies keep working during the switch; instant rollback. |

## 3. Target design

```
Browser ── /api/auth/[...all] ──► withStore(toNextJsHandler(auth))  ── Better Auth core
                                        │                                  │ adapter: store-adapter.ts
                                        │                                  ▼
                                        │                     db (users, auth_sessions, auth_accounts,
                                        │                         auth_verifications) → Postgres
Browser ── /api/v1/** ──► extractRequestContext
                              ├─ impersonation cookie?  (unchanged)
                              ├─ Better Auth session cookie → auth.api.getSession → userId + active_tenant_id
                              ├─ legacy commerceos_session JWT (only while AUTH_PROVIDER=dual)
                              └─ then the SAME checks as today: user ACTIVE, tenant ACTIVE, membership not
                                 SUSPENDED, role → permissions, step-up, kill switch, feature gates
```

What changes in `AuthService.resolveRequestContext`: only where `userId`/`tenantId` come from. The DB checks after that
stay line for line. That keeps every RBAC and tenant-isolation test meaningful.

### 3.1 Data model (migration `009_better_auth.sql` + store collections)

| Better Auth model | Our collection / table | Notes |
|---|---|---|
| `user` | `users` (existing) | Map `emailVerified`→`email_verified` (new column), `image`→`avatar`, `createdAt`→`created_at`, `updatedAt`→`updated_at`. Keep `status`, `session_version`, `mfa_*` as our own fields (`user.additionalFields`, `input: false` so no client can set them). |
| `session` | `auth_sessions` (new, tenant: none) | Fields `id, token, user_id, expires_at, ip_address, user_agent, created_at, updated_at` + `active_tenant_id` (`session.additionalFields`, `input: false`). |
| `account` | `auth_accounts` (new, tenant: none) | `provider_id` = `credential` / `google` / `facebook`; `password` holds the bcrypt hash; OAuth access/refresh tokens **[verify]** whether Better Auth encrypts them; if not, encrypt in the adapter with `encryptCredential`. |
| `verification` | `auth_verifications` (new, tenant: none) | Reset and verification tokens; short TTL. |

Rules:
- Ids come from our id generator (`advanced.database.generateId`), prefixes `ses_`, `acc_`, `ver_`.
- Register each collection in `src/infrastructure/store/store-schema.ts`, add the SQL in migration 009 with a rollback
  section, and run `npm run test:pg` (store round-trip compares every record).
- Never index or log `token` or `password`. Add both to the logger's redaction list.

### 3.2 `src/lib/auth/better-auth.ts` (server instance)

Sketch only. Exact option names are confirmed in Phase 1 against the installed version:

```ts
export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,      // fail closed: checked by secretProblems()
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [process.env.BETTER_AUTH_URL!],
  database: storeAdapter(),                    // D1
  user: { modelName: "users", fields: { ... }, additionalFields: { status, session_version } },
  session: {
    modelName: "auth_sessions",
    expiresIn: 7 * 24 * 60 * 60,               // same as today's cookie
    deferSessionRefresh: true,                 // GET /get-session must not write (non-negotiable #9)
    cookieCache: { enabled: false },           // revocation must be immediate; revisit after load testing
    additionalFields: { active_tenant_id: { type: "string", input: false } },
  },
  account: { modelName: "auth_accounts", accountLinking: { enabled: true, trustedProviders: ["google"] } },
  verification: { modelName: "auth_verifications" },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,                       // sign-up stays /api/v1/auth/register (creates the workspace too)
    password: { hash: hashPassword, verify: verifyPassword },   // D3, bcrypt
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: ...,                    // D6
  },
  socialProviders: { google: {...}, facebook: {...} },         // only when their env vars are set
  rateLimit: { enabled: false },               // our enforceRateLimit runs in hooks.before (shared in Postgres)
  advanced: { cookiePrefix: "commerceos", useSecureCookies: production },
  hooks: { before: rateLimitAndBodyChecks, after: auditAndSessionVersion },
  plugins: [nextCookies()],                    // must be last
});
```

## 4. Phases

Each phase ends with `npm run type-check` = 0 errors and `npm test` green. Phases 2–5 also need `npm run test:pg`.

### Phase 0: ADR and spike (1 day)
1. Write ADR-121 in `.agent/DECISIONS.md` covering D1–D7, the threat model and the rollback plan.
2. Spike on a throwaway branch: install `better-auth@1.7.x` (pin exact), confirm it builds with Next 16.4 and our Zod 3
   (Better Auth carries its own Zod). Confirm the **[verify]** items: twoFactor secret encryption, OAuth token
   encryption, `deferSessionRefresh` semantics, adapter `select`/`join` needs, cookie names with `cookiePrefix`.
3. Exit: the ADR is accepted and the dependency is approved.

### Phase 1: Store adapter and schema (2 days)
1. Add the `auth_sessions`, `auth_accounts` and `auth_verifications` record types, getters and setters in
   `src/infrastructure/db/index.ts`. Every lookup is by indexed key (token, user_id, identifier); there are no full scans.
2. Add migration `009_better_auth.sql` (schema `commerceos`) with a rollback section; add the collections to `store-schema.ts`.
3. `src/lib/auth/store-adapter.ts`: `createAdapterFactory({ config: { adapterId: "commerceos-store", supportsJSON: false,
   supportsDates: false, supportsBooleans: true, transaction: false }, adapter: ... })`. Implement `create, update,
   updateMany, delete, deleteMany, findOne, findMany, count` over the store. Support only the `where` operators Better
   Auth actually sends and throw on anything else (no silent full-table fallback).
   - `transaction: false` is safe here because every Better Auth call runs inside `withStore`, so its writes commit
     only if the response succeeds. A test must prove this (see §5).
4. Tests: `tests/better-auth-adapter-tests.ts` runs Better Auth's adapter contract cases (if the package exports them
   **[verify]**) plus our own: CRUD, unknown operator throws, writes vanish on a failed request.

### Phase 2: Server instance, route and secrets (1–2 days)
1. `src/lib/auth/better-auth.ts` as in §3.2. Add `BETTER_AUTH_SECRET` (32+ chars, must differ from `JWT_SECRET` and
   `CREDENTIALS_ENCRYPTION_KEY`) and `BETTER_AUTH_URL` to `secretProblems()` so the app refuses to start without them.
   Add placeholders to `.env.example` and the `render.yaml` env list. Add `GOOGLE_CLIENT_ID/SECRET` and
   `FACEBOOK_CLIENT_ID/SECRET` as optional.
2. `src/app/api/auth/[...all]/route.ts`: `export const GET = withStore("GET", h.GET)` and the same for `POST`. Read-only
   GETs pass `tests/phase2-readonly-tests.ts`. Extend that test's route scan to `src/app/api/auth/**`, which sits
   outside `api/v1`.
3. `hooks.before`: `enforceRateLimit` with the same keys and limits as today (`login:tenant:email:*` 10/15 min, per
   client 50/15 min, reset requests per email and per client). Reject unknown body keys on our routes the way
   `.strict()` does today.
4. `hooks.after`: `AuditService.log` `USER_LOGIN`, `USER_LOGOUT`, `PASSWORD_RESET` and `ACCOUNT_LINKED`, with
   `keepEvenIfRequestFails` for failed-login security events, the same as today.

### Phase 3: Context resolution and our own routes (2–3 days)
1. `resolveCallerContext` (`src/lib/api-response.ts`), order: impersonation → Better Auth session (`auth.api.getSession({ headers })`)
   → legacy JWT (only when `AUTH_PROVIDER=dual`) → `DEV_AUTH_BYPASS` (unchanged rules) → 401.
2. `AuthService.resolveFromSession(userId, activeTenantId)`: today's checks, extracted from `resolveRequestContext` so
   both paths share them. A session with no `active_tenant_id` gets a 401 on tenant routes (it can only reach onboarding).
3. `session_version` stays the master revoke switch: store `sv` on the session at creation and reject it if it differs
   from `users.session_version`. Step-up tokens keep working unchanged.
4. Rewire our routes so the API contract stays the same for the dashboard:
   - `POST /api/v1/auth/login`: keep the strict Zod body, rate limits and `AuthService.login`'s checks (suspended
     user, suspended membership, tenant status). Then call `auth.api.signInEmail({ body, headers, asResponse })`,
     set `active_tenant_id`, and pass Better Auth's `Set-Cookie` through.
   - `POST /api/v1/auth/register`: create the tenant + owner membership in the same unit of work, and create the
     user + credential account through `auth.api` or the internal adapter (`disableSignUp` blocks the public endpoint).
   - `POST /api/v1/auth/logout` → `auth.api.signOut`. `POST /api/v1/auth/sessions/revoke-all` → `auth.api.revokeSessions`
     **and** bump `session_version` (this also kills step-up tokens).
   - New: `POST /api/v1/auth/switch-workspace { tenantId }` checks membership, then `auth.api.updateSession`
     (`active_tenant_id` has `input: false`, so only this server path can set it). New: `GET /api/v1/auth/sessions`
     lists the user's devices.
5. `src/proxy.ts`: add the new cookie name to `WORKSPACE_SESSION_COOKIES` (both `commerceos.session_token` and its
   `__Secure-` form in production **[verify]** exact names) and update `tests/landing-routing-tests.ts`.
6. Login and register UI under `src/app/(auth)`: same pages. Only the "Continue with Google/Facebook" buttons are new
   (`createAuthClient` from `better-auth/react`; the client never chooses a tenant).

### Phase 4: Social sign-in and onboarding (2 days)
1. Google and Facebook providers with redirect URIs `${BETTER_AUTH_URL}/api/auth/callback/{google,facebook}`. Write the
   setup steps in `docs/render-runbook.md`.
2. Account linking: link automatically only when the provider reports a **verified** email and the provider is in
   `trustedProviders`. Facebook doesn't always return a verified email, so it is not trusted by default. Its first
   login with an existing email requires a password login first, then linking from settings.
3. A new social user has no membership. Route them to "Create your workspace" (the same service as register, minus
   the password). Never to an implicit tenant.
4. Settings → Security: list sessions, revoke one, revoke others, link or unlink providers (cannot unlink the last
   sign-in method).

### Phase 5: Email verification and password reset (1–2 days, blocked on D6)
1. Add an email adapter under `src/domains/notifications/` (provider chosen in D6) through `outboundRequest`. Until
   it is configured it returns `NOT_SENT`, and the UI says the email was not sent.
2. `sendResetPassword`, `emailVerification.sendVerificationEmail`, `revokeSessionsOnPasswordReset: true`, plus a
   `session_version` bump on reset. Don't await the send inside the request (the docs warn about timing attacks).
3. Decide whether `requireEmailVerification` applies to new accounts only (recommended) or to existing ones too.

### Phase 6: Backfill and cutover (1–2 days + 7 days dual-run)
1. Backfill script (dry run by default, the same pattern as `npm run db:backfill`): for every user with a
   `password_hash` other than `DISABLED_PASSWORD_HASH`, create an `auth_accounts` row
   `{ provider_id: "credential", account_id: user.id, password: password_hash }`. It is idempotent and verified by count
   and sample check. `--apply` touches real Neon, so ask first.
2. Rehearse on a **Neon branch** (never production) with `soak-two-servers.mjs` and `smoke-security.mjs`.
3. Deploy with `AUTH_PROVIDER=dual`. New logins get Better Auth sessions, and existing JWT cookies work until they expire.
4. After 7 days (the old cookie lifetime), switch to `AUTH_PROVIDER=better-auth`.
5. Cleanup PR: delete `signSessionToken`/`verifySessionToken` and the legacy branch of `resolveCallerContext`; keep
   `users.password_hash` one more release, then drop it in a migration.

**Rollback:** set `AUTH_PROVIDER=legacy`. The legacy JWT path and `users.password_hash` stay intact until the cleanup
PR, so rollback only signs people out. Passwords changed through Better Auth after cutover live in `auth_accounts`, so
the cleanup PR ships only after a stable week.

## 5. Tests (new and changed)

`tests/better-auth-tests.ts` (runs before the other suites, next to security-regression):
- Login with a correct bcrypt password succeeds. A wrong password and an unknown email get the same generic error with
  the same timing path.
- Suspended or deactivated user, suspended membership, suspended tenant → refused, the same as today.
- `active_tenant_id` cannot be set through any client endpoint (`update-session` with it in the body → rejected or ignored, test both).
- A session for tenant A cannot read tenant B (reuse the RBAC matrix with Better Auth sessions).
- Revoke-all kills Better Auth sessions **and** step-up tokens. A `session_version` bump kills existing sessions.
- Rate limits trigger at the same thresholds; limits are shared across instances on Postgres.
- `GET /api/auth/get-session` writes nothing (`phase2-readonly` extended).
- A failed Better Auth request leaves no partial rows (unit of work).
- The OAuth callback with a bad `state` is refused; an unverified-email provider never auto-links.
- In dual mode, legacy and Better Auth cookies both resolve; after cutover the legacy cookie is refused.
- `secretProblems()` refuses a missing, short or reused `BETTER_AUTH_SECRET`.

Also: `npm run test:pg`, `scripts/smoke-security.mjs` (add Better Auth endpoints), and the `security-reviewer` and
`done-verifier` agents at the end of each phase.

## 6. Security checklist (GOVERNANCE invariants)

- Tenant only from `active_tenant_id`, set server-side after a membership check. Never from body, query or provider data.
- No dev shortcut: `DEV_AUTH_BYPASS` rules unchanged; no test headers; no default secret.
- CSRF: Better Auth's origin check stays on, with `trustedOrigins` = our own origin only.
- Cookies: HttpOnly, `SameSite=Lax`, `Secure` + `__Secure-` prefix in production.
- Secrets: `BETTER_AUTH_SECRET` distinct from the others, never logged; OAuth tokens encrypted at rest.
- Audit: login, logout, failed login, reset, link and unlink are all audited; failures kept with `keepEvenIfRequestFails`.
- Enumeration: password reset always returns the same response.

## 7. Estimate

About 12–16 working days of engineering, plus the 7-day dual-run, plus waiting on D6 (email provider) for Phase 5.
Phases 1–3 alone (Better Auth with password login and no new features) take about 6 days.

## 8. Docs to update when shipped

`.agent/STATUS.md` (auth capability rows), `.agent/API_CONTRACTS.md` (new routes and cookie), `.agent/SECURITY.md`,
`docs/render-runbook.md` (env vars, OAuth app setup), `AGENTS.md` §3 (`src/lib/auth/`), and `.env.example`.

## 9. Later (optional)

- Move workspace MFA and step-up to the Better Auth `twoFactor` plugin. Only worth it if the plugin's secret storage
  meets ADR-103 (secrets encrypted, backup codes single-use) **[verify]**. The plugin has no step-up endpoint, so our
  `x-step-up-token` stays either way.
- Passkeys (`passkey` plugin) for merchants.
- Move platform console login onto a second, separate Better Auth instance with its own cookie and mandatory TOTP.
