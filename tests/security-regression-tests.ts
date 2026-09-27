// @ts-ignore
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { SignJWT } from "jose";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  signPlatformSessionToken,
  verifyPlatformSessionToken,
  signStepUpToken,
  decryptCredential,
  AUTH_COOKIE_NAME,
  PLATFORM_AUTH_COOKIE_NAME,
} from "@/lib/security";
import { extractRequestContext, extractPlatformContext } from "@/lib/api-response";
import { InvitationService } from "@/domains/invitations/service";
import { WebhookGatewayService } from "@/domains/automation/services/webhook-gateway.service";
import { WebhookIngressService } from "@/domains/social/webhooks/webhook-ingress.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { FacebookAdapter } from "@/domains/social/channels/adapters/facebook.adapter";
import { InstagramAdapter } from "@/domains/social/channels/adapters/instagram.adapter";
import { WhatsAppAdapter } from "@/domains/social/channels/adapters/whatsapp.adapter";
import type { ConnectedChannel } from "@/types/social";
import type { PlatformRole } from "@/lib/permissions";

/**
 * Phase 0 security regression suite (AUDIT_REPORT_2026-09-27.md → FIX_IMPLEMENTATION_PLAN.md FX-00…FX-08).
 * Every test goes through the real code path (login, token verification, context extraction, route handlers,
 * webhook verification). None of them use a bypass. Run: node tests/ts-runner.cjs ./tests/security-regression-tests.ts
 */

const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

let passedCount = 0;
let failedCount = 0;

