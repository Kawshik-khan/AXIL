# CommerceOS — Fix Implementation Plan

**Source:** [AUDIT_REPORT_2026-09-27.md](AUDIT_REPORT_2026-09-27.md) · **Prepared:** 2026-09-27
**Scope:** every finding in the audit (C1-C7, H1-H15, M1-M17, L1-L8, I1-I2), plus one new CRITICAL (C8) and one new safety defect found while planning (§2).

> ⚠️ Like the audit, this plan describes exploitable weaknesses. Keep it private until Phase 0 ships.

---

## 0. How to use this plan

**Structure.** The plan is split into 7 phases and 53 work items named `FX-nn`: 40 detailed sections (Phases 0-4) plus 13 table items (Phases 5-6). Each detailed item lists:
- the finding IDs it fixes;
- effort (**S** ≤ ½ day, **M** 1-3 days, **L** 1-2 weeks);
- dependencies, files, step-by-step changes with code;
- tests, verification commands, "done when" criteria, and rollback.

**Ordering is deliberate.** Phase 0 closes internet-exploitable holes and must ship as **one release**, because its items depend on each other:
- Removing the password backdoors locks out the seeded accounts unless FX-02's reset runs first.
- Removing the header bypass breaks the super-admin UI unless FX-04's login page ships with it.

**Line numbers** are from the audited code (2026-09-27). Re-grep before editing.

**Default assumptions** apply unless you decide otherwise in §1.

**Effort unit** is one developer-day. Totals are in §3.

---

## 1. Decisions needed (with defaults)

| # | Decision | Options | Default assumed by this plan | Affects |
|---|---|---|---|---|
| D1 | System of record | (a) Neon Postgres (b) SQLite, single node (c) keep JSON file | **(a) Neon**. The JSON store stays only as a stop-gap until Phase 4 | Phase 4 |
| D2 | Product intent | Academic/demo build vs production SaaS | **Production-bound**. If demo-only, Phase 5 shrinks to "label as simulated" (FX-31 already does that) | Phase 5 |
| D3 | Deployment topology | Single node vs multi-replica (K8s per `.agent/DEVOPS.md`) | **Exactly 1 replica until FX-45**; multi-replica only after Postgres cutover | FX-24, FX-45 |
| D4 | AI provider | OpenAI-compatible (OpenAI / Ollama / vLLM / OpenRouter) · Gemini · Anthropic · keep mock | **OpenAI-compatible adapter** configured from env or connector; mock allowed only in labelled demo mode | FX-32 |
| D5 | Real integrations to build first | WhatsApp Cloud, Messenger, Instagram, Steadfast, Pathao, RedX, bKash, Nagad | **WhatsApp Cloud + one courier + one MFS** | Phase 5 |
| D6 | Seeded demo accounts in production | Keep (with real passwords) vs disable | **Disable** outside demo mode (`SEED_DEMO_DATA=1` required) | FX-02 |

---

## 2. New findings discovered while planning

These are additions to the audit.

| ID | Severity | Status | Location | Finding |
|---|---|---|---|---|
| **C8** | CRITICAL | PROVEN (code) | `src/app/api/v1/platform/auth/login/route.ts:33-37` | Platform (super-admin) login accepts **any password** for any platform operator: `isValid = password === "Password123!" \|\| user.password_hash === password \|\| user.password_hash.startsWith("$2a$10$")`. Every hash from `hashPassword()` (bcrypt cost 10) starts with `$2a$10$`, so the check is always true. The same response also returns the platform JWT in the JSON body. |
| **C1-b** | (context for C1) | PROVEN (runtime) | seeds at `src/infrastructure/db/index.ts:1117, 1152, 1209` | The seeded hash `$2a$10$iM.oG9E…` matches **neither** documented password (`bcrypt.compare` returns false for both `Password123!` and `CommerceOS2026!`). Seeded accounts only log in because of the backdoors, so removing the backdoors locks them out. FX-02 handles this. |
| **H11-b** | HIGH | PROVEN (code) | `src/app/(dashboard)/autonomous/governance/page.tsx:55-70` | The **"EMERGENCY KILL SWITCH"** button POSTs to `/api/v1/ai/tools/execute` (404), ignores the response, then alerts "EMERGENCY KILL SWITCH ACTIVATED. All autonomous executions halted." A safety control fails silently while confirming success. Fixed in FX-33 (first item). |
| **H5-b** | (context for H5) | PROVEN (code) | `db/index.ts:2465, 2480, 2495, 2510`; `channel.service.ts:162-168` | Seeded channels store placeholder strings (`"encrypted_fb_token_seed"`), not ciphertext. Decryption fails, and `getDecryptedCredentials` swallows the error and returns `{}`. Signature checks then fall back to the literal `"meta_test_secret"`. |

---

## 3. Roadmap overview

| Phase | Goal | Items | Effort (dev-days) | Exit gate |
|---|---|---|---|---|
| **0 · Containment** (ship as one release) | Close every unauthenticated or remote exploit | FX-00 … FX-08 | ~4 | All 12 exploit replays in §11 return 401/403; 297 legacy tests plus the new security suite pass |
| **1 · Access control & integrity** | Least privilege, tenant isolation, abuse limits | FX-10 … FX-19 | ~9 | RBAC matrix test green (141 handlers); IDOR tests green |
| **2 · Performance & durability stop-gap** | Stop whole-file writes on the request path; correct analytics inputs | FX-20 … FX-24 | ~5 | p95 < 500 ms at 20 VUs; GETs perform zero writes; intelligence endpoints < 2 s |
| **3 · Truthful data & wiring** | Remove fabricated numbers and false successes; fix broken flows | FX-30 … FX-39 | ~14 | Contract gate green; honesty tests green; no fabricated constants remain (grep gate) |
| **4 · Postgres migration** | Real durability, transactions, multi-replica | FX-40 … FX-45 | ~18-25 | JSON store retired; backfill verification 100%; 2-replica soak test clean |
| **5 · Real integrations** (scope per D2/D5) | Messages, couriers and payments actually happen | FX-50 … FX-55 | ~18-36 | Sandbox end-to-end tests per provider |
| **6 · Tests, CI & docs** (continuous) | Keep it fixed | FX-60 … FX-66 | ~4.5 (plus tests inside each item) | `npm run verify` required before every merge |

**Timing:**
- Phases 0-3 and 6: about **36 dev-days**, roughly 7 weeks for one developer, or about 4 weeks for two working in parallel after Phase 0.
- Phase 4 adds 4-5 weeks.
- **Minimum to demo safely on a network:** Phase 0 + FX-10/11/12/13/14 + FX-20/21/22 + FX-31/33 ≈ **3 weeks**.

**Dependencies:**

```
FX-00 → FX-01 → FX-02 → FX-03 → FX-04/05/06/07 → FX-08 (release 0)
                    │
Phase 1: FX-10 ← FX-11 (new permission) ; FX-13 before FX-34 ; FX-15 needs FX-03 audiences
Phase 2: FX-20 before FX-21/22 (batching relies on coalesced persist)
Phase 3: FX-35 before FX-50..52 ; FX-31 before Phase 5 ; FX-38 before any `next build`
Phase 4: FX-40 → FX-41 → FX-42 → FX-43 → FX-44 → FX-45   (FX-35, FX-22 simplify it)
```

---

## 4. Phase 0 — Containment (single release)

### FX-00 · Put the project under version control safely
**Fixes:** prerequisite (no VCS today) · **Effort:** S (0.25) · **Depends on:** — · **Order:** do FX-01 step 3 (scrub `.env.example`) **before** the first commit, so the credential never enters history.

1. Create `.gitignore` **before** `git init`:
   ```gitignore
   node_modules/
   .next/
   .data/
   .env
   .env.local
   .env.*.local
   *.tsbuildinfo
   tsc_errors.log
   tests/test-results.json
   scratch/
   ```
2. Run:
   ```bash
   git init
   git add -A
   git status --short | grep -E "\.env\.local|\.data/|node_modules" && echo "STOP: sensitive files staged"
   git commit -m "Baseline before remediation"
   ```
3. **Done when:**
   - `git ls-files | grep -E "^\.env\.local$|^\.data/"` prints nothing;
   - `git grep -n "npg_"` prints nothing.

### FX-01 · Rotate and scrub the database credential
**Fixes:** C5 · **Effort:** S (0.25) · **Depends on:** —

1. In the Neon console, reset the password of `neondb_owner`. Better: create a least-privilege role `commerceos_app` (CONNECT, plus DML on the schema) and use that for the app. Keep the owner role for migrations only.
2. Update `DATABASE_URL` and `DATABASE_URL_POOLED` in `.env.local` (never in `.env.example`).
3. Replace `.env.example` lines 7 and 11-12 with placeholders, and document the new variables (full list in Appendix C):
   ```dotenv
   JWT_SECRET=                      # 48+ random chars: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   CREDENTIALS_ENCRYPTION_KEY=      # 48+ random chars (different from JWT_SECRET)
   DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
   DATABASE_URL_POOLED=postgresql://USER:PASSWORD@HOST-pooler/DB?sslmode=require
   SEED_ADMIN_PASSWORD=             # only for local/demo seeding, 14+ chars
   ```
4. Check other copies of the old string: shared zips, `CommerceOS_IEEE_Project_Proposal.docx`, chat logs.
5. **Verify:** `npm run db:health` succeeds with the new URL; the old URL is rejected by Neon.

### FX-02 · Remove every credential backdoor and reset seeded passwords
**Fixes:** C1, C8, C1-b, part of H10 · **Effort:** S (0.5) · **Depends on:** FX-01

**Step 1: bcrypt only.** In `src/lib/security.ts:25-39`, replace `verifyPassword`:
```ts
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== "string" || typeof hash !== "string" || !hash.startsWith("$2")) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
```

**Step 2: platform login.** In `src/app/api/v1/platform/auth/login/route.ts`:
```diff
-    const user = db.findUserByEmail(email.toLowerCase().trim());
-    if (!user) {
-      throw new AppError("INVALID_CREDENTIALS", "Invalid platform administrator credentials.", 401);
-    }
+    const user = db.findUserByEmail(String(email).toLowerCase().trim());
+    // Constant-work path so response time does not reveal whether the email exists.
+    const passwordOk = await verifyPassword(String(password), user?.password_hash ?? DUMMY_BCRYPT_HASH);
+    if (!user || !passwordOk) {
+      throw new AppError("INVALID_CREDENTIALS", "Invalid platform administrator credentials.", 401);
+    }
 ...
-    const isValid =
-      password === "Password123!" ||
-      user.password_hash === password ||
-      user.password_hash.startsWith("$2a$10$");
-    if (!isValid) { … }
 ...
-      mfaVerified: platformMembership.mfa_enabled,
+      mfaVerified: false,              // becomes true only after a TOTP challenge (FX-15)
 ...
-    const response = apiSuccess({
-      token,
-      user: { … },
+    const response = apiSuccess({
+      user: { … },                     // token is delivered only as the httpOnly cookie
```
Notes:
- `DUMMY_BCRYPT_HASH` is a module constant created once with `bcrypt.hashSync(crypto.randomUUID(), 10)`.
- Keep the membership check **after** the password check, so the endpoint doesn't reveal which emails are operators.
- Move the `FAILED_LOGIN` security-event write into the `!passwordOk` branch.

**Step 3: step-up interim.** In `src/app/api/v1/platform/auth/step-up/route.ts:9-21`, require re-entry of the operator's password. TOTP replaces this in FX-15.
```ts
const { password } = await request.json().catch(() => ({}));
const operator = db.findUserById(context.platformUser.id);
const ok = !!operator && typeof password === "string" && (await verifyPassword(password, operator.password_hash));
if (!ok) throw new AppError("INVALID_STEP_UP_CODE", "Re-enter your password to elevate.", 401);
```
The UI change (`{ password }` instead of `{ mfaCode }`) is in FX-04.

**Step 4: seeding stops hard-coding hashes.** In `src/infrastructure/db/index.ts`, `ensureDefaultSeed` (`:1117`, `:1152`, `:1209`):
- The demo tenant, owner and platform staff are created only when `process.env.SEED_DEMO_DATA === "1"`.
- The hash is `bcrypt.hashSync(process.env.SEED_ADMIN_PASSWORD!, 12)`. Fail with a clear error if the password is missing or shorter than 14 characters.
- Otherwise, create no users. Platform bootstrap in production uses a one-off script, not auto-seed.

**Step 5: one-off reset for the existing data file.** Create `scripts/reset-seed-passwords.ts`. **Run it before deploying Step 1**, otherwise the 6 seeded accounts are locked out.
```ts
// Run: SEED_ADMIN_PASSWORD='…' node tests/ts-runner.cjs ./scripts/reset-seed-passwords.ts
import bcrypt from "bcryptjs";
import { db } from "@/infrastructure/db";

const SEEDED = ["admin@commerceos.io", "superadmin@commerceos.io", "support@commerceos.io",
  "ops@commerceos.io", "analyst@commerceos.io", "security@commerceos.io"];

const pw = process.env.SEED_ADMIN_PASSWORD;
if (!pw || pw.length < 14) { console.error("SEED_ADMIN_PASSWORD (>= 14 chars) is required"); process.exit(1); }
const hash = bcrypt.hashSync(pw, 12);
for (const email of SEEDED) {
  const user = db.findUserByEmail(email);
  if (!user) { console.log(`skip  ${email} (not found)`); continue; }
  db.updateUser(user.id, { password_hash: hash });
  console.log(`reset ${email}`);
}
// After FX-20 lands: await db.flush();
```
For production, deactivate every seeded platform account except one owner (D6): `db.updateUser(id, { status: "DEACTIVATED" })`.

**Step 6:** delete `scratch/test-superadmin-login.ts`. It relies on the backdoor.

**Tests (FX-60):**
- `verifyPassword("Password123!", <hash of other pw>) === false`
- `verifyPassword(hash, hash) === false`
- Platform login with a wrong password returns 401.
- Step-up with a wrong password returns 401.

**Verify:** replay audit checks F2 and C8 (§11); both return 401.

**Rollback:** revert the commit. **Don't** ship a rollback that restores the backdoors; re-run the Step 5 script instead if anyone is locked out.

### FX-03 · Fail-closed secrets, per-purpose tokens, separate encryption key
**Fixes:** C2, M14, part of H10 · **Effort:** M (0.75) · **Depends on:** FX-01

**Step 1: generate new secrets.** Put `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` (48+ random characters each, different values) in `.env.local`.

**Step 2: `src/lib/security.ts`.** Load keys lazily, so a missing env var doesn't break `next build` at import time. Add audiences and an issuer.
```ts
const DEFAULT_SECRET_PREFIX = "commerceos_super_secret";
const ISSUER = "commerceos";
export const TOKEN_AUDIENCE = {
  tenant: "commerceos:tenant",
  platform: "commerceos:platform",
  stepUp: "commerceos:step-up",
  impersonation: "commerceos:impersonation",
} as const;

function requireSecret(name: "JWT_SECRET" | "CREDENTIALS_ENCRYPTION_KEY"): string {
  const value = process.env[name];
  if (value && value.length >= 32 && !value.startsWith(DEFAULT_SECRET_PREFIX)) return value;
  if (process.env.NODE_ENV === "test") return `test-only-${name}`.padEnd(48, "x");
  throw new Error(`${name} must be a unique random value of at least 32 characters.`);
}

let jwtKeyCache: Uint8Array | null = null;
const jwtKey = () => (jwtKeyCache ??= new TextEncoder().encode(requireSecret("JWT_SECRET")));

let encKeyCache: Buffer | null = null;
const encryptionKey = () =>
  (encKeyCache ??= crypto.createHash("sha256").update(requireSecret("CREDENTIALS_ENCRYPTION_KEY")).digest());
```
Then:
- Replace every use of `key` with `jwtKey()`, and `ENCRYPTION_MASTER_KEY` with `encryptionKey()`.
- Every `new SignJWT(...)` chain gets `.setIssuer(ISSUER).setAudience(TOKEN_AUDIENCE.<kind>)`.
- Every `jwtVerify(token, jwtKey(), { algorithms: ["HS256"], issuer: ISSUER, audience: TOKEN_AUDIENCE.<kind> })` passes the matching audience. A tenant token can then never be accepted as a platform, step-up or impersonation token, and vice versa.
- `signPlatformSessionToken`: `const mfaVerified = payload.mfaVerified ?? false;` (was `?? true`, `:148`).
- `verifyPlatformSessionToken`: return `mfaVerified: payload.mfaVerified === true`.

**Step 3: re-encrypt stored credentials before switching keys.** Create `scripts/rotate-credential-key.ts`:
- Inputs: `OLD_JWT_SECRET` (the old default value, supplied once via env) and the new `CREDENTIALS_ENCRYPTION_KEY`.
- For every record in `db.data.connected_channels`, `db.data.connector_configurations` and `db.data.integration_installations`:
  1. Try to decrypt `credentials_encrypted` with `sha256(OLD_JWT_SECRET)`.
  2. On success, re-encrypt with the new key.
  3. On failure (e.g. the seed placeholders `"encrypted_fb_token_seed"`), set the record's `status` to `"NEEDS_CREDENTIALS"` and list it in the output.
- Print counts: re-encrypted, needs-credentials, failed. Then flush.

**Step 4: fail loudly on bad credentials.** In `src/domains/social/channels/channel.service.ts:162-168`, `getDecryptedCredentials` must stop returning `{}` on failure. It should throw `AppError("CHANNEL_CREDENTIALS_INVALID", …, 424)`, which callers treat as "channel misconfigured". Without this, verification falls back to default secrets (H5-b).

**Side effects:**
- Every existing session is invalidated, so users must log in again. Announce it.
- Seeded channels will show "Needs credentials".

**Tests:**
- A token signed with the old default secret is rejected.
- A tenant token presented to `verifyPlatformSessionToken` returns null (audience mismatch).
- A platform token presented as a tenant session returns 401.
- Round-trip `encryptCredential`/`decryptCredential` works under the new key.

**Verify:** audit checks C1 and D3 (forged tokens) return 401.

### FX-04 · Remove the header bypass; give super-admin a real login
**Fixes:** C3, H10 (UI contract), M1 items 2-4 · **Effort:** M (1.0) · **Depends on:** FX-02, FX-03

1. **`src/lib/api-response.ts`:** delete the `x-test-platform-role` block (`:212-245`) and the platform dev fallback (`:247-270`). The function now ends with `throw new PlatformAuthRequiredError(...)` when no valid token is present. No test uses the header (verified by grep); tests that need a platform context should build a `PlatformContext` object directly.

2. **New `src/app/super-admin/login/page.tsx`:** email and password form that posts to the existing `POST /api/v1/platform/auth/login` and redirects to `/super-admin` on 200. The httpOnly cookie `commerceos_platform_session` is set by the route.

3. **`src/app/super-admin/page.tsx`:** remove all 11 `"x-test-platform-role": "SUPER_ADMIN"` headers (`:161, 232, 261, 283, 301, …`) and route every call through one helper:
   ```ts
   async function platformFetch(url: string, init: RequestInit = {}, stepUpToken?: string | null): Promise<Response> {
     const headers = new Headers(init.headers);
     if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
     if (stepUpToken) headers.set("x-step-up-token", stepUpToken);
     const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
     if (res.status === 401) {
       window.location.assign("/super-admin/login");
       throw new Error("Platform session expired");
     }
     return res;
   }
   ```

4. **Step-up modal (`:432-450`):** send `{ password }` from a "Confirm your password" field (FX-02 interim), later `{ code }` (TOTP, FX-15). Only show "elevation granted" when `res.ok`.

5. **Fix the broken calls:**
   - **Revoke impersonation (`:345`):** `platformFetch(\`/api/v1/platform/support/impersonate?sessionId=${encodeURIComponent(sessionId)}&reason=${encodeURIComponent(reason)}\`, { method: "DELETE" })`. The route already exists as `DELETE`.
   - **Deactivate kill switch (`:390`):** `platformFetch("/api/v1/platform/safety/kill-switch", { method: "POST", body: JSON.stringify({ action: "DEACTIVATE", id, reason }) })`. `POST` with `action: "DEACTIVATE"` already exists.
   - Check `res.ok` for both, and show the server's error message on failure.

6. **Platform logout** (`api/v1/platform/auth/logout`) clears the platform cookie. Add a "Sign out" control to the super-admin page.

**Verify:**
- Audit check D2 (header role) returns 401.
- Opening `/super-admin` while logged out redirects to `/super-admin/login`.
- Login with the password reset in FX-02 works.
- Step-up works from the UI.
- Revoke and deactivate return 200.