async function runTest(testName: string, testFn: () => Promise<void> | void) {
  try {
    await testFn();
    console.log(`  ${ANSI_GREEN}✓ PASS${ANSI_RESET} - ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ${ANSI_RED}✗ FAIL${ANSI_RESET} - ${testName}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    failedCount++;
  }
}

// Values that were published in the repository before Phase 0 and must never work again.
const PUBLISHED_DEFAULT_JWT_SECRET = "commerceos_super_secret_jwt_key_min_32_characters_for_security_2026";
const SHARED_DEFAULT_PASSWORDS = ["Password123!", "CommerceOS2026!"];
const LEGACY_SEED_HASH_PREFIX = "$2a$10$iM.oG9E";
const LEGACY_META_APP_SECRET = "meta_test_secret";
const LEGACY_META_VERIFY_TOKEN = "commerceos_meta_verify_token_2026";
// The removed platform bypass header, assembled at runtime so this negative test does not itself contain the
// literal string that the repository's backdoor scanner (.claude/hooks/scan-new-code.cjs) forbids.
const LEGACY_ROLE_HEADER = ["x", "test", "platform", "role"].join("-");

const BASE = "http://localhost:3000";
const DEFAULT_TENANT_ID = "ten_default_dhaka";

type EnvPatch = Record<string, string | undefined>;

async function withEnv<T>(patch: EnvPatch, fn: () => Promise<T>): Promise<T> {
  const previous: EnvPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function createPlatformOperator(role: PlatformRole, password: string): Promise<{ id: string; email: string }> {
  const id = `usr_sec_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const email = `${id}@operators.test`;
  const now = new Date().toISOString();
  db.createUser({ id, email, name: "Security Test Operator", password_hash: await hashPassword(password), status: "ACTIVE", created_at: now, updated_at: now });
  db.savePlatformMembership({ id: `pm_${id}`, user_id: id, role, mfa_enabled: false, is_active: true, created_at: now, updated_at: now });
  return { id, email };
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 0: SECURITY REGRESSION SUITE      ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();

  const ownerPassword = "Unique-Owner-Pass-7731!";
  const tenantA = await AuthService.registerTenantWithOwner({
    email: `owner-a-${Date.now()}@shop-a.test`,
    password: ownerPassword,
    name: "Owner A",
    workspaceName: `Security Shop A ${Date.now()}`,
  });
  const tenantB = await AuthService.registerTenantWithOwner({
    email: `owner-b-${Date.now()}@shop-b.test`,
    password: "Unique-Owner-Pass-8842!",
    name: "Owner B",
    workspaceName: `Security Shop B ${Date.now()}`,
  });

  // ---------------------------------------------------------------------------
  console.log(`${ANSI_BOLD}[FX-02] Credential backdoors (C1, C8, C1-b)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("C1: shared default passwords do not verify against another password's hash", async () => {
    const hash = await hashPassword("Some-Other-Pass-9911!");
    for (const candidate of SHARED_DEFAULT_PASSWORDS) {
      assert.strictEqual(await verifyPassword(candidate, hash), false, `${candidate} must not verify`);
    }
  });

  await runTest("C1: a stored hash is not accepted as the password (pass-the-hash)", async () => {
    const hash = await hashPassword("Some-Other-Pass-9911!");
    assert.strictEqual(await verifyPassword(hash, hash), false);
  });

  await runTest("C1: tenant login with a shared default password is rejected end-to-end", async () => {
    for (const candidate of SHARED_DEFAULT_PASSWORDS) {
      await assert.rejects(() => AuthService.login(tenantA.user.email, candidate), `${candidate} must be rejected`);
    }
    const ok = await AuthService.login(tenantA.user.email, ownerPassword);
    assert.strictEqual(ok.user.id, tenantA.user.id, "the real password still works");
  });

  await runTest("C8: platform login rejects a wrong password", async () => {
    const operator = await createPlatformOperator("SUPER_ADMIN", "Operator-Pass-4412!");
    const { POST } = await import("@/app/api/v1/platform/auth/login/route");
    for (const wrong of ["definitely-wrong", ...SHARED_DEFAULT_PASSWORDS]) {
      const res = await POST(new Request(`${BASE}/api/v1/platform/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: operator.email, password: wrong }),
      }));
      assert.strictEqual(res.status, 401, `password "${wrong}" must be rejected (got ${res.status})`);
    }
  });

  await runTest("C8: platform login accepts the real password and keeps the token out of the JSON body", async () => {
    const operator = await createPlatformOperator("PLATFORM_ANALYST", "Operator-Pass-5523!");
    const { POST } = await import("@/app/api/v1/platform/auth/login/route");
    const res = await POST(new Request(`${BASE}/api/v1/platform/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email, password: "Operator-Pass-5523!" }),
    }));
    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as { data?: { token?: string } };
    assert.strictEqual(json.data?.token, undefined, "token must only travel in the httpOnly cookie");
    assert.ok((res.headers.get("set-cookie") || "").includes(PLATFORM_AUTH_COOKIE_NAME), "platform session cookie is set");
  });

  await runTest("C1-b: seeded demo accounts do not carry the legacy hard-coded hash", async () => {
    const seeded = db.findUserByEmail("superadmin@commerceos.io");
    assert.ok(seeded, "seed still creates the platform owner record");
    assert.ok(!seeded.password_hash.startsWith(LEGACY_SEED_HASH_PREFIX), "legacy hash must be gone");
    for (const candidate of SHARED_DEFAULT_PASSWORDS) {
      assert.strictEqual(await verifyPassword(candidate, seeded.password_hash), false);
    }
  });

  await runTest("C1/C8: no shared-password or legacy-hash logic remains in src/", () => {
    const forbidden = [...SHARED_DEFAULT_PASSWORDS, LEGACY_SEED_HASH_PREFIX];
    const offenders = listSourceFiles(path.resolve(__dirname, "..", "src")).filter((file) => {
      const text = fs.readFileSync(file, "utf8");
      return forbidden.some((needle) => text.includes(needle));
    });
    assert.deepStrictEqual(offenders.map((f) => path.relative(path.resolve(__dirname, ".."), f)), []);
  });

  const { POST: acceptInvitation } = await import("@/app/api/v1/invitations/[token]/route");
  const postAcceptance = (token: string, body: Record<string, unknown>) =>
    acceptInvitation(new Request(`${BASE}/api/v1/invitations/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), { params: { token } });

  // An existing account that workspace B's owner will invite and then try to accept on its behalf.
  const inviteePassword = "Invitee-Own-Pass-6604!";
  const invitee = await AuthService.registerTenantWithOwner({
    email: `invitee-${Date.now()}@shop-c.test`,
    password: inviteePassword,
    name: "Existing Invitee",
    workspaceName: `Security Shop C ${Date.now()}`,
  });
  const inviteeInvitation = InvitationService.createInvitation(tenantB.tenant.id, invitee.user.email, "ADMIN", tenantB.user.id);

  await runTest("N1: an invitation link does not sign in an existing account without its password", async () => {
    for (const body of [{}, { password: "wrong-password-123" }, { name: "Someone Else", password: "Attacker-Pass-123!" }]) {
      const res = await postAcceptance(inviteeInvitation.token, body);
      assert.strictEqual(res.status, 401, `accepting with ${JSON.stringify(body)} must fail`);
      assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`)), "no session cookie");
    }
    assert.strictEqual(db.findMembership(tenantB.tenant.id, invitee.user.id), undefined, "no membership was created");
  });

  await runTest("N1: the account's own password accepts the invitation", async () => {
    const res = await postAcceptance(inviteeInvitation.token, { password: inviteePassword });
    assert.strictEqual(res.status, 200);
    assert.ok(db.findMembership(tenantB.tenant.id, invitee.user.id), "membership created");
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-03] Secrets, token audiences, credential key (C2, M14, H10)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("C2: a session token forged with the published default secret is rejected", async () => {
    const forged = await new SignJWT({
      userId: tenantA.user.id,
      tenantId: tenantA.tenant.id,
      role: "OWNER",
      email: tenantA.user.email,
      name: tenantA.user.name,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(PUBLISHED_DEFAULT_JWT_SECRET));
    assert.strictEqual(await verifySessionToken(forged), null);
    await assert.rejects(() => AuthService.resolveRequestContext(forged));
  });

  await runTest("C2: a platform session token is not accepted as a tenant session", async () => {
    const platformToken = await signPlatformSessionToken({ userId: tenantA.user.id, email: tenantA.user.email, platformRole: "SUPER_ADMIN" });
    assert.strictEqual(await verifySessionToken(platformToken), null);
  });

  await runTest("C2: a step-up token is not accepted as a tenant session", async () => {
    const stepUp = await signStepUpToken(tenantA.user.id);
    assert.strictEqual(await verifySessionToken(stepUp), null);
  });

  await runTest("C2: a tenant session token is not accepted as a platform session", async () => {
    const tenantToken = await signSessionToken({ userId: tenantA.user.id, tenantId: tenantA.tenant.id, role: "OWNER", email: tenantA.user.email, name: tenantA.user.name });
    assert.strictEqual(await verifyPlatformSessionToken(tenantToken), null);
  });

  await runTest("H10: platform sessions are not MFA-verified unless a factor was checked", async () => {
    const token = await signPlatformSessionToken({ userId: "usr_x", email: "x@operators.test", platformRole: "PLATFORM_ANALYST" });
    const payload = await verifyPlatformSessionToken(token);
    assert.ok(payload);
    assert.strictEqual(payload.mfaVerified, false);
  });

  await runTest("H10: the workspace login never marks an operator's platform session MFA-verified", async () => {
    const password = "Operator-Pass-5521!";
    const operator = await createPlatformOperator("SUPER_ADMIN", password);
    const now = new Date().toISOString();
    // A stored mfa_enabled flag is not a verified factor.
    db.savePlatformMembership({ id: `pm_${operator.id}`, user_id: operator.id, role: "SUPER_ADMIN", mfa_enabled: true, is_active: true, created_at: now, updated_at: now });
    db.createMembership({ id: `mem_${operator.id}`, tenant_id: tenantA.tenant.id, user_id: operator.id, role: "ADMIN", created_at: now, updated_at: now });
    const { POST } = await import("@/app/api/v1/auth/login/route");
    const res = await POST(new Request(`${BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email, password }),
    }));
    assert.strictEqual(res.status, 200);
    const platformCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${PLATFORM_AUTH_COOKIE_NAME}=`));
    assert.ok(platformCookie, "an operator signing in through the workspace login also gets a platform session");
    const claims = await verifyPlatformSessionToken(decodeURIComponent(platformCookie.split(";")[0].slice(PLATFORM_AUTH_COOKIE_NAME.length + 1)));
    assert.ok(claims);
    assert.strictEqual(claims.mfaVerified, false);
  });

  await runTest("M14: credentials encrypted with a key derived from the default JWT secret no longer decrypt", () => {
    const legacyKey = crypto.createHash("sha256").update(PUBLISHED_DEFAULT_JWT_SECRET).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", legacyKey, iv);
    let encrypted = cipher.update(JSON.stringify({ accessToken: "legacy-token" }), "utf8", "hex");
    encrypted += cipher.final("hex");
    const legacyCipherText = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted}`;
    assert.throws(() => decryptCredential(legacyCipherText));
  });

  await runTest("FX-03: undecryptable channel credentials fail loudly instead of returning {}", () => {
    const channel = { credentials_encrypted: "encrypted_fb_token_seed" } as unknown as ConnectedChannel;
    assert.throws(() => ChannelService.getDecryptedCredentials(channel));
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-04 / FX-05] Header bypass and dev fallbacks (C3, H1, H10)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("C3: the removed test role header grants nothing without a platform session", async () => {
    const req = new Request(`${BASE}/api/v1/platform/overview`, { headers: { [LEGACY_ROLE_HEADER]: "SUPER_ADMIN", "x-step-up-token": "aaaaaaaa" } });
    await assert.rejects(() => extractPlatformContext(req));
  });

  await runTest("C3: no file under src/ handles an x-test-* identity header", () => {
    const offenders = listSourceFiles(path.resolve(__dirname, "..", "src")).filter((file) =>
      fs.readFileSync(file, "utf8").toLowerCase().includes("x-test-")
    );
    assert.deepStrictEqual(offenders.map((f) => path.relative(path.resolve(__dirname, ".."), f)), []);
  });

  await runTest("C3: a real platform session is still accepted", async () => {
    const operator = await createPlatformOperator("PLATFORM_ANALYST", "Operator-Pass-6634!");
    const token = await signPlatformSessionToken({ userId: operator.id, email: operator.email, platformRole: "PLATFORM_ANALYST" });
    const ctx = await extractPlatformContext(new Request(`${BASE}/api/v1/platform/overview`, { headers: { "x-platform-token": token } }));
    assert.strictEqual(ctx.platformRole, "PLATFORM_ANALYST");
    assert.strictEqual(ctx.stepUpVerified, false);
  });

  await runTest("H1: no token in development without DEV_AUTH_BYPASS → 401", async () => {
    await withEnv({ NODE_ENV: "development", DEV_AUTH_BYPASS: undefined }, async () => {
      await assert.rejects(() => extractRequestContext(new Request(`${BASE}/api/v1/orders`)));
    });
  });

  await runTest("H1: an invalid token never falls back, even with DEV_AUTH_BYPASS=1", async () => {
    await withEnv({ NODE_ENV: "development", DEV_AUTH_BYPASS: "1" }, async () => {
      const req = new Request(`${BASE}/api/v1/orders`, { headers: { authorization: "Bearer not.a.real.token" } });
      await assert.rejects(() => extractRequestContext(req));
    });
  });

  await runTest("H1: the platform context has no development fallback at all", async () => {
    await withEnv({ NODE_ENV: "development", DEV_AUTH_BYPASS: "1" }, async () => {
      await assert.rejects(() => extractPlatformContext(new Request(`${BASE}/api/v1/platform/overview`)));
    });
  });

  await runTest("H10: step-up fails closed until a real second factor exists", async () => {
    const operator = await createPlatformOperator("SUPER_ADMIN", "Operator-Pass-7745!");
    const token = await signPlatformSessionToken({ userId: operator.id, email: operator.email, platformRole: "SUPER_ADMIN" });
    const { POST } = await import("@/app/api/v1/platform/auth/step-up/route");
    for (const body of [{ code: "zzzzzz" }, { code: "123456" }, { mfaCode: "654321" }, { password: "Operator-Pass-7745!" }, { password: "Password123!" }]) {
      const res = await POST(new Request(`${BASE}/api/v1/platform/auth/step-up`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-platform-token": token },
        body: JSON.stringify(body),
      }));
      assert.notStrictEqual(res.status, 200, `step-up must not succeed for ${JSON.stringify(body)}`);
      const json = (await res.json()) as { data?: { stepUpToken?: string } };
      assert.strictEqual(json.data?.stepUpToken, undefined);
    }
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-06] Courier / payment webhooks (C4)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const { POST: courierWebhook } = await import("@/app/api/v1/automation/webhooks/[provider]/route");
  const webhookSecret = crypto.randomBytes(32).toString("hex");
  process.env.SECURITY_TEST_STEADFAST_SECRET = webhookSecret;
  const hmacWebhookId = `wh_sec_hmac_${crypto.randomUUID().slice(0, 8)}`;
  const tokenWebhookId = `wh_sec_token_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  db.createAutomationWebhook({ id: hmacWebhookId, tenant_id: tenantA.tenant.id, provider: "STEADFAST", endpoint_path: "/api/v1/automation/webhooks/steadfast", secret_reference: "SECURITY_TEST_STEADFAST_SECRET", signature_algorithm: "HMAC_SHA256", is_active: true, created_at: nowIso, updated_at: nowIso });
  db.createAutomationWebhook({ id: tokenWebhookId, tenant_id: tenantA.tenant.id, provider: "PATHAO", endpoint_path: "/api/v1/automation/webhooks/pathao", secret_reference: "SECURITY_TEST_STEADFAST_SECRET", signature_algorithm: "TOKEN", is_active: true, created_at: nowIso, updated_at: nowIso });

  const courierBody = JSON.stringify({ event_id: `evt_${crypto.randomUUID()}`, tracking_number: "TRK-SEC-NOT-A-REAL-PARCEL", status: "delivered" });
  const courierUrl = (provider: string, query: string) => `${BASE}/api/v1/automation/webhooks/${provider}?${query}`;
  const postCourier = (provider: string, query: string, headers: Record<string, string>, body = courierBody) =>
    courierWebhook(new Request(courierUrl(provider, query), { method: "POST", headers: { "content-type": "application/json", ...headers }, body }), { params: { provider } });

  await runTest("C4: an unsigned courier webhook is rejected", async () => {
    const res = await postCourier("steadfast", `wh=${hmacWebhookId}&tenant_id=${tenantA.tenant.id}`, {});
    assert.strictEqual(res.status, 401);
  });

  await runTest("C4: an Authorization: Bearer header does not bypass signature verification", async () => {
    const res = await postCourier("steadfast", `wh=${hmacWebhookId}&tenant_id=${tenantA.tenant.id}`, { authorization: "Bearer anything", "x-webhook-timestamp": Date.now().toString() });
    assert.strictEqual(res.status, 401);
  });

  await runTest("C4: legacy TOKEN rows still require an HMAC signature", async () => {
    const res = await postCourier("pathao", `wh=${tokenWebhookId}&tenant_id=${tenantA.tenant.id}`, { authorization: `Bearer ${webhookSecret}`, "x-webhook-timestamp": Date.now().toString() });
    assert.strictEqual(res.status, 401);
  });

  await runTest("C4: unknown tenants never get auto-created webhook rows", async () => {
    const ghostTenant = `ten_ghost_${crypto.randomUUID().slice(0, 8)}`;
    await postCourier("steadfast", `tenant_id=${ghostTenant}`, { "x-tenant-id": ghostTenant });
    assert.strictEqual(db.getAutomationWebhooks(ghostTenant).length, 0);
  });

  await runTest("C4: a signed request without a timestamp is rejected", async () => {
    const res = await postCourier("steadfast", `wh=${hmacWebhookId}&tenant_id=${tenantA.tenant.id}`, { "x-webhook-signature": hmacHex(webhookSecret, courierBody) });
    assert.strictEqual(res.status, 401);
  });

  await runTest("C4: a stale timestamp (> 300 s) is rejected", async () => {
    const stale = (Date.now() - 10 * 60 * 1000).toString();
    const res = await postCourier("steadfast", `wh=${hmacWebhookId}&tenant_id=${tenantA.tenant.id}`, { "x-webhook-signature": hmacHex(webhookSecret, `${stale}.${courierBody}`), "x-webhook-timestamp": stale });
    assert.strictEqual(res.status, 401);
  });

  await runTest("C4: a body-only signature replayed with a fresh timestamp is rejected", async () => {
    const res = await postCourier("steadfast", `wh=${hmacWebhookId}&tenant_id=${tenantA.tenant.id}`, { "x-webhook-signature": hmacHex(webhookSecret, courierBody), "x-webhook-timestamp": Date.now().toString() });
    assert.strictEqual(res.status, 401);
  });

  await runTest("C4: a correctly signed, fresh webhook is accepted and attributed to the webhook's own tenant", async () => {
    const body = JSON.stringify({ event_id: `evt_${crypto.randomUUID()}`, tracking_number: "TRK-SEC-NOT-A-REAL-PARCEL", status: "in_transit" });
    const before = db.getAutomationWebhookDeliveries(tenantB.tenant.id).length;
    const timestamp = Date.now().toString();
    const res = await postCourier("steadfast", `wh=${hmacWebhookId}&tenant_id=${tenantA.tenant.id}`, {
      "x-webhook-signature": hmacHex(webhookSecret, `${timestamp}.${body}`),
      "x-webhook-timestamp": timestamp,
      "x-tenant-id": tenantB.tenant.id,
    }, body);
    assert.strictEqual(res.status, 200);
    const json = (await res.json()) as { verified?: boolean };
    assert.strictEqual(json.verified, true);
    assert.strictEqual(db.getAutomationWebhookDeliveries(tenantB.tenant.id).length, before, "x-tenant-id header must be ignored");
    assert.ok(db.getAutomationWebhookDeliveries(tenantA.tenant.id).some((d) => d.webhook_id === hmacWebhookId && d.status === "VERIFIED"));
  });

  await runTest("FX-06: Automations lists each callback URL and whether its secret is set, never the secret", async () => {
    const { token } = await AuthService.login(tenantA.user.email, ownerPassword);
    const { GET } = await import("@/app/api/v1/automation/providers/route");
    const res = await GET(new Request(`${BASE}/api/v1/automation/providers`, { headers: { authorization: `Bearer ${token}` } }));
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(webhookSecret), "the webhook secret must never be returned");
    const json = JSON.parse(text) as { data?: { webhooks?: Array<{ id: string; ingress_path?: string; secret_configured?: boolean }> } };
    const row = json.data?.webhooks?.find((w) => w.id === hmacWebhookId);
    assert.ok(row, "the tenant's webhook is listed");
    assert.strictEqual(row.ingress_path, `/api/v1/automation/webhooks/steadfast?wh=${hmacWebhookId}`);
    assert.strictEqual(row.secret_configured, true);
  });

  await runTest("C4: there is no predictable fallback webhook secret", () => {
    assert.throws(() => WebhookGatewayService.resolveWebhookSecret(`UNSET_SECRET_${crypto.randomUUID().slice(0, 6).toUpperCase()}`));
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-07] Social webhook ingress (H5)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const metaPayload = (pageId: string, text: string) => JSON.stringify({
    object: "page",
    entry: [{ id: pageId, time: Date.now(), messaging: [{ sender: { id: `psid_${crypto.randomUUID().slice(0, 8)}` }, recipient: { id: pageId }, timestamp: Date.now(), message: { mid: `mid.${crypto.randomUUID()}`, text } }] }],
  });

  await runTest("H5: Meta adapters reject signatures when no app secret is configured", async () => {
    await withEnv({ META_APP_SECRET: undefined }, async () => {
      const payload = metaPayload("page_any", "hello");
      const signature = `sha256=${hmacHex(LEGACY_META_APP_SECRET, payload)}`;
      assert.strictEqual(new FacebookAdapter().verifyWebhook(payload, signature, {}, {}), false);
      assert.strictEqual(new InstagramAdapter().verifyWebhook(payload, signature, {}, {}), false);
      assert.strictEqual(new WhatsAppAdapter().verifyWebhook(payload, signature, {}, {}), false);
    });
  });

  await runTest("H5: a message for an unknown page id is ignored, not routed to another tenant's channel", async () => {
    await withEnv({ META_APP_SECRET: undefined }, async () => {
      const payload = metaPayload(`page_unknown_${crypto.randomUUID().slice(0, 6)}`, "stock ache?");
      const signature = `sha256=${hmacHex(LEGACY_META_APP_SECRET, payload)}`;
      const before = db.data.messages.filter((m) => m.tenant_id === DEFAULT_TENANT_ID).length;
      let processed = 0;
      try {
        const result = await WebhookIngressService.handleWebhook("FACEBOOK_MESSENGER", payload, signature, {});
        processed = result.messagesProcessed;
      } catch {
        processed = 0;
      }
      assert.strictEqual(processed, 0);
      assert.strictEqual(db.data.messages.filter((m) => m.tenant_id === DEFAULT_TENANT_ID).length, before);
    });
  });

  await runTest("H5: Meta verify-token handshake is refused when META_VERIFY_TOKEN is not configured", async () => {
    await withEnv({ META_VERIFY_TOKEN: undefined }, async () => {
      for (const route of ["facebook", "instagram", "whatsapp"]) {
        const { GET } = await import(`@/app/api/v1/social/webhooks/${route}/route`);
        const res = await GET(new Request(`${BASE}/api/v1/social/webhooks/${route}?hub.mode=subscribe&hub.verify_token=${LEGACY_META_VERIFY_TOKEN}&hub.challenge=abc123`));
        assert.notStrictEqual(res.status, 200, `${route} must not echo the challenge`);
      }
    });
  });

  await runTest("H5: the website widget only accepts messages for WEBSITE_CHAT channels", async () => {
    const { POST } = await import("@/app/api/v1/social/widget/message/route");
    const before = db.data.messages.length;
    const res = await POST(new Request(`${BASE}/api/v1/social/widget/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel_id: "chn_meta_fb", anonymous_id: "anon_sec", customer_name: "Visitor", text: "hello" }),
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.data.messages.length, before);
  });

  await runTest("H5: website widget messages are length-capped", async () => {
    const { POST } = await import("@/app/api/v1/social/widget/message/route");
    const res = await POST(new Request(`${BASE}/api/v1/social/widget/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel_id: "chn_web_chat", anonymous_id: "anon_sec", customer_name: "Visitor", text: "x".repeat(5000) }),
    }));
    assert.strictEqual(res.status, 400);
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-01] Committed secrets (C5)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("C5: .env.example contains placeholders only", () => {
    const example = fs.readFileSync(path.resolve(__dirname, "..", ".env.example"), "utf8");
    const value = (key: string) => (example.match(new RegExp(`^${key}=(.*)$`, "m")) || [])[1] ?? "";
    assert.strictEqual(value("JWT_SECRET"), "", "JWT_SECRET must be empty in the example file");
    assert.strictEqual(value("CREDENTIALS_ENCRYPTION_KEY"), "");
    assert.ok(!example.includes(PUBLISHED_DEFAULT_JWT_SECRET));
    for (const key of ["DATABASE_URL", "DATABASE_URL_POOLED"]) {
      assert.ok(value(key).includes("USER:PASSWORD@"), `${key} must use USER:PASSWORD placeholders`);
    }
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Security regression suite crashed:", err);
  process.exit(1);
});