**Rollback:** revert the page and route commits together (they're coupled).

### FX-05 · Make the dev auth fallback explicit opt-in
**Fixes:** H1 · **Effort:** S (0.25) · **Depends on:** FX-02 (so dev can log in normally)

In `src/lib/api-response.ts:93-137`, the fallback is never used for invalid tokens and never without an explicit flag:
```ts
const devBypassEnabled = () =>
  process.env.NODE_ENV === "development" && process.env.DEV_AUTH_BYPASS === "1";

if (!token) {
  if (devBypassEnabled()) {
    const dev = getDevFallbackContext();      // use admin@ (tenant OWNER), not the super-admin account
    if (dev) {
      console.warn("[auth] DEV_AUTH_BYPASS=1 — request served as dev OWNER");
      return dev;
    }
  }
  throw new AppError("AUTHENTICATION_REQUIRED", "No authentication session token provided.", 401);
}
return AuthService.resolveRequestContext(token, requestId);   // invalid/expired → 401, no fallback
```
Also add a boot-time warning banner in `(dashboard)/layout.tsx` when the session carries `dev_bypass: true`.

**Verify:** audit checks B1 and B2 return 401 when `DEV_AUTH_BYPASS` isn't set.

### FX-06 · Authenticate courier and payment webhooks
**Fixes:** C4 · **Effort:** S (0.5) · **Depends on:** —

**Design:**
- Each webhook row gets a **non-secret identifier** in the URL: `/api/v1/automation/webhooks/{provider}?wh=<webhook_id>`.
- It also gets a **secret** in env (`secret_reference`), sent as a Bearer token (TOKEN) or HMAC signature.
- The tenant always comes from the webhook row, never from `x-tenant-id` or `?tenant_id=`.

**Step 1:** in `src/app/api/v1/automation/webhooks/[provider]/route.ts:15-30`, delete the tenant resolution from headers/query and the `"tenant_default"` fallback. Pass `webhookId` from `?wh=` into the gateway, and read `tenantId` from `verification.webhook!.tenant_id` after verification.

**Step 2:** in `src/domains/automation/services/webhook-gateway.service.ts`:
```ts
public static resolveWebhookSecret(secretReference: string): string {
  const value = process.env[secretReference];
  if (!value || value.length < 24) {
    throw new AppError("WEBHOOK_SECRET_MISSING", `Webhook secret ${secretReference} is not configured.`, 503);
  }
  return value;                                   // removed: `sec_wh_${…}` fallback (:45)
}

private static safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);          // fixed length, no case folding (tokens are case-sensitive)
}
```
Replace `:137-202` with algorithm-specific verification. **Nothing is skipped because of a `Bearer` header.**
```ts
const secret = this.resolveWebhookSecret(webhook.secret_reference);
if (webhook.signature_algorithm === "TOKEN") {
  const auth = req.headers["authorization"] ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-webhook-token"] ?? "");
  if (!presented || !this.safeEqual(secret, presented)) return this.reject(deliveryId, webhook, "INVALID_SIGNATURE", "Invalid webhook token.");
} else {
  if (!signatureHeader) return this.reject(deliveryId, webhook, "INVALID_SIGNATURE", "Missing signature header.");
  // keep existing HMAC_SHA256/512 comparison; require the timestamp header for providers that sign one
}
```
Also:
- `this.reject(...)` is a small new private helper that writes the existing `REJECTED` delivery record and returns `{ verified: false, code, reason, webhook, deliveryId }`, the same shape as today's inline blocks.
- Look up webhooks by `(id, provider, is_active)` with the `wh` identifier; drop the provider-only lookup.

**Step 3:** migrate the existing seed rows (`db/index.ts:2406-2452`). Keep `signature_algorithm: "TOKEN"`, and document the four env secrets: `STEADFAST_WEBHOOK_SECRET`, `PATHAO_WEBHOOK_SECRET`, `BKASH_WEBHOOK_SECRET`, `NAGAD_WEBHOOK_SECRET`.

**Step 4:** until FX-35 lands, `CourierSyncService` must refuse to change orders in `CANCELLED`, `RETURNED` or `REFUNDED` (return `success:false`, create an operational exception).

**Step 5:** show each webhook's full URL (with `?wh=`) in Automations → Providers, so operators can paste it into courier portals.

**Verify:**
- Audit check G1 (no auth) returns 401.
- `Authorization: Bearer anything` returns 401.
- The correct token returns 200.

### FX-07 · Harden social webhook ingress
**Fixes:** H5, H5-b · **Effort:** S (0.5) · **Depends on:** FX-03 (fail-loud credentials)

1. In `webhook-ingress.service.ts:61-77`, delete both fallbacks: the first active channel of *any* tenant (`:66-71`) and the sandbox channel in `ten_default_dhaka` (`:73-77`). If no channel matches the payload's page ID or phone-number ID, log it and return `{ success:false, messagesProcessed:0 }`. The HTTP route still answers 200, so Meta doesn't retry forever.
2. In the same file (`:79-86`), always verify: remove the `if (channel)` guard.
3. In `facebook.adapter.ts:21`, `instagram.adapter.ts:21` and `whatsapp.adapter.ts:21`:
   ```ts
   const appSecret = credentials.appSecret || process.env.META_APP_SECRET;
   if (!signature || !appSecret) return false;          // removed: `|| credentials.apiKey || "meta_test_secret"`
   ```
4. In `social/webhooks/{facebook,instagram,whatsapp}/route.ts` (GET verify, `:10-13`):
   ```ts
   const expectedToken = process.env.META_VERIFY_TOKEN;
   if (!expectedToken) return new NextResponse("Webhook verification not configured", { status: 503 });
   ```
5. In `social/widget/message/route.ts`:
   - require `channel_id` to be a `WEBSITE_CHAT` channel;
   - require its public `widget_key` to match;
   - enforce an `Origin` allow-list stored on the channel;
   - cap `text` at 2,000 characters;
   - rate-limit per IP and per `anonymous_id` (FX-14).
6. Identity resolution: stop fabricating profiles and phones (FX-36 does the phone; here, drop the `Facebook User ####` display names when the Graph profile isn't fetched).

**Verify:**
- An unsigned POST to `/social/webhooks/facebook` persists no message.
- A POST signed with the channel's app secret is processed.
- A page ID from another tenant is ignored.

### FX-08 · Phase 0 release gate
**Effort:** S (0.25)

- Run the existing suite: `node tests/full-system-test.cjs` (297 tests).
- Run the new `tests/security-regression-tests.ts` (FX-60).
- Run the exploit replay `scripts/smoke-security.mjs` (FX-65) against a local server. All 12 checks in §11 must match "After".
- Tag the release `phase-0-containment`.

---

## 5. Phase 1 — Access control & integrity

### FX-10 · Enforce RBAC on the 108 unguarded route files (141 handlers)
**Fixes:** H2 · **Effort:** M (2.0) · **Depends on:** FX-11 (adds new permissions)

1. **`src/lib/permissions.ts`:** add three permissions to `PERMISSIONS` and grant them:
   ```ts
   PAYMENTS_VERIFY: "payments.verify",       // ADMIN, FINANCE (+ OWNER automatically)
   MARKETING_APPROVE: "marketing.approve",   // ADMIN (+ OWNER) — creators (MARKETING role) cannot approve
   ANALYTICS_MANAGE: "analytics.manage",     // ADMIN (+ OWNER) — used by recompute jobs (FX-21)
   ```

2. **Every handler in Appendix A** gets one line right after `extractRequestContext` (mechanical change; the table gives the exact permission for each):
   ```diff
    const context = await extractRequestContext(request);
   +RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
   ```

3. **Approver identity always comes from the session.** Change:
   - `growth/campaigns/[id]/approve/route.ts:12`
   - `growth/campaigns/[id]/reject/route.ts:12`
   - `autonomous/decisions/[id]/approve/route.ts:15`

   ```diff
   -const approvedBy = body.approved_by || context.user?.id || "MERCHANT";
   +const approvedBy = context.user.id;
   ```

4. **Four-eyes rule for high-risk campaigns.** In `campaign.service.ts`, `approveCampaign` (the `GrowthCampaign` type already has `created_by`):
   ```ts
   if (campaign.action_risk_level === ActionRiskLevel.HIGH && campaign.created_by === approverId) {
     throw new ForbiddenError("High-risk campaigns must be approved by someone other than their creator.");
   }
   ```

5. **`operations/providers` POST** lets any caller record fake provider-health data. Remove it from the public API; health comes from real calls only.

6. **UI gating:**
   - `FloatingNav.tsx` and `CommandPalette.tsx` filter modules by `session.permissions`, e.g. hide Growth without `marketing.read` and Autonomous without `autonomous.read`.
   - Pages hide action buttons the user can't perform.
   - On 403, pages render the existing `NoPermission` state from `components/ui/States`.

7. **Role review:** confirm with the product owner that MANAGER, SALES, SUPPORT and INVENTORY *should* lose access to Growth, Marketing, Autonomous and Enterprise. They get it today only because checks are missing.

**Tests:** FX-61, a table-driven 403 check for every mutating handler with a SUPPORT token, plus 200 with an ADMIN token.

**Done when:** a grep for route files without `assertCan|hasPermission` under the six domains prints nothing.

### FX-11 · Harden payment verification
**Fixes:** H3 · **Effort:** S (0.5) · **Depends on:** FX-10 step 1

- `src/infrastructure/db/index.ts`: add `findPaymentByTransactionId(tenantId, provider, trxId)`.
- `src/domains/payments/payment.service.ts:93-146`:
  ```ts
  public static async verifyPayment(context: RequestContext, paymentId: string, transactionId: string): Promise<Payment> {
    RbacService.assertCan(context, PERMISSIONS.PAYMENTS_VERIFY);          // was PAYMENTS_READ
    const trx = String(transactionId).trim().toUpperCase();
    if (!/^[A-Z0-9]{6,32}$/.test(trx)) throw new ValidationError("Transaction ID format is invalid.");

    const payment = db.findPaymentById(context.tenant.id, paymentId);
    if (!payment) throw new NotFoundError("Payment", paymentId);
    if (payment.status === "PAID") {
      if (payment.transaction_id === trx) return payment;                // idempotent
      throw new ConflictError("Payment is already verified with a different transaction ID.");
    }
    const reused = db.findPaymentByTransactionId(context.tenant.id, payment.provider, trx);
    if (reused && reused.id !== payment.id) {
      throw new ConflictError("This transaction ID is already attached to another payment.", { payment_id: reused.id });
    }
    const order = db.findOrderById(context.tenant.id, payment.order_id);
    if (!order) throw new NotFoundError("Order", payment.order_id);
    // Order has no amount_paid field; derive it from the order's other PAID payments.
    const paidSoFar = db.getPayments(context.tenant.id, order.id)
      .filter((p) => p.status === "PAID" && p.id !== payment.id)
      .reduce((sum, p) => sum + p.amount, 0);
    const due = order.grand_total - paidSoFar;
    if (payment.amount + 0.5 < due) {
      throw new ValidationError("Payment amount is less than the amount due.", { amount: payment.amount, due });
    }
    // Phase 5 (FX-52): if an MFS gateway is configured, confirm the transaction with the provider here.
    // Until then the verification is recorded as MANUAL with the verifying user.
    …update status to PAID with { transaction_id: trx, verification_method: "MANUAL", verified_by: context.user.id } …
  }
  ```
  If partial payments are out of scope, require `payment.amount` to equal `order.grand_total` instead. When the full amount due is covered, set the order's `payment_status` to `"PAID"`; otherwise, record the payment and keep the order's `payment_status` unchanged.
- `createPayment`: validate `amount > 0` and `amount <= grand_total`.
- **Tests:**
  - ANALYST calling verify gets 403.
  - A duplicate TrxID gets 409.
  - An amount below the amount due gets 400.
  - Verifying twice with the same TrxID returns 200 (idempotent).

### FX-12 · Strict PATCH/PUT schemas (mass assignment)
**Fixes:** H4 · **Effort:** M (0.75) · **Depends on:** —

**Step 1:** new `src/lib/validation.ts`:
```ts
import { z, ZodTypeAny } from "zod";
import { ValidationError } from "@/lib/errors";
export function parseOrThrow<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError("Request body is invalid.", { issues: r.error.issues });
  return r.data;
}
```

**Step 2:** new `src/domains/catalog/product.schemas.ts`:
```ts
export const ProductPatchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  short_description: z.string().max(500),
  category_id: z.string().max(100).nullable(),
  brand_id: z.string().max(100).nullable(),
  sku: z.string().trim().min(1).max(64),
  base_price: z.number().nonnegative(),
  compare_at_price: z.number().nonnegative().nullable(),
  cost_price: z.number().nonnegative().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  images: z.array(z.string().url()).max(20),
}).partial().strict();                      // unknown keys (tenant_id, id, variants, created_at…) → 400
```
`product.service.ts:163` becomes `updateProduct(context, id, body: unknown)`, which calls `parseOrThrow(ProductPatchSchema, body)`.

**Step 3:** same for customers (`customer.service.ts:149`). Allow `first_name`, `last_name`, `email`, `phone`, `notes`, `status` (`"ACTIVE" | "BLACKLISTED"`).

**Step 4: defense in depth** in `db/index.ts` `updateProduct` (`:4217`), `updateCustomer` (`:4577`), `updateOrder*`, `updateTenant`, `updateUser` and the generic `update*` helpers:
```ts
const { id: _id, tenant_id: _tenant, created_at: _created, ...safe } = updates as Record<string, unknown>;
this.data.products[idx] = { ...this.data.products[idx], ...safe, updated_at: new Date().toISOString() };
```

**Step 5:** apply the same schema pattern to every other PATCH/PUT that forwards the body:
- `users/[id]`
- `social/channels/[id]`, `social/leads/[id]`, `social/conversations/[id]`
- `tenants/current/settings`
- `growth/{audiences,campaigns,journeys}/[id]` PUT
- `operations/autonomy` PUT
- `social/business-hours` PUT

**Test:** a PATCH with `tenant_id` returns 400; the product stays in its tenant (see the report §6 test).

### FX-13 · Tenant-scope every ID-only accessor (IDOR)
**Fixes:** H13 · **Effort:** M (1.5) · **Depends on:** —

1. Change the signatures of the roughly 50 unscoped accessors in `db/index.ts:6128-7843` to take `tenantId` first:
   ```ts
   public getExecutiveDigestById(tenantId: string, id: string) {
     return this.data.executive_digests.find((d) => d.tenant_id === tenantId && d.id === id);
   }
   ```
   Examples: `getExecutiveDigestById`, `getApprovalRequestById`/`updateApprovalRequest`, `getRecommendationById`, `getDecisionRequestById`, `getWorkflowById`/`updateWorkflow`, `getTaskById`/`updateTask`, `getCampaignById`/`updateCampaign`, `getAudienceById`, `getJourneyById`, `getExperimentById`, `getOfferById`, `getAbandonedCartById`, the operations `update*Exception`, and `integration_installations` lookups.
2. Run `npm run type-check`. Every broken call site is a place to pass `context.tenant.id`, or a background job's own tenant.
3. Callers translate `undefined` into `NotFoundError(...)` (404). Never reveal that the ID exists in another tenant.
4. Priority call sites:
   - `analytics.service.ts:556`
   - `approval-engine.ts:25, 115`
   - `decision.service.ts:21, 124`
   - `integration-hub.service.ts:117`
   - `exception-management.service.ts:81, 113`
   - `experiment.service.ts:72`
   - `campaign.service.ts:145`
   - `journey-engine.service.ts:100`
   - `growth-tools.ts:255, 703`
5. **Tests:** tenant B requesting tenant A's digest, approval or recommendation gets 404 (FX-60).

### FX-14 · Rate limiting
**Fixes:** M13 · **Effort:** S (0.5) · **Depends on:** —

New `src/lib/rate-limit.ts`, in-memory for a single node. When `UPSTASH_REDIS_REST_URL` is set, use the existing `getApiRateLimiter()` in `src/infrastructure/redis/client.ts:34` instead.
```ts
const windows = new Map<string, number[]>();
export function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return { allowed: false, retryAfterSec: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  windows.set(key, hits);
  if (windows.size > 50_000) for (const [k, v] of windows) if (!v.length || now - v[v.length - 1] > windowMs) windows.delete(k);
  return { allowed: true, retryAfterSec: 0 };
}
export function clientKey(request: Request): string {
  // Trust X-Forwarded-For only behind a known reverse proxy.
  return process.env.TRUST_PROXY === "1"
    ? (request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown")
    : "direct";
}
```

| Endpoint | Key | Limit |
|---|---|---|
| `auth/login`, `platform/auth/login` | per email + per client | 10 / 15 min per email; 50 / 15 min per client |
| `auth/register` | per client | 5 / hour |
| `platform/auth/step-up` | per operator | 5 / 15 min |
| `social/widget/message` | per client + `anonymous_id` | 30 / min |
| `automation/webhooks/*`, `social/webhooks/*` | per provider + webhook | 600 / min |
| `ai/simulate`, `ai/copilot/suggest`, `intelligence/nl-query` | per user | 30 / min |

When the limit is hit, throw `new AppError("RATE_LIMITED", "Too many requests. Try again later.", 429, { retry_after_sec })` and set the `Retry-After` header on the response.

### FX-15 · Session hygiene and real MFA
**Fixes:** M9, M10, H10 · **Effort:** M (1.5) · **Depends on:** FX-03

1. **Logout** (`api/v1/auth/logout/route.ts:9-18`) clears `commerceos_session`, `commerceos_platform_session`, and the impersonation cookie (FX-34).

2. **Revocable sessions:**
   - Add `session_version?: number` to `UserRecord` (default 1).
   - Include `sv` in the tenant and platform JWT payloads.
   - `AuthService.resolveRequestContext` and `extractPlatformContext` reject when `payload.sv !== (user.session_version ?? 1)`.
   - Increment `session_version` on password change, suspension, role change, and a new "Sign out everywhere" action.

3. **Remove the implicit OWNER mapping for platform staff** (`auth/service.ts:136-151` and `:216-231`). Platform operators reach tenant data only through audited impersonation (FX-34).

4. **TOTP step-up** replaces the FX-02 interim. New `src/lib/totp.ts` (RFC 6238, SHA-1, 30 s, 6 digits; no new dependency):
   ```ts
   import crypto from "crypto";
   const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
   function base32Decode(input: string): Buffer {
     const clean = input.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
     let bits = 0, value = 0; const out: number[] = [];
     for (const ch of clean) {
       value = (value << 5) | B32.indexOf(ch); bits += 5;
       if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
     }
     return Buffer.from(out);
   }
   export function generateTotp(secretB32: string, timeMs = Date.now()): string {
     const msg = Buffer.alloc(8);
     msg.writeBigUInt64BE(BigInt(Math.floor(timeMs / 1000 / 30)));
     const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
     const offset = h[h.length - 1] & 0x0f;
     return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
   }
   export function verifyTotp(secretB32: string, code: string, timeMs = Date.now()): boolean {
     if (!/^\d{6}$/.test(code)) return false;
     for (const drift of [-1, 0, 1]) {
       if (crypto.timingSafeEqual(Buffer.from(generateTotp(secretB32, timeMs + drift * 30_000)), Buffer.from(code))) return true;
     }
     return false;
   }
   ```
   - **Enrollment:** `POST /api/v1/platform/auth/mfa/enroll` returns an `otpauth://totp/CommerceOS:<email>?secret=…&issuer=CommerceOS` URI (render as a QR code). `POST /api/v1/platform/auth/mfa/confirm` stores `mfa_secret_encrypted` on the platform membership after verifying a code.
   - **Step-up** requires `verifyTotp(...)`. To prevent replay inside the window, remember the last accepted time-step per operator.
   - **Login** for operators with MFA enrolled becomes two-step: password, then TOTP. Only then is `mfaVerified: true` put in the token.
   - **Unit test** (RFC 6238 vector): `generateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000) === "287082"`.

### FX-16 · Cryptographic tokens and IDs
**Fixes:** M4, L4, L6 · **Effort:** S (0.5)

- `security.ts:68-74`: `generateSecureToken(bytes = 32) => crypto.randomBytes(bytes).toString("base64url")`. This fixes invitation tokens (`invitations/service.ts:28`).
- New helper `newId(prefix: string) => \`${prefix}_${crypto.randomUUID().replaceAll("-", "")}\``. Codemod the `Math.random().toString(36)` and `${Date.now()}` ID patterns, including `aud_${Date.now()}` and `evt_${Date.now()}_…`. Find them with `grep -rn "Math.random().toString(36)\|_\${Date.now()}" src`.
- Human-facing numbers (PO numbers at `procurement.service.ts:121`, SKU suffixes at `bulk-import.service.ts:324` and `products/page.tsx:76`) come from per-tenant counters (see FX-35 sequences), not 4-digit random numbers.

### FX-17 · Error hygiene and security headers
**Fixes:** L1, L2, L8 · **Effort:** S (0.5)

- `api-response.ts:57-70`: for non-`AppError` failures, `console.error(reqId, error)` and return the message `"An unexpected server error occurred."`.
- Replace `throw new Error("… not found")` with `NotFoundError(resource, id)` in the growth, autonomous, intelligence and operations services. Find them with `grep -rn 'throw new Error(`.*not found' src/domains`.
- `next.config.js`:
  ```js
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy-Report-Only", value: "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ]}];
  },
  ```
  Switch CSP from Report-Only to enforcing after a week without violations.

### FX-18 · Machine credentials for n8n and automation callbacks
**Fixes:** `automation/actions/*` currently need a user JWT; Developer API keys are DEAD (#75) · **Effort:** M (1.0) · **Depends on:** FX-03, FX-10

1. New collection `service_tokens`: `{ id, tenant_id, name, key_prefix, key_hash (sha256), scopes[], created_by, created_at, last_used_at, expires_at?, revoked_at? }`.
2. Settings → Automations adds "Create service token" (OWNER/ADMIN). The token `cos_svc_<32 random bytes base64url>` is shown **once**.
3. `extractRequestContext` recognizes `Authorization: Bearer cos_svc_…`:
   - look up by `sha256`;
   - check not revoked and not expired;
   - build a context with `user = { id: "svc_<id>", name: token.name, status: "ACTIVE" }`, `role: "SERVICE"`, and `permissions = token.scopes` (subset of `PERMISSIONS`);
   - audit-log with actor type SERVICE.
4. Scopes n8n needs: `inventory.adjust`, `orders.update`, `shipments.create`. The notification route needs a new `notifications.send` permission.
5. Update `n8n/deployment/import.md` and the workflow JSON credential notes.
6. Either wire the enterprise Developer API keys the same way (org-scoped) or remove that UI (D2).

### FX-19 · AI workflows execute with the creator's permissions
**Fixes:** M12 · **Effort:** S (0.25)

`task-executor.ts:243-262` stops building a synthetic OWNER. It loads the workflow creator's membership and uses `RbacService.getPermissionsForRole(role)`. If the creator lost the permission, the task fails with `ForbiddenError` and the workflow records it.

---

## 6. Phase 2 — Performance & durability stop-gap

### FX-20 · Coalesced, asynchronous persistence that reports failures
**Fixes:** C6, C7 (stop-gap) · **Effort:** M (1.0) · **Depends on:** —

**Step 1:** replace `persist()` (`db/index.ts:1041-1073`) with a debounced flush:
```ts
private flushTimer: NodeJS.Timeout | null = null;
private flushing: Promise<void> | null = null;
private dirty = false;
public lastPersistError: { at: string; message: string } | null = null;
private readonly debounceMs = Number(process.env.PERSIST_DEBOUNCE_MS ?? 250);

private persist(): void {                          // called by every mutating method (unchanged call sites)
  if (this.isTestInstance || process.env.NODE_ENV === "test") return;
  this.dirty = true;
  if (!this.flushTimer) {
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, this.debounceMs);
  }
}

public markDirty(): void { this.persist(); }       // for services that mutate db.data directly

public async flush(): Promise<void> {
  if (this.flushing) await this.flushing;
  if (!this.dirty) return;
  this.dirty = false;
  const tmpPath = `${this.filePath}.tmp`;
  this.flushing = (async () => {
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(this.data), "utf-8");  // compact: ~40% smaller than indent=2
      const fh = await fs.promises.open(tmpPath, "r+");
      await fh.sync();
      await fh.close();
      await fs.promises.rename(tmpPath, this.filePath);
      this.lastPersistError = null;
    } catch (err) {
      this.dirty = true;                                                  // retry, never silently drop
      this.lastPersistError = { at: new Date().toISOString(), message: (err as Error).message };
      console.error("[db] persist failed; will retry", err);
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {});
      setTimeout(() => void this.flush(), 1000);
    } finally {
      this.flushing = null;
    }
  })();
  await this.flushing;
}
```

**Step 2: boot hygiene.**
- After a successful load, move stale `commerceos.json.tmp.*` files to `.data/quarantine/` instead of deleting them. They may contain writes that were lost. Log their names and mtimes.
- Also stop swallowing the `mkdirSync` error (`:557-561`).

**Step 3: flush on shutdown.** Register once:
```ts
process.once("SIGTERM", () => void db.flush().finally(() => process.exit(0)))
```
Do the same for `SIGINT`.

**Step 4: code that bypasses `persist()`.** These 18 files mutate `db.data` directly:
- `automation/automation.repository.ts`
- `catalog/bulk-import.service.ts`
- `enterprise/services/integration-hub.service.ts`
- 15 files in `autonomous/services/`: control-plane, cycles, rollback, workflows, autonomy-adaptation, business-objectives, continuous-learning, cross-domain-orchestrator, data-residency, global-decision-engine, global-incident, model-governance, platform-economics, slo-engine, strategy-engine.

Add `db.markDirty()` at the end of every mutating method in them. Mutating means `.push(`, `.splice(`, or assignment to a record field, for example `decision.status = "APPROVED"` in `global-decision-engine.service.ts:155`.

**Step 5:** `/health/ready` returns 503 when `db.lastPersistError` is set or the data directory isn't writable. This replaces the always-ready `:7`.

**Trade-off (document it):** up to `PERSIST_DEBOUNCE_MS` plus the write time of acknowledged writes can be lost on a crash. `JSON.stringify` still pauses the event loop for about 200 ms per flush at 39 MB, but at most once per window instead of 2-7 times per request. Phase 4 removes both.

**Verify:**
- Re-run the latency test: 3 concurrent logins plus an unrelated read. Target: each login < 300 ms; the read < 150 ms (was 2.9-8.6 s).
- `kill -9` during writes loses at most one debounce window.
- `.data/` has no new `.tmp` files.

### FX-21 · Pure GETs, explicit recompute, idempotent inserts
**Fixes:** H8 · **Effort:** M (1.5) · **Depends on:** FX-20, FX-10 (`ANALYTICS_MANAGE`)

1. Split every detector or analyzer into `compute(tenantId): T[]` (pure) and `persistSnapshot(tenantId, rows)` (one batched write):
   - `customer-intelligence.service.ts:116`
   - `product-intelligence.service.ts:95`
   - `inventory-intelligence.service.ts:92`
   - the opportunity, risk and anomaly detectors, and the recommendation service
   - the growth insights and recommendations services
2. **GET** handlers return the latest snapshot if it's younger than 15 minutes. Otherwise they compute in memory and return with `stale: false`, **without writing**.
3. **New `POST /api/v1/intelligence/recompute`** (`ANALYTICS_MANAGE`) runs every detector and persists once. It can also run on an in-process 15-minute timer, created only when `process.env.NEXT_RUNTIME === "nodejs"` and started once per process.
4. **Deterministic IDs** replace `insert*` with `upsert*`:
   - `opp_${tenantId}_${kind}_${entityId}`
   - `risk_${tenantId}_${kind}_${entityId}`
   - `anom_${tenantId}_${metric}_${bucket}`
   - `rec_${tenantId}_${type}_${entityId}`

   Change `db/index.ts:6494, 6507, 6529, 6546` to upsert by ID, and add `upsertMany(collection, tenantId, rows)` helpers.
5. `autonomy-policy.service.ts:37-44`: `getPolicy` returns the default policy **without persisting**. Persist only in the explicit update and kill-switch paths.
6. Enterprise GETs that seed (`enterprise/governance`, `enterprise/integrations`, `enterprise/metrics`) move seeding to tenant provisioning or an explicit setup action.

**Verify:**
- Run the GET sweep (FX-65).
- `.data/commerceos.json` mtime and size are unchanged afterwards.
- `/ai/agents?view=orchestration` and every intelligence endpoint answer in < 2 s cold (were 79-405 s).

### FX-22 · Remove the silent 50-row truncation
**Fixes:** H6 · **Effort:** M (1.5) · **Depends on:** FX-20

**Step 1:** add explicit full-scan accessors to `db/index.ts`. Keep them unhydrated by default.
```ts
public getAllOrders(tenantId: string, opts: { withItems?: boolean } = {}): (Order & { items?: OrderItem[] })[] {
  const orders = this.data.orders.filter((o) => o.tenant_id === tenantId);
  if (!opts.withItems) return orders;
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const it of this.data.order_items) {
    if (it.tenant_id !== tenantId) continue;
    const list = itemsByOrder.get(it.order_id);
    if (list) list.push(it); else itemsByOrder.set(it.order_id, [it]);
  }
  return orders.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] }));
}
public getAllCustomers(tenantId: string): Customer[] {
  return this.data.customers.filter((c) => c.tenant_id === tenantId);
}
```

**Step 2:** migrate the 46 call sites in Appendix B.
- Where the code reads `order.items`, use `{ withItems: true }`.
- Where it reads `customer_name` or `customer_phone`, join through a `Map<customerId, Customer>`.

**Step 3:** make pagination explicit so this can't regress. Change `getOrders(tenantId, options)` and `getCustomers(tenantId, options)` to **require** `{ limit, offset }` (TypeScript enforces it).

**Step 4:** rewrite `customer-intelligence.service.ts:11-121` to O(C+O) with one write:
```ts
public analyzeCustomers(tenantId: string): CustomerIntelligenceRecord[] {
  const ordersByCustomer = new Map<string, Order[]>();
  for (const o of db.getAllOrders(tenantId)) {
    if (o.status === "CANCELLED") continue;
    const list = ordersByCustomer.get(o.customer_id);
    if (list) list.push(o); else ordersByCustomer.set(o.customer_id, [o]);
  }
  const records = db.getAllCustomers(tenantId).map((c) => this.score(tenantId, c, ordersByCustomer.get(c.id) ?? []));
  db.upsertCustomerIntelligenceBatch(tenantId, records);              // single persist
  return records;
}
```

**Verify:**
- RFM rows equal the customer count (10,001).
- Runtime < 3 s.
- Forecasts, lifecycle and the digital twin change to values computed on all 5,001 orders. Record before/after numbers in the PR description.

### FX-23 · Remove O(n·m) hot spots
**Fixes:** the Phase 3 table in the report, M7 · **Effort:** S (0.5)

| Path | Change | Complexity |
|---|---|---|
| `getOrders` search (`db/index.ts:4630-4636`) | Build `customersById` once per call | O(O·C) → O(O+C) |
| `getOrders` hydration (`:4646-4654`) | `itemsByOrderId` map | O(L·I) → O(I+L) |
| `inventory-intelligence.service.ts:38-60` | Maps for product and inventory by variant | O(V·(P+I)) → O(V+P+I) |
| `campaign.service.ts:352-361` | `Map` of **all** customers (fixes suppression too) | O(R·C) → O(R+C) |
| `getDashboardMetrics` (`:4864`) | Per-tenant index built lazily and invalidated on insert (or accept until Phase 4) | O(N_all) → O(N_tenant) |

### FX-24 · Single-writer guard and readiness
**Fixes:** C7 (multi-process lost writes), L3 · **Effort:** S (0.5)

- At boot, create `.data/commerceos.lock` holding `{ pid, host, started_at }` with exclusive create (`fs.openSync(path, "wx")`). If a live process holds it, refuse to start.
- Seed scripts in `scripts/` must refuse to run while the lock is held. They currently write the same file concurrently with `next dev`, which is a likely source of the quarantined `.tmp` files.
- Deployment note: **replicas: 1** until FX-45; document it in `.agent/DEVOPS.md`.
- `/health/ready` also reports lock ownership and persistence health (FX-20).

---

## 7. Phase 3 — Truthful data & broken wiring

### FX-30 · Remove fabricated metrics
**Fixes:** H7 · **Effort:** M (1.5) · **Depends on:** FX-22

**`src/domains/analytics/analytics.service.ts`:**

- **`:446-490` channel report.** Delete `baselineGMV` and `baselineOrders` and the merge. Compute from data only:
  ```ts
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    channel: key, channel_name: d.channel_name,
    orders_count: d.orders_count, orders_share_pct: 0,
    gmv_bdt: Math.round(d.gmv_bdt), gmv_share_pct: 0,
    aov_bdt: d.orders_count ? Math.round(d.gmv_bdt / d.orders_count) : 0,
    conversion_rate_pct: null,                                         // no visit/session data exists
    rto_rate_pct: d.orders_count ? round1((d.rto_count / d.orders_count) * 100) : null,
    cod_share_pct: d.orders_count ? round1((d.cod_count / d.orders_count) * 100) : null,
  };
  ```
  Also:
  - Add an `UNATTRIBUTED` channel instead of defaulting unknown sources to WEBSITE.
  - `:532`: set `top_channel_by_conversion` to `null`.
  - Update `ChannelAttributionMetric` in `src/types/analytics.ts:76-87` to `number | null` for these three fields; the UI renders "—".
- **`:228` period change.** Compute from the previous window:
  ```ts
  const span = endMs - startMs;
  const prevGmv = orders
    .filter((o) => { const t = Date.parse(o.created_at); return t >= startMs - span && t < startMs && o.status !== "CANCELLED"; })
    .reduce((s, o) => s + o.grand_total, 0);
  const period_change_pct = prevGmv > 0 ? round1(((gmv_bdt - prevGmv) / prevGmv) * 100) : null;
  ```
- **`:680-720` time series.** Remove `syntheticBaseGmv` and `effectiveMargin`. Use `gmv_bdt: bucketGmv`, `orders_count: bucketOrders.length`, `aov_bdt: n ? … : null`, `gross_margin_pct: bucketGmv > 0 ? round1((bucketGmv - bucketCogs) / bucketGmv * 100) : null`.
- **`:255-290` RTO.** Remove the `spec.base*` additions. Districts with fewer than 20 shipments get `risk_tier: "INSUFFICIENT_DATA"` and `rto_rate_pct: null`.
- **COGS.** Keep the 42% fallback only when it's labelled. Expose `cogs_estimated_share_pct`, the share of COGS that came from the fallback.

**Other services and pages:**
- **`campaign.service.ts:400-420`:** delete the fabricated `conversionRate`, `aov`, `engagements` and revenue. Results report sends and failures only. Attributed revenue comes from real attributions (orders by recipients within the attribution window that carry the campaign's coupon or UTM), or `null` until attribution exists.
- **`marketing.service.ts:713-730`:** derive insights from data (e.g. the count of `lifecycle_stage === "DORMANT"` customers), or return `[]`.
- **`(dashboard)/page.tsx`:** handled by FX-39.
- **`super-admin/page.tsx:742-930, 1017`:** remove `?? 4999`, `?? 2450000`, `?? 18420`, `94.2`, `99.8`, "99.9% Uptime", "100% MFA". Render "—" when data is missing.
- **`autonomous/objectives/page.tsx:55`:** remove the `"120,000"` and `0.75` fallbacks in the simulation alert.

**Grep gate (CI):** `grep -rnE "baselineGMV|syntheticBase|period_change_pct: [0-9]|\?\? (4999|2450000|18420|1420|184500)" src` must print nothing.

**Tests:** zero orders gives zero totals; `period_change_pct` is null without a previous window (FX-60).

### FX-31 · Honest integration stubs (no more fake success)
**Fixes:** H9 · **Effort:** M (1.5) · **Depends on:** —

**Step 1:** add a non-retryable error to `src/lib/errors.ts`:
```ts
export class IntegrationNotConfiguredError extends AppError {
  readonly retryable = false;
  constructor(integration: string, detail?: string) {
    super("INTEGRATION_NOT_CONFIGURED", `${integration} is not connected${detail ? ` (${detail})` : ""}. Nothing was sent.`, 424, { integration });
  }
}
```

**Step 2:** social adapters. In `facebook.adapter.ts:133-178`, `instagram.adapter.ts:117-160`, `whatsapp.adapter.ts:171-205` and `website-chat.adapter.ts:71-115`, every `send*` throws `IntegrationNotConfiguredError` until Phase 5 implements it. The website chat adapter can deliver for real instead: store the outbound message where the widget polls it.

**Step 3:** in the `outbound-message.service.ts:118-205` retry loop, stop retrying non-retryable errors and record the truth:
```ts
} catch (err) {
  lastError = err instanceof Error ? err : new Error(String(err));
  if (err instanceof IntegrationNotConfiguredError) break;
  …backoff…
}
…
db.updateMessage(tenantId, messageId, { status: "FAILED", failure_reason: lastError?.message, failed_at: … });
```
`ConversationThread.tsx` shows a red "Not delivered — channel not connected" badge.

**Step 4:** marketing adapters (`marketing-channel.service.ts:29-118`) return `{ success: false, error_message: "CHANNEL_NOT_CONNECTED", … }`. Campaign results then show `delivered: 0, failed: N`.

**Step 5:** shipping.
- `shipping.service.ts:95-101` stops inventing `TRK-…` and `CSG-…`.
- Without a courier integration, `tracking_number` is **required** (manual booking; the UI field already exists at `shipments/page.tsx:82`) and the shipment gets `booking_mode: "MANUAL"`.

**Step 6:** connector test (`connectors/service.ts:1464-1700`).
- OpenAI-compatible providers get a real ping: `GET {endpoint}/models` with `Authorization: Bearer <key>`, a 5 s timeout, and `success = res.ok`.
- Every other provider returns `{ success: false, status: "NOT_VERIFIED", message: "Live test not implemented for <provider>; credentials saved but unverified." }`.
- Delete the `Math.random()` latencies.

**Step 7:** channel test (`facebook.adapter.ts:198-202`, same in the other adapters). `validateCredentials` returns `{ valid: false, error: "Live validation not implemented" }` until Phase 5.

**Step 8:** enterprise.
- `integration-hub.service.ts:116-128` and `sync-engine`, `webhook-platform.service.ts:85-100`: responses include `simulated: true`, and the UI shows a "Simulated" badge until FX-54.
- Also tenant-scope the installation lookup (FX-13).

**Step 9:** n8n. Remove the `localhost` / `example.com` mock branch (`n8n-provider.service.ts:209-217`). Tests use an explicit `N8N_DRY_RUN=1` or per-instance `mode: "dry_run"`.

### FX-32 · A real AI provider, or an honest demo label
**Fixes:** H14 · **Effort:** M (2.0) · **Depends on:** D4

**Step 1:** new `src/domains/ai/providers/openai-compatible.provider.ts`. It works for OpenAI, Ollama, vLLM, OpenRouter and other servers exposing `/chat/completions` and `/embeddings`.
```ts
export class OpenAICompatibleProvider implements LLMProvider {
  public readonly providerName: string;
  constructor(private readonly cfg: {
    baseUrl: string; apiKey?: string; name?: string; timeoutMs?: number;
    models: { TIER_1_FAST: string; TIER_2_REASONING: string; TIER_3_EMBEDDING: string };
  }) { this.providerName = cfg.name ?? "openai-compatible"; }

  private async post(path: string, body: unknown, timeoutMs = this.cfg.timeoutMs ?? 30_000): Promise<any> {
    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`LLM provider HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  async chat(messages: LLMMessage[], tools?: LLMToolDefinition[], options?: LLMProviderOptions): Promise<LLMResponse> {
    const started = Date.now();
    const model = options?.model ?? this.cfg.models.TIER_1_FAST;
    const data = await this.post("/chat/completions", {
      model,
      messages: messages.map(toWireMessage),          // see note on assistant tool_calls below
      ...(tools?.length ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
      temperature: options?.temperature ?? 0.2,
      ...(options?.max_tokens ? { max_tokens: options.max_tokens } : {}),
    }, options?.timeout_ms);
    const msg = data.choices?.[0]?.message ?? {};
    return {
      content: msg.content ?? "",
      tool_calls: (msg.tool_calls ?? []).map((tc: any) => ({ id: tc.id, name: tc.function?.name, arguments: safeJsonParse(tc.function?.arguments) })),
      usage: { prompt_tokens: data.usage?.prompt_tokens ?? 0, completion_tokens: data.usage?.completion_tokens ?? 0, total_tokens: data.usage?.total_tokens ?? 0 },
      model: data.model ?? model,
      latency_ms: Date.now() - started,
    };
  }

  async embed(text: string): Promise<number[]> {
    const data = await this.post("/embeddings", { model: this.cfg.models.TIER_3_EMBEDDING, input: text });
    return data.data?.[0]?.embedding ?? [];
  }
  // generate() and structuredOutput() are thin wrappers over chat() (JSON mode + schema instruction + parse/validate)
}
```

**Interface gap to close:** `LLMMessage` (`llm-provider.interface.ts:6-11`) has no `tool_calls` on assistant messages. OpenAI-compatible APIs require the assistant turn that issued a tool call to be sent back before its `tool` results. Add `tool_calls?: LLMToolCall[]` to `LLMMessage`, have `agent-runtime.ts` record it, and map it in `toWireMessage`.

**Step 2: `ModelRouter` (`model-router.ts:43-44`, `:100-107`).**
- Primary is `OpenAICompatibleProvider` when `LLM_BASE_URL` (or a tenant connector config) is present.
- `MockLLMProvider` is used only when `AI_DEMO_MODE=1`.
- The fallback is a second real provider, or none. Never silently the mock.
- Tier model names come from env (`LLM_MODEL_FAST`, `LLM_MODEL_REASONING`, `LLM_EMBEDDING_MODEL`), not the hard-coded `gemini-1.5-*`.

**Step 3:** every AI response includes `provider`. The UI shows a "Demo AI (offline)" badge when the provider is the mock (agents console, copilot, simulator).

**Step 4:** if the embedding model changes, dimensions change too. Re-index the knowledge base (`POST /ai/knowledge/[id]/reindex` exists) and recreate the Pinecone index when used.

**Step 5:** cost and usage tracking reads `usage` from real responses. `calculateCost` pricing moves to config.

### FX-33 · Fix broken endpoints and contracts
**Fixes:** M1, H11-b · **Effort:** M (1.0) · **Depends on:** FX-10

| # | Broken today | Fix |
|---|---|---|
| 1 | **Governance "EMERGENCY KILL SWITCH"** → `POST /api/v1/ai/tools/execute` (404) plus a false "halted" alert (`autonomous/governance/page.tsx:55-70`) | **Do first.** Call `POST /api/v1/autonomous/pause` with `{ scope: { level: "ALL" }, reason }` (route exists; FX-34 makes the halt effective). Alert only when `res.ok`; otherwise show the server error. |
| 2 | "Run Daily Autonomous Cycle" → same 404 plus a false success alert (`autonomous/page.tsx:92-98`) | Add `POST /api/v1/autonomous/cycles` (`AUTONOMOUS_EXECUTE`) calling `autonomousCyclesService.startDailyCycle(tenantId)` (exists, `autonomous-cycles.service.ts:11`) followed by `db.markDirty()`. Check `res.ok`. |
| 3 | Super-admin kill-switch deactivate (404) | FX-04 step 5 |
| 4 | Super-admin impersonation revoke (404) | FX-04 step 5 |
| 5 | Step-up contract (`mfaCode` vs `code`) | FX-02 / FX-04 / FX-15 |
| 6 | Advertised courier webhook URLs `/api/v1/shipments/webhooks/{steadfast,pathao,redx}` (`connectors/service.ts:474, 510, 538`) | Point at `/api/v1/automation/webhooks/{provider}?wh=<id>` (FX-06) |
| 7 | Advertised Meta and Telegram URLs `/api/v1/social/webhooks/{meta,telegram}` (`:319, 434`) | Meta → `/api/v1/social/webhooks/{facebook,instagram,whatsapp}`; Telegram → remove the provider or mark "not supported" |
| 8 | Shopify and report download URLs (`connectors/service.ts:1184`, `enterprise-reporting.service.ts:82`) | Implement `GET /api/v1/enterprise/reports/[id]/download` (CSV of the report result) or remove the link; remove the Shopify URL until an adapter exists |
| 9 | Dashboard link `/payments` (`(dashboard)/page.tsx:312`) | `/orders?payment_status=PENDING` (a Payments page is FX-39 / backlog) |

**Also:** every `fetch` that alerts success must check `res.ok` first. Known offenders:
- `autonomous/page.tsx:92-98`
- `autonomous/governance/page.tsx:60-66`
- `super-admin/page.tsx:345, 390`
- `SocialDashboard.tsx:63-69`: verify it reads the `healthy` flag.

FX-62's contract gate prevents regressions.

### FX-34 · Enforce safety controls and make impersonation real
**Fixes:** H11, DEAD #111, #113, #115 · **Effort:** M (2.5) · **Depends on:** FX-13, FX-15

**Step 1:** new `src/lib/safety-gate.ts`, wired to the helpers that already exist but are never called: `PlatformSafetyService.isExecutionBlocked` (`platform-safety.service.ts:122`) and `PlatformEntitlementService.can` (`platform-entitlement.service.ts:13`).
```ts
export function assertNotKilled(tenantId: string, scope: "TENANT" | "CHANNEL" | "WORKFLOW" | "PROVIDER", targetId = tenantId) {
  if (PlatformSafetyService.isExecutionBlocked("TENANT", tenantId) || PlatformSafetyService.isExecutionBlocked(scope, targetId)) {
    throw new KillSwitchActiveError(scope);
  }
}
export async function assertEntitled(tenantId: string, entitlementId: string, quantity = 1) {
  if (!(await PlatformEntitlementService.can(tenantId, entitlementId, quantity))) {
    throw new FeatureNotEntitledError(entitlementId);                    // errors.ts:124 — (entitlement, plan?)
  }
}
```

**Step 2: call sites.**
- `extractRequestContext` for non-GET methods: tenant scope.
- `campaignService.executeCampaign` and `OutboundMessageService.sendMessage`: CHANNEL scope.
- `n8n-provider` dispatch: WORKFLOW scope.
- `ModelRouter.chatWithRouting`: PROVIDER scope.
- Entitlements at: product create (`max_products`), user invite (`max_users`), channel connect (`max_channels`), AI run (`ai_monthly_runs`). Call `recordUsage` on success.

**Step 3: autonomous emergency halt.**
- `autonomous-control-plane.service.ts:111, 163` persists via `db.markDirty()`.
- Autonomous cycle, workflow and decision **execution** paths check `getSystemMode(tenantId) !== "EMERGENCY_HALTED"`, throwing `KillSwitchActiveError("AUTONOMOUS")`.

**Step 4: feature flags.** Add `PlatformFeatureFlagService.isEnabled(key, tenantId)`:
- global switch;
- tenant allow-list;
- percentage rollout via `sha256(tenantId + key) % 100 < percentage`.

Gate the experimental modules (`autonomous`, `enterprise`, `real_messaging`) with it.

**Step 5: impersonation that actually works.**
- `platform-support.service.ts:29-115` also sets an httpOnly cookie `commerceos_impersonation` (audience `TOKEN_AUDIENCE.impersonation`, 30 min).
- `extractRequestContext` accepts it:
  1. `verifyImpersonationToken`, currently unused at `security.ts:269`;
  2. the session record exists, isn't revoked and isn't expired;
  3. the context uses tenant = target and user = operator (flagged `impersonating: true`);
  4. permissions: READ_ONLY mode gets only `*.read` permissions; MUTATION_APPROVED gets the target user's role permissions.
  5. Every request writes a platform audit log entry.
- UI: a persistent banner "Viewing <tenant> as support (read-only) — End session".

### FX-35 · One writer for order status; reservations and numbering fixed
**Fixes:** H12, M2, M3 · **Effort:** M (2.0) · **Depends on:** FX-13

**Step 1:** new `src/domains/orders/order-lifecycle.service.ts`. It is the **only** caller of `db.updateOrderStatus`.
```ts
const FORWARD: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED"];
type Actor = { type: "USER" | "SYSTEM" | "COURIER"; id: string };

export class OrderLifecycleService {
  static advance(tenantId: string, orderId: string, target: OrderStatus, actor: Actor, reason: string): Order {
    const order = db.findOrderById(tenantId, orderId);
    if (!order) throw new NotFoundError("Order", orderId);
    for (const next of this.plan(order.status, target, actor)) {
      const current = db.findOrderById(tenantId, orderId)!.status;
      OrderStateMachine.assertTransition(current, next);
      this.sideEffects(tenantId, orderId, next, actor);            // reservations, COD payment
      db.updateOrderStatus(tenantId, orderId, next);
      db.recordEvent({ id: newId("evt"), type: `order.${next.toLowerCase()}`, version: "1.0", tenant_id: tenantId,
        aggregate_type: "order", aggregate_id: orderId, actor_id: actor.id, correlation_id: order.order_number,
        timestamp: new Date().toISOString(), payload: { from: current, to: next, reason, actor_type: actor.type } });
    }
    return db.findOrderById(tenantId, orderId)!;
  }

  /** Users move one legal step at a time; SYSTEM/COURIER actors may walk forward from PROCESSING onward. */
  private static plan(from: OrderStatus, to: OrderStatus, actor: Actor): OrderStatus[] {
    if (from === to) return [];
    if (OrderStateMachine.canTransition(from, to)) return [to];
    const i = FORWARD.indexOf(from), j = FORWARD.indexOf(to);
    if (actor.type !== "USER" && i >= FORWARD.indexOf("PROCESSING") && j > i) return FORWARD.slice(i + 1, j + 1);
    throw new ConflictError(`Order cannot move from ${from} to ${to}.`, { from, to });
  }

  private static sideEffects(tenantId: string, orderId: string, next: OrderStatus, actor: Actor) {
    const active = db.getReservationsForOrder(tenantId, orderId, "ACTIVE");      // new db helper
    if (next === "CANCELLED") active.forEach((r) => db.releaseReservation(tenantId, r.id));
    if (next === "SHIPPED" || next === "DELIVERED") active.forEach((r) => db.commitReservation(tenantId, r.id, actor.id));
    if (next === "DELIVERED") markCodPaidOnDelivery(tenantId, orderId, actor);   // new helper: logic moved from shipping.service.ts:178-185 / courier-sync.service.ts:166-172
  }
}
```

**Step 2:** replace the 12 direct status writers:
- `order.service.ts:255`
- `shipping.service.ts:120, 176`
- `courier-sync.service.ts:165`
- `order-operations.service.ts:89, 122`
- `returns-operations.service.ts:92`
- `return.service.ts:50, 84, 132`
- `order.repository.ts:200, 206` (dead)

Also:
- Delete the `(db as any).data.inventory_reservations` access in `order.service.ts:~240-262`.
- `createShipment` rejects orders that aren't PROCESSING or READY_TO_SHIP; a PROCESSING order advances to READY_TO_SHIP.
- A courier "delivered" event on a CANCELLED order becomes an operational exception, not a status change.

**Step 3: reservation expiry.** Add to `db/index.ts`. `"EXPIRED"` is already in the reservation status union.
```ts
public releaseExpiredReservations(now = Date.now()): number {
  let released = 0;
  for (const r of this.data.inventory_reservations) {
    if (r.status !== "ACTIVE" || Date.parse(r.expires_at) >= now) continue;
    const item = this.findInventoryItem(r.tenant_id, r.warehouse_id, r.product_variant_id);
    if (item) {
      item.quantity_reserved = Math.max(0, item.quantity_reserved - r.quantity);
      item.quantity_available = item.quantity_on_hand - item.quantity_reserved;
      item.updated_at = new Date().toISOString();
    }
    r.status = "EXPIRED";
    released++;
  }
  if (released) this.persist();
  return released;
}
```
Run it at boot and every 5 minutes (one server-only interval). Configurable policy: cancel PENDING orders whose reservations expired, through `OrderLifecycleService` with actor SYSTEM.

**Step 4: order numbers.** Keep a per-tenant counter `order_sequences[tenantId]`, incremented inside `db.createOrder` at insert time (synchronous, so atomic in one process). This replaces `generateOrderNumber` (`:4600-4604`), which ran before the `await`s (`order.service.ts:103-110`). Phase 4 swaps in a Postgres `SEQUENCE`.

**Step 5: quantity validation.** `pricing.service.ts:50` and `db.reserveStock` require `Number.isInteger(q) && q > 0`.

**Tests:**
- Delivered on a CANCELLED order returns 409 and an exception is recorded.
- A delivered order has `quantity_on_hand` decremented and its reservation COMMITTED.
- The expiry sweeper restores availability.
- 20 concurrent creates produce 20 unique order numbers.

### FX-36 · Data-entry correctness
**Fixes:** M5, M6, M11, M15, M16 · **Effort:** M (1.5)

- **M5:** `orders/page.tsx:165-166` gets division and district selects (reuse the lists in `customers/page.tsx:41-42, 324-347`), required when `OUTSIDE_DHAKA`. Mark existing outside-Dhaka orders stored as "Chittagong" with `address_confidence: "UNKNOWN"`, and exclude them from RTO geography.
- **M6:** `growth/audiences/page.tsx:9-40, 78` gets a rule per preset, using fields `audience.service.ts` supports:

  | Preset | Rule |
  |---|---|
  | VIP | `total_spend > 5000 AND order_count >= 3` |
  | Dormant 60D | `last_purchase_days_ago >= 60` |
  | Abandoned carts | `has_abandoned_cart = true` |
  | At-risk | `churn_risk_level = HIGH` |

- **M11:**
  - `TenantService.createTenant` (`tenants/service.ts:23-51`) creates a default warehouse.
  - Remove the `|| this.data.warehouses[0]` fallback (`db/index.ts:4156, 4191`); throw instead.
  - Run a one-off script that creates a warehouse for each tenant without one and repoints its inventory rows.
- **M15:** `identity-resolution.service.ts:124` stops generating `+8801700…` numbers.
  - Make `Customer.phone` optional for social-sourced customers (`phone_verified: false`).
  - Order creation still requires a phone.
  - Run a data fix that blanks fabricated numbers: customers created from social identities whose phone matches `^\+8801700\d{6}$` and whose notes say "Ingressed from".
- **M16:** the knowledge upload restricts the accepted types to `.txt,.md,.csv,.json` until a server-side parser route exists (`pdf-parse` / `mammoth` as new dependencies, parsing on the server with size limits). Remove the regex "PDF extraction" at `agents/page.tsx:394-405`.

### FX-37 · Invitations end-to-end
**Fixes:** wiring row #104 · **Effort:** M (1.0) · **Depends on:** FX-16

- New page `src/app/(auth)/invite/[token]/page.tsx`:
  1. `GET /api/v1/invitations/[token]` shows the workspace and role (route exists).
  2. A form with name and password posts to `POST /api/v1/invitations/[token]` (exists; expects `{ name, password }`).
  3. Redirect to `/login`.
- **Delivery:** interim, Settings shows "Copy invite link" once after creation. Later, an email provider sends it.

### FX-38 · Remove dead code and type errors so the build passes
**Fixes:** H15, wiring #118, #122 · **Effort:** S (0.25)

- Delete `src/domains/customers/customer.repository.ts` and `src/domains/social/social.repository.ts` (unused; 12 `tsc` errors). Remove their exports from `src/infrastructure/db/repositories.ts`. Phase 4 rebuilds repositories against the reconciled schema.
- Delete `src/components/bento/ModulePlaceholder.tsx`.
- Link `/ai/agents` from the AI console, or remove it.
- Remove the `/ai` duplicate (`ai/page.tsx` re-exports `/agents`), or keep it as a documented alias.
- **Verify:** `npm run type-check` shows 0 errors; **`npm run build` succeeds** (not verified in the audit); output is stored in the release notes.

### FX-39 · Make the Command Center truthful
**Fixes:** wiring rows #5-#14 · **Effort:** M (1.0) · **Depends on:** FX-30

The API already returns the needed fields: `pendingOrdersCount`, `pendingPaymentsCount`, `lowStockCount` and `recentOrders` (`db/index.ts:4864-4935`).

- **Needs Attention** (`page.tsx:286`): build from those counts. The link targets are `/orders?status=CONFIRMED`, `/orders?payment_status=PENDING` and `/inventory?low_stock_only=true`.
- **Recent orders** (`:394`): use `metrics.recentOrders`.
- **KPI fallbacks** (`:132-136`): remove; show "—" when a value is 0 or missing.
- **Trend pills:** show only when `previousPeriod` values are returned. Add them to `getDashboardMetrics` the same way as in FX-30.
- **Revenue chart** (`:766`): render `financials.time_series` from `/api/v1/analytics/financials`.
- **Channel donut:** real counts plus an "Unattributed" slice; remove the hard-coded conversion %.
- **City table:** keep order count and revenue; remove the literal returning %, reorder frequency, loyalty, growth and SLA columns.
- **Remove or feed from real endpoints:**
  - agent stream (`:360`, from `/api/v1/ai/runs?limit=5`);
  - intelligence pods (from `/api/v1/intelligence/overview` top items);
  - automation quick stats (from `/api/v1/automation/health`);
  - Operations & Stock box (from inventory metrics).

---

## 8. Phase 4 — Postgres (Neon) migration

### FX-40 · Architecture decision and a data-access boundary
**Effort:** M (1.0) · **Depends on:** D1

1. Record an ADR with `.agent/templates/adr.md`: "Postgres is the system of record; JSON store retired". Include the consequences: async services, transactions, one-time backfill.
2. Introduce async **store interfaces** per aggregate in `src/infrastructure/store/`, for example:
   ```ts
   export interface OrdersStore {
     findById(tenantId: string, id: string): Promise<Order | null>;
     list(tenantId: string, q: OrderQuery): Promise<{ rows: Order[]; total: number }>;
     createWithItems(order: Order, items: OrderItem[], reservations: ReservationInput[]): Promise<Order>;  // one transaction
     advanceStatus(tenantId: string, id: string, from: OrderStatus, to: OrderStatus): Promise<boolean>;    // optimistic: WHERE status = from
   }
   ```
   Each interface has two implementations: `Json*Store` (wraps today's `db`) and `Pg*Store`. Services depend on the interface. Select per domain with `DATA_BACKEND_<DOMAIN>=json|pg`.
3. **Async refactor:** services `await` store calls. Add ESLint (`next lint`) with `@typescript-eslint/no-floating-promises` (typed linting) to catch missed `await`s.

### FX-41 · Reconcile the schema with the domain model (migration 006)
**Effort:** L (3.0) · **Depends on:** FX-40

Neon's schema has drifted from the TypeScript domain types. For example, `customers` has `full_name, district, default_address, tags, is_blacklisted`, while `Customer` uses `first_name, last_name, status, source, addresses[]`.

1. Write `006_align_domain_model.sql`, generated from `src/types/commerce.ts`, `social.ts` and the platform types. Cover:
   - identity: tenants, users, memberships, invitations, audit_logs, service_tokens, platform tables;
   - catalog and inventory;
   - customers and addresses;
   - orders, order_items, payments, shipments, returns, refunds, coupons, order_sequences;
   - social: channels, identities, conversations, messages, leads;
   - automation.
2. **Constraints:**
   - `UNIQUE (tenant_id, sku)`
   - `UNIQUE (tenant_id, order_number)`
   - `UNIQUE (tenant_id, provider, transaction_id)` on payments
   - `CHECK (quantity_on_hand >= 0 AND quantity_reserved >= 0)`
   - composite foreign keys that include `tenant_id`
3. **Indexes:** `(tenant_id, created_at DESC)` on large tables; `(tenant_id, status)`; `(tenant_id, phone)`; `(tenant_id, customer_id)`.
4. **Migration runner:** `migrate.ts:76-87` splits files on `;` at line end, which breaks on functions. Run each file as one statement batch through the pooled client, or adopt a small runner.

### FX-42 · Core domains on Postgres, with real transactions
**Effort:** L (8-12) · **Depends on:** FX-41, FX-35, FX-22

1. **Fix `withTransaction`** (`neon/client.ts:127-157`, M8). Connection errors propagate; there's no silent HTTP re-run of a rolled-back transaction.
   ```ts
   export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
     const client = await getPool().connect();
     try {
       await client.query("BEGIN");
       const result = await fn(client);
       await client.query("COMMIT");
       return result;
     } catch (err) {
       await client.query("ROLLBACK").catch(() => {});
       throw err;
     } finally {
       client.release();
     }
   }
   ```
   Also fix `execute()` (`:111`): use the pooled client's `rowCount` for writes.
2. **Migration order** (each step is its own flag flip):
   1. identity (tenants, users, memberships, invitations, audit, service tokens);
   2. catalog and inventory;
   3. customers;
   4. orders, payments, shipments, returns, refunds, coupons;
   5. social inbox;
   6. automation.
3. **Oversell-safe reservation** without row locks. Zero rows updated means insufficient stock, so roll back:
   ```sql
   UPDATE inventory_items
      SET quantity_reserved = quantity_reserved + $3, updated_at = now()
    WHERE tenant_id = $1 AND id = $2 AND quantity_on_hand - quantity_reserved >= $3
   RETURNING quantity_on_hand - quantity_reserved AS available;
   ```
4. **Order numbers:** `INSERT … ON CONFLICT (tenant_id) DO UPDATE SET value = order_sequences.value + 1 RETURNING value` on `order_sequences`, inside the order transaction.
5. **Rebuild** the Neon repositories deleted in FX-38 against the reconciled schema. Column names come from an allow-list per repository (fixes L5).

### FX-43 · Backfill, verification, cutover
**Effort:** M (2-3) · **Depends on:** FX-42

1. `scripts/migrate-json-to-pg.ts`: per collection, batched multi-row `INSERT … ON CONFLICT DO NOTHING` (1,000 rows per batch), inside one transaction per table.
2. `scripts/verify-migration.ts`:
   - per-tenant row counts per table;
   - `SUM(grand_total)` of orders;
   - `SUM(quantity_on_hand)` of inventory;
   - deep equality of 100 random rows per table.

   Output a PASS/FAIL report.
3. **Rehearse** on a Neon branch or a restored `pg_dump`. Time the backfill.
4. **Cutover:**
   1. Enable a read-only maintenance flag (FX-34 feature flag).
   2. Run the final backfill.
   3. Run verification; it must PASS.
   4. Flip `DATA_BACKEND_*=pg`.
   5. Run the smoke tests (FX-65).
   6. Remove the maintenance flag.
   7. Keep the JSON file read-only for 7 days as a rollback source.

### FX-44 · Document store for the remaining ~100 collections
**Effort:** M (3-4) · **Depends on:** FX-42

Growth, intelligence, operations, enterprise, autonomous and platform-config collections are low-write and document-shaped. Put them in Postgres as JSONB now and normalize only when queries need it.
```sql
CREATE TABLE IF NOT EXISTS documents (
  collection  text        NOT NULL,
  id          text        NOT NULL,
  tenant_id   text,                          -- NULL for platform-scope documents
  data        jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS documents_tenant_idx ON documents (tenant_id, collection, updated_at DESC);
```
A generic `DocumentStore<T>` provides `get(tenantId, id)`, `list(tenantId, filter?)`, `upsert(tenantId, doc)`, `upsertMany(...)` and `delete(...)`. Tenant scoping is built in, which finishes FX-13 structurally.

### FX-45 · Retire the JSON store; enable multiple replicas
**Effort:** M (1-2) · **Depends on:** FX-43, FX-44

- Remove persistence from `db/index.ts`. Keep the demo seed as an SQL or TypeScript seeder behind `SEED_DEMO_DATA=1`.
- `/health/ready` checks Postgres (with a timeout).
- Move in-process state to shared storage before running more than one replica:
  - rate limiter → Upstash;
  - marketing kill switch → DB;
  - circuit breakers → Redis or DB;
  - intelligence snapshot cache → DB.
- Remove the single-writer lock (FX-24). Run a soak test with 2 replicas (k6, 30 min): no lost writes, consistent reads.

---

## 9. Phase 5 — Real integrations (scope set by D2/D5)

> Provider endpoints, auth flows and payload formats **must be taken from each provider's current official documentation** at implementation time. This plan names the work, not the exact API calls.

| Item | Scope | Key tasks | Effort |
|---|---|---|---|
| **FX-50** Messaging (WhatsApp Cloud first, then Messenger / Instagram) | Replace the FX-31 `IntegrationNotConfiguredError` stubs | Per-channel credential capture and validation; send text/media/template; delivery and read status webhooks updating `messages.status`; 24-hour-window and template rules; retries with idempotency keys; per-channel rate limits (existing `rate-limiter.ts`) | M-L per channel |
| **FX-51** Courier booking (one courier first) | Replace manual booking | Merchant credentials; create consignment → real tracking number; status webhooks through FX-06 → `OrderLifecycleService` (FX-35); label/invoice download; COD settlement import | M-L |
| **FX-52** MFS payment verification (bKash or Nagad first) | Strengthen FX-11 | Query or verify the transaction with the provider; match amount, currency and payer; record `verification_method: "GATEWAY"`; reconciliation job; sandbox tests | M-L |
| **FX-53** Connector live tests | Beyond FX-31's OpenAI-compatible ping | Real lightweight read call per provider (auth check only), 5 s timeout, no secrets in logs | S per provider |
| **FX-54** Enterprise integrations and outbound webhooks | Remove "Simulated" badges | Real HTTP delivery with HMAC signature header, timeout, exponential retry, DLQ; **SSRF guard** (resolve DNS, block private, loopback and link-local ranges, allow only http/https, no redirects to private IPs) | M |
| **FX-55** n8n | Local and remote | After FX-31, local Docker n8n (`n8n/docker-compose.yml`) is called for real; callbacks use service tokens (FX-18); the same SSRF guard applies to `base_url` (M17) | S |

---

## 10. Phase 6 — Tests, CI & documentation

| Item | What | Effort |
|---|---|---|
| **FX-60** Security regression suite | New `tests/security-regression-tests.ts`: C1/C8 passwords; C2 old-secret and audience confusion; C3 header ignored; H1 invalid token → 401; C4 webhook without or with a wrong token; H5 unsigned Meta payload ignored; H4 mass assignment; H13 IDOR (digests, approvals); H10 TOTP vector and step-up. Add it to `tests/full-system-test.cjs` and the `npm test` script. Test code in the report §6. | M (1.0) |
| **FX-61** RBAC matrix test | Table-driven over Appendix A: SUPPORT token → 403, ADMIN token → 2xx or domain error, for every mutating handler. Import route handlers directly (`POST(new Request(...), { params })`). | S (0.5) |
| **FX-62** Contract gate | Port the audit's route cross-check to `scripts/check-api-contracts.ts`. It fails when any client `fetch('/api/v1/…')` or server-advertised URL has no matching route file or HTTP method. Run it in `verify`. | S (0.5) |
| **FX-63** Load test | `tests/load/k6-mixed.js`: 20 VUs for 5 min, 70% `GET /api/v1/orders?limit=20`, 30% `POST /api/v1/auth/login`. Thresholds: `http_req_duration p(95)<500`, `max<2000`, `http_req_failed rate<0.01`. Run after FX-20 and again after FX-45. | S (0.5) |
| **FX-64** `npm run verify` | `type-check` + `lint` (ESLint with `no-floating-promises`) + `test` + `check-api-contracts` + the FX-30 grep gate. Required before merge; add a CI workflow once the repo has a remote. | M (1.0) |
| **FX-65** Smoke scripts | `scripts/smoke-security.mjs` automates the 12 exploit replays in §11 against `BASE_URL`. `scripts/smoke-get-sweep.mjs` runs every UI GET, asserting 200, < 2 s warm, and no data-file mtime change (FX-21). | S (0.5) |
| **FX-66** Docs | Replace the claims in `SYSTEM_AUDIT_REPORT.md` and `.agent/PROJECT_STATE.md` with the real status (link this plan and the audit). Document env vars (Appendix C), the single-replica constraint (until FX-45), and demo-mode labels. | S (0.5) |

---

## 11. Verification matrix — re-run of the audit's runtime checks

| # | Check (from the audit's runtime session) | Before (2026-09-27) | After | Fixed by |
|---|---|---|---|---|
| 1 | Login as a fresh user with `Password123!` | **200** | 401 | FX-02 |
| 2 | Platform login with any password (C8) | **200** (by code) | 401 | FX-02 |
| 3 | Tenant JWT forged with the public default secret | **200** | 401 | FX-03 |
| 4 | Platform JWT forged for a tenant owner | **200 SUPER_ADMIN** | 401 | FX-03 |
| 5 | `x-test-platform-role` header, no token | **200 (role granted)** | 401 | FX-04 |
| 6 | No cookie / garbage token on tenant API (dev) | **200 OWNER** | 401 (unless `DEV_AUTH_BYPASS=1`) | FX-05 |
| 7 | Step-up `{code:"zzzzzz"}` | **200** | 401 | FX-02 / FX-15 |
| 8 | UI step-up payload | **401 (contract)** | 200 with valid password / TOTP | FX-04 |
| 9 | Unsigned `POST /automation/webhooks/steadfast` | **200 verified:true** | 401 | FX-06 |
| 10 | `/analytics/channels?preset=TODAY` with 0 orders | **198 orders / ৳425,600** | 0 / ৳0 | FX-30 |
| 11 | Connector test with a fake OpenAI key | **success:true** | success:false (401 from provider) | FX-31 |
| 12 | UI-called endpoints that 404 (5 checked) | **404** | 200 / removed | FX-04, FX-33 |
| 13 | 3 concurrent logins + unrelated read | **2.9-8.5 s / 8.6 s** | < 300 ms / < 150 ms | FX-20 |
| 14 | `/intelligence/opportunities` cold | **405 s** | < 2 s, no writes | FX-21, FX-22 |
| 15 | `/intelligence/customers` rows | **50 of 10,001** | 10,001 | FX-22 |
| 16 | GET sweep changes the data file | **Yes (+118 KB)** | No | FX-21 |
| 17 | `npm run type-check` | **12 errors** | 0 | FX-38 |

---

## 12. Rollout, rollback & risk register

**Rollout rules:**
- One commit per FX item (after FX-00). One tag per phase.
- Back up `.data/commerceos.json` (copy plus SHA-256) before any script that writes it: FX-02, FX-03, FX-35, FX-36 and FX-43.
- Behaviour changes that users will notice ship with a short release note:
  - forced re-login after FX-03;
  - fewer menu items per role after FX-10;
  - "Not delivered" states after FX-31;
  - numbers changing after FX-22 and FX-30.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Seeded accounts locked out when the backdoor is removed | High | Medium | FX-02 step 5 runs **before** step 1; documented in the release note |
| Key rotation breaks stored channel/connector credentials | High | Medium | FX-03 re-encryption script, dry-run mode first, list of `NEEDS_CREDENTIALS` records |
| RBAC removes access someone relied on | Medium | Medium | Role review (FX-10 step 7); 403 UI states; quick role adjustments in Settings |
| Debounced persistence loses ≤ 250 ms of writes on crash | Low | Low-Medium | Documented; SIGTERM flush; Phase 4 removes it |
| Analytics numbers change sharply after the truncation and fabrication fixes | Certain | Medium (perception) | Before/after table in the release note; the new numbers are the correct ones |
| Async refactor in Phase 4 introduces missed `await`s | Medium | High | `no-floating-promises` lint; store interfaces; per-domain flags; verification script |
| Backfill mismatch | Low | High | Rehearsal on a Neon branch; PASS required before cutover; JSON kept read-only 7 days |
| Provider API assumptions wrong in Phase 5 | Medium | Medium | Build strictly from current provider docs; sandbox-first; feature-flagged rollout |

---

## Appendix A — RBAC map for the 108 unguarded route files (141 handlers)

Generated from the code on 2026-09-27: every handler in `autonomous/`, `enterprise/`, `growth/`, `intelligence/`, `marketing/` and `operations/` that has no permission check today.

The other domains (catalog, customers, orders, payments, shipments, social, knowledge, analytics, connectors, inventory, users, tenants, automation, ai) already check permissions inside their services and are excluded. Payments verify is changed separately in FX-11.

| Route (`/api/v1/…`) | Method | Required permission | Also fix |
|---|---|---|---|
| `autonomous/cost` | GET | `AUTONOMOUS_READ` |  |
| `autonomous/decisions` | GET | `DECISIONS_READ` |  |
| `autonomous/decisions/[id]` | GET | `DECISIONS_READ` |  |
| `autonomous/decisions/[id]/approve` | POST | `DECISIONS_APPROVE` | approver from body → `context.user.id` |
| `autonomous/decisions/[id]/reject` | POST | `DECISIONS_APPROVE` |  |
| `autonomous/health` | GET | `AUTONOMOUS_READ` |  |
| `autonomous/learning` | GET | `LEARNING_READ` |  |
| `autonomous/objectives` | GET | `OBJECTIVES_READ` |  |
| `autonomous/objectives` | POST | `OBJECTIVES_MANAGE` |  |
| `autonomous/objectives/[id]` | GET | `OBJECTIVES_READ` |  |
| `autonomous/objectives/[id]/simulate` | POST | `STRATEGY_MANAGE` |  |
| `autonomous/overview` | GET | `AUTONOMOUS_READ` |  |
| `autonomous/pause` | POST | `AUTONOMOUS_MANAGE` |  |
| `autonomous/resume` | POST | `AUTONOMOUS_MANAGE` |  |
| `autonomous/strategies` | GET | `STRATEGY_READ` |  |
| `enterprise/ai-governance` | GET | `GOVERNANCE_READ` |  |
| `enterprise/ai-governance` | POST | `GOVERNANCE_MANAGE` |  |
| `enterprise/analytics` | GET | `ENTERPRISE_READ` |  |
| `enterprise/benchmarks` | GET | `BENCHMARKS_READ` |  |
| `enterprise/brands` | GET | `BRAND_READ` |  |
| `enterprise/brands` | POST | `BRAND_MANAGE` |  |
| `enterprise/business-units` | GET | `BUSINESS_UNIT_READ` |  |
| `enterprise/business-units` | POST | `BUSINESS_UNIT_MANAGE` |  |
| `enterprise/data-lineage` | GET | `DATA_LINEAGE_READ` |  |
| `enterprise/data-quality` | GET | `DATA_QUALITY_READ` |  |
| `enterprise/developer` | GET | `DEVELOPER_READ` |  |
| `enterprise/developer` | POST | `DEVELOPER_MANAGE` |  |
| `enterprise/governance` | GET | `GOVERNANCE_READ` | GET seeds data → move to setup (FX-21) |
| `enterprise/incidents` | GET | `INCIDENTS_READ` |  |
| `enterprise/incidents` | POST | `INCIDENTS_MANAGE` |  |
| `enterprise/integrations` | GET | `INTEGRATIONS_READ` | GET seeds data → move to setup (FX-21) |
| `enterprise/integrations` | POST | `INTEGRATIONS_MANAGE` |  |
| `enterprise/integrations/[id]/sync` | POST | `INTEGRATIONS_SYNC` | tenant-scope lookup (FX-13) |
| `enterprise/integrations/[id]/test` | POST | `INTEGRATIONS_MANAGE` | tenant-scope lookup (FX-13) |
| `enterprise/metrics` | GET | `METRICS_READ` | GET seeds data → move to setup (FX-21) |
| `enterprise/metrics` | POST | `METRICS_MANAGE` |  |
| `enterprise/organizations` | GET | `ORGANIZATION_READ` |  |
| `enterprise/organizations` | POST | `ORGANIZATION_MANAGE` |  |
| `enterprise/overview` | GET | `ENTERPRISE_READ` | `organization_id` must belong to the tenant |
| `enterprise/reports` | GET | `EXPORTS_READ` |  |
| `enterprise/reports` | POST | `EXPORTS_CREATE` |  |
| `enterprise/stores` | GET | `STORE_READ` |  |
| `enterprise/stores` | POST | `STORE_MANAGE` |  |
| `enterprise/webhooks` | GET | `DEVELOPER_READ` |  |
| `enterprise/webhooks` | POST | `DEVELOPER_MANAGE` | SSRF guard on `target_url` (FX-54) |
| `growth/attribution` | GET | `MARKETING_READ` |  |
| `growth/audiences` | GET | `MARKETING_READ` |  |
| `growth/audiences` | POST | `MARKETING_WRITE` |  |
| `growth/audiences/[id]` | GET | `MARKETING_READ` |  |
| `growth/audiences/[id]` | PUT | `MARKETING_WRITE` | strict schema (FX-12) |
| `growth/audiences/[id]/refresh` | POST | `MARKETING_WRITE` |  |
| `growth/campaigns` | GET | `MARKETING_READ` |  |
| `growth/campaigns` | POST | `MARKETING_WRITE` |  |
| `growth/campaigns/[id]` | GET | `MARKETING_READ` |  |
| `growth/campaigns/[id]` | PUT | `MARKETING_WRITE` | strict schema (FX-12) |
| `growth/campaigns/[id]/approve` | POST | `MARKETING_APPROVE` (new) | approver from body → `context.user.id`; four-eyes |
| `growth/campaigns/[id]/execute` | POST | `MARKETING_WRITE` | kill-switch gate (FX-34) |
| `growth/campaigns/[id]/pause` | POST | `MARKETING_WRITE` |  |
| `growth/campaigns/[id]/reject` | POST | `MARKETING_APPROVE` (new) | rejecter from body → `context.user.id` |
| `growth/campaigns/[id]/resume` | POST | `MARKETING_WRITE` |  |
| `growth/campaigns/[id]/schedule` | POST | `MARKETING_WRITE` | guard `request.json()` |
| `growth/campaigns/[id]/simulate` | POST | `MARKETING_READ` |  |
| `growth/content/generate` | POST | `MARKETING_WRITE` | rate limit (FX-14) |
| `growth/content/verify` | POST | `MARKETING_WRITE` |  |
| `growth/experiments` | GET | `MARKETING_READ` |  |
| `growth/experiments` | POST | `MARKETING_WRITE` |  |
| `growth/experiments/[id]/evaluate` | POST | `MARKETING_WRITE` |  |
| `growth/insights` | GET | `MARKETING_READ` |  |
| `growth/journeys` | GET | `MARKETING_READ` |  |
| `growth/journeys` | POST | `MARKETING_WRITE` |  |
| `growth/journeys/[id]` | GET | `MARKETING_READ` |  |
| `growth/journeys/[id]` | PUT | `MARKETING_WRITE` | strict schema (FX-12) |
| `growth/journeys/[id]/pause` | POST | `MARKETING_WRITE` |  |
| `growth/journeys/[id]/resume` | POST | `MARKETING_WRITE` |  |
| `growth/lifecycle` | GET | `MARKETING_READ` |  |
| `growth/lifecycle/[customerId]` | GET | `MARKETING_READ` |  |
| `growth/offers` | GET | `MARKETING_READ` |  |
| `growth/offers` | POST | `MARKETING_WRITE` |  |
| `growth/overview` | GET | `MARKETING_READ` |  |
| `growth/preferences/[customerId]` | GET | `MARKETING_READ` |  |
| `growth/preferences/[customerId]` | POST | `MARKETING_WRITE` |  |
| `growth/recommendations` | GET | `MARKETING_READ` |  |
| `intelligence/anomalies` | GET | `ANALYTICS_READ` | pure GET (FX-21) |
| `intelligence/cohorts` | GET | `ANALYTICS_READ` |  |
| `intelligence/customers` | GET | `ANALYTICS_READ` | pure GET (FX-21) |
| `intelligence/data-quality` | GET | `ANALYTICS_READ` |  |
| `intelligence/forecasts` | POST | `ANALYTICS_READ` |  |
| `intelligence/metrics` | GET | `ANALYTICS_READ` |  |
| `intelligence/models` | GET | `ANALYTICS_READ` |  |
| `intelligence/nl-query` | POST | `ANALYTICS_READ` | rate limit (FX-14) |
| `intelligence/opportunities` | GET | `ANALYTICS_READ` | pure GET (FX-21) |
| `intelligence/overview` | GET | `ANALYTICS_READ` | pure GET (FX-21) |
| `intelligence/query` | POST | `ANALYTICS_READ` |  |
| `intelligence/recommendations` | GET | `ANALYTICS_READ` | pure GET (FX-21) |
| `intelligence/recommendations/[id]/propose-decision` | POST | `OPERATIONS_EXECUTE` | tenant-scope lookup (FX-13) |
| `intelligence/risks` | GET | `ANALYTICS_READ` | pure GET (FX-21) |
| `intelligence/simulations` | POST | `ANALYTICS_READ` |  |
| `marketing/abandoned-carts` | GET | `MARKETING_READ` |  |
| `marketing/abandoned-carts` | POST | `MARKETING_WRITE` |  |
| `marketing/abandoned-carts/[id]/nudge` | POST | `MARKETING_WRITE` | honest send (FX-31) |
| `marketing/abandoned-carts/[id]/recover` | POST | `MARKETING_WRITE` |  |
| `marketing/attribution` | GET | `MARKETING_READ` |  |
| `marketing/audiences` | GET | `MARKETING_READ` |  |
| `marketing/audiences` | POST | `MARKETING_WRITE` |  |
| `marketing/audiences/[id]/members` | GET | `MARKETING_READ` |  |
| `marketing/broadcasts` | GET | `MARKETING_READ` |  |
| `marketing/broadcasts` | POST | `MARKETING_WRITE` |  |
| `marketing/broadcasts/[id]/approve` | POST | `MARKETING_APPROVE` (new) | four-eyes |
| `marketing/broadcasts/[id]/dispatch` | POST | `MARKETING_WRITE` | kill-switch gate (FX-34) |
| `marketing/broadcasts/[id]/reject` | POST | `MARKETING_APPROVE` (new) |  |
| `marketing/broadcasts/[id]/simulate` | POST | `MARKETING_READ` |  |
| `marketing/broadcasts/kill-switch` | POST | `MARKETING_APPROVE` (new) | persist state (FX-34/FX-45) |
| `marketing/overview` | GET | `MARKETING_READ` |  |
| `operations/actions` | GET | `OPERATIONS_READ` |  |
| `operations/actions/[id]/approve` | POST | `OPERATIONS_APPROVE` |  |
| `operations/actions/[id]/simulate` | POST | `OPERATIONS_READ` |  |
| `operations/autonomy` | GET | `OPERATIONS_READ` |  |
| `operations/autonomy` | PUT | `OPERATIONS_APPROVE` | strict schema (FX-12) |
| `operations/autonomy/kill-switch` | POST | `OPERATIONS_APPROVE` |  |
| `operations/digital-twin` | GET | `OPERATIONS_READ` |  |
| `operations/exceptions` | GET | `EXCEPTIONS_READ` |  |
| `operations/exceptions` | POST | `EXCEPTIONS_MANAGE` |  |
| `operations/exceptions/[id]/resolve` | POST | `EXCEPTIONS_MANAGE` | tenant-scope update (FX-13) |
| `operations/finance` | GET | `FINANCE_READ` |  |
| `operations/finance` | POST | `OPERATIONS_EXECUTE` |  |
| `operations/fulfillment` | GET | `OPERATIONS_READ` | truncation fix (FX-22) |
| `operations/fulfillment` | POST | `OPERATIONS_EXECUTE` |  |
| `operations/inventory` | GET | `OPERATIONS_READ` |  |
| `operations/overview` | GET | `OPERATIONS_READ` |  |
| `operations/payments` | GET | `FINANCE_READ` |  |
| `operations/payments` | POST | `PAYMENTS_VERIFY` (new) |  |
| `operations/pricing` | GET | `PRICING_READ` |  |
| `operations/pricing` | POST | `PRICING_MANAGE` |  |
| `operations/procurement` | GET | `PROCUREMENT_READ` |  |
| `operations/procurement` | POST | `PROCUREMENT_MANAGE` |  |
| `operations/providers` | GET | `OPERATIONS_READ` |  |
| `operations/providers` | POST | **remove from public API** | clients can forge provider health today |
| `operations/receipts` | GET | `OPERATIONS_READ` |  |
| `operations/sla` | GET | `OPERATIONS_READ` |  |
| `operations/tasks` | GET | `OPERATIONS_READ` |  |
| `operations/tasks` | POST | `OPERATIONS_EXECUTE` |  |

**New permissions:**

| Permission | Granted to |
|---|---|
| `PAYMENTS_VERIFY` | OWNER (automatic), ADMIN, FINANCE |
| `MARKETING_APPROVE` | OWNER, ADMIN |
| `ANALYTICS_MANAGE` | OWNER, ADMIN |

Also add `notifications.send` (service-token scope, FX-18).

---

## Appendix B — The 46 call sites truncated to 50 rows (FX-22)

`O` = `db.getOrders(tenantId)`, `C` = `db.getCustomers(tenantId)`, both without options, so silently limited to 50.

| Area | Call sites |
|---|---|
| **Route** | `src/app/api/v1/operations/fulfillment/route.ts:10` O |
| **Enterprise (7)** | `accounting-adapter.service.ts:29` O · `data-quality.service.ts:17` O · `enterprise-analytics.service.ts:42` O · `enterprise-benchmarking.service.ts:26` O · `enterprise-finance.service.ts:63` O · `enterprise-operations.service.ts:32` O · `semantic-metrics.service.ts:162` O |
| **Growth (10)** | `audience.service.ts:143` C, `:144` O · `campaign.service.ts:352` C · `customer-lifecycle.service.ts:71` O, `:144` C, `:145` O · `growth-intelligence.service.ts:26` O · `offer.service.ts:29` O · `product-recommendation.service.ts:19` O, `:159` O |
| **Intelligence (15)** | `analytics-query.service.ts:34` O, `:35` C · `anomaly-detector.service.ts:17` O · `cohort-analysis.service.ts:14` O · `customer-intelligence.service.ts:14` C, `:15` O · `data-quality.service.ts:14` O, `:15` C · `forecasting.service.ts:28` O · `inventory-intelligence.service.ts:17` O · `opportunity-detector.service.ts:94` C · `payment-intelligence.service.ts:33` O · `product-intelligence.service.ts:16` O · `sales-intelligence.service.ts:39` O · `simulation.service.ts:25` O |
| **Marketing (8)** | `marketing.service.ts:79` C, `:187` O, `:296` O, `:330` C, `:331` O, `:395` C, `:396` O, `:600` O |
| **Operations (5)** | `finance-operations.service.ts:21` O · `inventory-operations.service.ts:45` O · `operational-sla.service.ts:19` O · `operational-twin.service.ts:18` O · `order-operations.service.ts:29` O |

---

## Appendix C — Environment variables (new or changed)

| Variable | Phase | Required | Purpose |
|---|---|---|---|
| `JWT_SECRET` | 0 | yes | New random value (≥ 32 chars, not the default); refuses to start otherwise |
| `CREDENTIALS_ENCRYPTION_KEY` | 0 | yes | Separate key for stored credentials (≥ 32 chars) |
| `OLD_JWT_SECRET` | 0 | one-time | Only for `rotate-credential-key.ts`; remove afterwards |
| `SEED_DEMO_DATA` | 0 | no | `1` enables demo tenant, users and seed fixtures |
| `SEED_ADMIN_PASSWORD` | 0 | with demo | Password for seeded accounts (≥ 14 chars) |
| `DEV_AUTH_BYPASS` | 0 | no | `1` + `NODE_ENV=development` enables the dev OWNER fallback for requests with **no** token |
| `STEADFAST_WEBHOOK_SECRET`, `PATHAO_WEBHOOK_SECRET`, `BKASH_WEBHOOK_SECRET`, `NAGAD_WEBHOOK_SECRET` | 0 | per provider | Webhook tokens / HMAC secrets (≥ 24 chars) |
| `META_APP_SECRET`, `META_VERIFY_TOKEN` | 0 | for Meta webhooks | No literal fallbacks any more |
| `TRUST_PROXY` | 1 | behind proxy | Trust `X-Forwarded-For` for rate-limit keys |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | 1/4 | multi-replica | Shared rate limiting and state |
| `PERSIST_DEBOUNCE_MS` | 2 | no | Default 250 |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_FAST`, `LLM_MODEL_REASONING`, `LLM_EMBEDDING_MODEL` | 3 | for real AI | OpenAI-compatible provider |
| `AI_DEMO_MODE` | 3 | no | `1` allows the mock LLM, and the UI labels it |
| `N8N_DRY_RUN` | 3 | tests | Replaces the localhost mock branch |
| `DATA_BACKEND_<DOMAIN>` | 4 | during migration | `json` or `pg` per domain |

---

## Appendix D — Files touched per phase (summary)

- **Phase 0:**
  - `.gitignore` (new), `.env.example`
  - `src/lib/security.ts`, `src/lib/api-response.ts`
  - `src/app/api/v1/platform/auth/{login,step-up,logout}/route.ts`
  - `src/app/super-admin/page.tsx`, `src/app/super-admin/login/page.tsx` (new)
  - `src/app/api/v1/automation/webhooks/[provider]/route.ts`, `src/domains/automation/services/webhook-gateway.service.ts`
  - `src/domains/social/webhooks/webhook-ingress.service.ts`, `src/domains/social/channels/{channel.service.ts, adapters/*}`
  - `src/app/api/v1/social/webhooks/*/route.ts`, `src/app/api/v1/social/widget/message/route.ts`
  - `src/infrastructure/db/index.ts` (seeds)
  - `scripts/reset-seed-passwords.ts`, `scripts/rotate-credential-key.ts` (new)
- **Phase 1:**
  - `src/lib/permissions.ts`, `src/lib/rate-limit.ts`, `src/lib/totp.ts`, `src/lib/validation.ts` (new)
  - the 108 route files in Appendix A
  - `payment.service.ts`, `product.service.ts`, `customer.service.ts` and schema files
  - `db/index.ts` (scoped accessors, field stripping)
  - `auth/service.ts`, `auth/logout/route.ts`
  - platform MFA routes (new)
  - `next.config.js`, `task-executor.ts`
  - navigation components
- **Phase 2:**
  - `db/index.ts` (persistence, `getAll*`, batch upserts, lock)
  - 18 direct-mutation service files
  - intelligence, growth and autonomy-policy services
  - the 46 call sites in Appendix B
  - `app/health/ready/route.ts`, the intelligence recompute route (new)
- **Phase 3:**
  - `analytics.service.ts`, `types/analytics.ts`
  - `campaign.service.ts`, `marketing.service.ts`
  - dashboard, super-admin, autonomous and governance pages
  - `errors.ts`, `outbound-message.service.ts`, marketing and social adapters
  - `shipping.service.ts`, `courier-sync.service.ts`, `order-lifecycle.service.ts` (new)
  - `connectors/service.ts`, `n8n-provider.service.ts`, `model-router.ts`, `openai-compatible.provider.ts` (new)
  - `safety-gate.ts` (new), `platform-support.service.ts`
  - orders, customers and audiences pages, `identity-resolution.service.ts`
  - `invite/[token]/page.tsx` (new)
  - deletions from FX-38
- **Phase 4:**
  - `src/infrastructure/store/*` (new), `neon/client.ts`
  - `migrations/006_*.sql`, `migrate.ts`
  - rebuilt repositories
  - `scripts/migrate-json-to-pg.ts`, `scripts/verify-migration.ts` (new)
- **Phase 6:**
  - `tests/security-regression-tests.ts`, `tests/rbac-matrix-tests.ts`, `tests/load/k6-mixed.js`
  - `scripts/check-api-contracts.ts`, `scripts/smoke-*.mjs`
  - `package.json` scripts, ESLint config, docs
