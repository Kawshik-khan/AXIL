/**
 * Connection platform P4 (ADR-119): health checks and expiry, revoking a former member's tokens, Meta's deauthorize and
 * data-deletion callbacks, and revoking at Meta on disconnect.
 * Run: node tests/ts-runner.cjs ./tests/connection-lifecycle-tests.ts
 */
// @ts-ignore
import assert from "assert";
import crypto from "crypto";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { userRepository } from "@/domains/auth/user.repository";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { ConnectorService } from "@/domains/connectors/service";
import { OAuthBroker } from "@/domains/connectors/auth/oauth-broker";
import { JOBS } from "@/domains/jobs/jobs.service";
import { runConnectionHealth, signDeletionCode } from "@/domains/connectors/connection-lifecycle";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";
import { encryptCredential } from "@/lib/security";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import type { RequestContext } from "@/lib/context";
import type { ConnectorConfigRecord } from "@/types/connector";
import { PATCH as patchMember } from "@/app/api/v1/users/[id]/route";
import { POST as deauthorizeRoute } from "@/app/api/v1/connections/[provider]/deauthorize/route";
import { POST as dataDeletionRoute } from "@/app/api/v1/connections/[provider]/data-deletion/route";
import { GET as deletionStatusRoute } from "@/app/api/v1/connections/[provider]/data-deletion/[code]/route";

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
    console.error(err);
    failedCount++;
  }
}

const BASE_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "business_management",
];
const DAY = 86_400_000;

type Debug = { status?: number; body?: unknown; throws?: boolean };
/** A fake Graph API: /debug_token answers `debug`; records every call. */
function fakeMeta(debug: Debug) {
  const calls: Array<{ method: string; url: URL }> = [];
  setOutboundTransportForTesting(async (raw, options) => {
    const url = new URL(raw.toString());
    calls.push({ method: String(options.method ?? "GET"), url });
    const json = (status: number, body: unknown) => ({ status, headers: {}, body: JSON.stringify(body), truncated: false, durationMs: 1 });
    if (url.pathname.endsWith("/debug_token")) {
      if (debug.throws) throw Object.assign(new Error("network"), { name: "OutboundNetworkError" });
      return json(debug.status ?? 200, debug.body ?? {});
    }
    if (url.pathname.endsWith("/me/permissions")) return json(200, { success: true });
    return json(404, { error: { code: 803, message: "unknown" } });
  });
  return calls;
}
const debugBody = (o: { user_id?: string; expires_in_days?: number; scopes?: string[]; is_valid?: boolean }) => ({
  data: {
    is_valid: o.is_valid ?? true,
    app_id: process.env.META_APP_ID,
    user_id: o.user_id ?? "9001",
    scopes: o.scopes ?? BASE_SCOPES,
    expires_at: Math.floor((Date.now() + (o.expires_in_days ?? 50) * DAY) / 1000),
  },
});

function signedRequest(userId: string, secret = process.env.META_APP_SECRET as string): string {
  const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: userId, issued_at: Math.floor(Date.now() / 1000) })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${sig}.${payload}`;
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   CONNECTION LIFECYCLE (ADR-119, P4)               ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.APP_URL = "https://shop.example.com";

  const stamp = Date.now();
  const regA = await AuthService.registerTenantWithOwner({ workspaceName: `Life A ${stamp}`, name: "Owner A", email: `life-a-${stamp}@example.com`, password: "Password12345!" });
  const regB = await AuthService.registerTenantWithOwner({ workspaceName: `Life B ${stamp}`, name: "Owner B", email: `life-b-${stamp}@example.com`, password: "Password12345!" });
  const A = regA.tenant.id;
  const B = regB.tenant.id;
  const ctxA: RequestContext = {
    requestId: "req_life",
    traceId: "trc_life",
    user: { id: regA.user.id, email: regA.user.email, name: regA.user.name, status: "ACTIVE" },
    tenant: { id: A, name: regA.tenant.name, slug: regA.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  };

  /** An ADMIN member of A who signs in to Facebook. */
  const adminId = `usr_life_admin_${stamp}`;
  const at = new Date().toISOString();
  db.createUser({ id: adminId, email: `${adminId}@example.com`, name: "Admin", password_hash: "!disabled", status: "ACTIVE", created_at: at, updated_at: at });
  db.createMembership({ id: `mem_${adminId}`, tenant_id: A, user_id: adminId, role: "ADMIN", created_at: at, updated_at: at });

  let seq = 0;
  function connection(tenantId: string, owner: string, fbUser: string, extra: Partial<ConnectorConfigRecord> = {}): ConnectorConfigRecord {
    const now = new Date(Date.now() - 60_000).toISOString();
    return db.saveConnector({
      id: `conn_meta_graph_life_${seq++}`,
      tenant_id: tenantId,
      provider_id: "meta_graph",
      category: "SOCIAL_ADS",
      name: "Meta (sign-in)",
      credentials_encrypted: encryptCredential({ access_token: `USER_TOKEN_${fbUser}_${seq}`, kind: "user" }),
      credentials_masked: {},
      configuration: {},
      status: "ACTIVE",
      health_status: "HEALTHY",
      enabled: true,
      auth_method: "oauth2",
      owner_user_id: owner,
      external_account_id: fbUser,
      scopes_granted: BASE_SCOPES,
      token_expires_at: new Date(Date.now() + 50 * DAY).toISOString(),
      connection_status: "ACTIVE",
      created_at: now,
      updated_at: now,
      ...extra,
    });
  }
  const reload = (c: ConnectorConfigRecord) => db.findConnectorById(c.tenant_id, c.id)!;

  console.log(`${ANSI_BOLD}[Health job]${ANSI_RESET}`);

  await runTest("the connection-health job is registered (every 6 hours)", () => {
    assert.ok(JOBS["connection-health"]);
    assert.strictEqual(JOBS["connection-health"].cadenceMs, 6 * 3_600_000);
  });

  await runTest("a valid token stays ACTIVE and its scopes and expiry are refreshed from Meta", async () => {
    const c = connection(A, adminId, "9001");
    fakeMeta({ body: debugBody({ expires_in_days: 40 }) });
    try {
      await runConnectionHealth();
    } finally {
      setOutboundTransportForTesting(null);
    }
    const now = reload(c);
    assert.deepStrictEqual([now.connection_status, now.health_status, now.health_code], ["ACTIVE", "HEALTHY", undefined]);
    assert.ok(now.health_checked_at && Math.abs(Date.parse(now.token_expires_at!) - (Date.now() + 40 * DAY)) < 5 * 60_000);
    db.deleteConnector(A, c.id);
  });

  await runTest("a token expiring within 7 days is DEGRADED and still usable", async () => {
    const c = connection(A, adminId, "9001");
    fakeMeta({ body: debugBody({ expires_in_days: 3 }) });
    try {
      await runConnectionHealth();
    } finally {
      setOutboundTransportForTesting(null);
    }
    const now = reload(c);
    assert.deepStrictEqual([now.connection_status, now.health_code], ["DEGRADED", "TOKEN_EXPIRING"]);
    assert.notStrictEqual(OAuthBroker.connectionToken(now), "");
    db.deleteConnector(A, c.id);
  });

  await runTest("a token missing a required scope is DEGRADED (SCOPES_MISSING)", async () => {
    const c = connection(A, adminId, "9001");
    fakeMeta({ body: debugBody({ scopes: BASE_SCOPES.filter((s) => s !== "pages_messaging") }) });
    try {
      await runConnectionHealth();
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual([reload(c).connection_status, reload(c).health_code], ["DEGRADED", "SCOPES_MISSING"]);
    db.deleteConnector(A, c.id);
  });

  await runTest("a token Meta says is invalid is deleted and the connection asks for sign-in", async () => {
    const c = connection(A, adminId, "9001");
    fakeMeta({ body: debugBody({ is_valid: false }) });
    try {
      await runConnectionHealth();
    } finally {
      setOutboundTransportForTesting(null);
    }
    const now = reload(c);
    assert.deepStrictEqual([now.connection_status, now.health_code], ["NEEDS_REAUTH", "TOKEN_REVOKED"]);
    assert.strictEqual(OAuthBroker.storedToken(now), "", "token deleted");
    assert.ok(db.getAuditLogsByTenant(A, 200).logs.some((l) => l.action === "connection.needs_reauth" && l.resource_id === c.id));
    db.deleteConnector(A, c.id);
  });

  await runTest("an error from /debug_token itself (e.g. a wrong app secret) never deletes tokens", async () => {
    const c = connection(A, adminId, "9001");
    fakeMeta({ status: 400, body: { error: { code: 190, message: "Invalid OAuth access token (app token)" } } });
    try {
      await runConnectionHealth();
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual([reload(c).connection_status, reload(c).health_code], ["ACTIVE", "CHECK_FAILED"]);
    assert.notStrictEqual(OAuthBroker.storedToken(reload(c)), "");
    db.deleteConnector(A, c.id);
  });

  await runTest("many tokens 'revoked' in one run trips the breaker: nothing is deleted", async () => {
    const many = Array.from({ length: 6 }, (_, i) => connection(A, adminId, `95${i}`));
    fakeMeta({ body: debugBody({ is_valid: false }) });
    try {
      await runConnectionHealth();
    } finally {
      setOutboundTransportForTesting(null);
    }
    for (const c of many) {
      assert.deepStrictEqual([reload(c).connection_status, reload(c).health_code], ["ACTIVE", "CHECK_FAILED"], c.id);
      db.deleteConnector(A, c.id);
    }
  });

  await runTest("a migrated connection learns whose login it holds from the health check", async () => {
    const c = connection(A, adminId, "x", { external_account_id: undefined, health_code: "MIGRATED_NOT_INSPECTED" });
    fakeMeta({ body: debugBody({ user_id: "9777" }) });
    try {
      await runConnectionHealth();
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(reload(c).external_account_id, "9777");
    db.deleteConnector(A, c.id);
  });

  await runTest("Meta unreachable: nothing changes but the health code", async () => {
    const c = connection(A, adminId, "9001");
    fakeMeta({ throws: true });
    try {
      await runConnectionHealth();
    } finally {
      setOutboundTransportForTesting(null);
    }
    const now = reload(c);
    assert.deepStrictEqual([now.connection_status, now.health_code], ["ACTIVE", "CHECK_FAILED"]);
    assert.notStrictEqual(OAuthBroker.storedToken(now), "");
    db.deleteConnector(A, c.id);
  });

  await runTest("a connection changed while Meta was asked keeps its newer state", async () => {
    const c = connection(A, adminId, "9001");
    setOutboundTransportForTesting(async () => {
      // A reconnect lands during the check
      db.saveConnector({ ...reload(c), name: "reconnected", updated_at: new Date().toISOString() });
      return { status: 400, headers: {}, body: JSON.stringify({ error: { code: 190, message: "x" } }), truncated: false, durationMs: 1 };
    });
    try {
      await runConnectionHealth();
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual([reload(c).name, reload(c).connection_status], ["reconnected", "ACTIVE"]);
    db.deleteConnector(A, c.id);
  });

  await runTest("a token past its expiry gives no token even before the job runs", () => {
    const c = connection(A, adminId, "9001", { token_expires_at: new Date(Date.now() - 1000).toISOString() });
    assert.strictEqual(OAuthBroker.connectionToken(c), "");
    db.deleteConnector(A, c.id);
  });

  console.log(`\n${ANSI_BOLD}[Former members (E8)]${ANSI_RESET}`);

  const { token: ownerToken } = await AuthService.login(regA.user.email, "Password12345!");
  const patch = (userId: string, body: unknown) =>
    patchMember(
      new Request(`https://shop.example.com/api/v1/users/${userId}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: userId }) }
    );

  await runTest("suspending a member deletes the tokens of the connections they granted", async () => {
    const mine = connection(A, adminId, "9001");
    const owners = connection(A, regA.user.id, "9002");
    const res = await patch(adminId, { status: "SUSPENDED" });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual([reload(mine).connection_status, reload(mine).health_code], ["NEEDS_REAUTH", "OWNER_LEFT"]);
    assert.strictEqual(OAuthBroker.storedToken(reload(mine)), "");
    assert.strictEqual(reload(owners).connection_status, "ACTIVE", "other members' connections are untouched");
    assert.ok(db.getAuditLogsByTenant(A, 200).logs.some((l) => l.action === "connection.owner_access_revoked" && l.resource_id === mine.id));
    await patch(adminId, { status: "ACTIVE" });
    db.deleteConnector(A, mine.id);
    db.deleteConnector(A, owners.id);
  });

  await runTest("a role that can't manage channels loses its connections; one that can keeps them", async () => {
    const managerMay = ROLE_PERMISSIONS.MANAGER.includes(PERMISSIONS.SOCIAL_CHANNEL_MANAGE);
    const mine = connection(A, adminId, "9001");
    await patch(adminId, { role: "MANAGER" });
    assert.strictEqual(reload(mine).connection_status, managerMay ? "ACTIVE" : "NEEDS_REAUTH");
    await patch(adminId, { role: "ANALYST" });
    assert.strictEqual(reload(mine).connection_status, "NEEDS_REAUTH");
    await patch(adminId, { role: "ADMIN" });
    db.deleteConnector(A, mine.id);
  });

  await runTest("removing a member deletes their connections' tokens", async () => {
    const mine = connection(A, adminId, "9001");
    await userRepository.removeMembership(A, adminId);
    assert.strictEqual(reload(mine).connection_status, "NEEDS_REAUTH");
    db.createMembership({ id: `mem_${adminId}_2`, tenant_id: A, user_id: adminId, role: "ADMIN", created_at: at, updated_at: at });
    db.deleteConnector(A, mine.id);
  });

  console.log(`\n${ANSI_BOLD}[Meta deauthorize and data deletion]${ANSI_RESET}`);

  const callback = (route: typeof deauthorizeRoute, provider: string, body: string, type = "application/x-www-form-urlencoded") =>
    route(new Request(`https://shop.example.com/api/v1/connections/${provider}/x`, { method: "POST", headers: { "content-type": type }, body }), {
      params: Promise.resolve({ provider }),
    });

  await runTest("deauthorize: that Facebook user's connections in every workspace lose their token and Pages", async () => {
    const inA = connection(A, adminId, "9100");
    const inB = connection(B, regB.user.id, "9100");
    const other = connection(A, adminId, "9200");
    const page = db.createConnectionResource({
      id: `cres_life_${stamp}`, tenant_id: A, connection_id: inA.id, kind: "FB_PAGE", external_id: "7700",
      name: "Page", metadata: {}, token_encrypted: encryptCredential({ token: "PAGE_TOKEN" }), status: "ACTIVE", created_at: at, updated_at: at,
    });
    const channel = db.createConnectedChannel({
      id: `chn_life_${stamp}`, tenant_id: A, type: "FACEBOOK_MESSENGER", name: "Page", status: "ACTIVE", provider_account_id: "7700",
      credentials_encrypted: encryptCredential({ accessToken: "PAGE_TOKEN", pageId: "7700", connectedVia: "facebook_login" }),
      resource_id: page.id, configuration: {}, created_at: at, updated_at: at,
    });
    const res = await callback(deauthorizeRoute, "meta", `signed_request=${encodeURIComponent(signedRequest("9100"))}`);
    assert.strictEqual(res.status, 200);
    for (const c of [inA, inB]) assert.deepStrictEqual([reload(c).connection_status, reload(c).health_code], ["NEEDS_REAUTH", "DEAUTHORIZED"]);
    assert.strictEqual(reload(other).connection_status, "ACTIVE");
    assert.strictEqual(db.findConnectionResource(A, page.id)?.status, "DETACHED");
    assert.throws(() => ChannelService.getDecryptedCredentials(channel), (e: unknown) => e instanceof AppError && e.code === "CHANNEL_CREDENTIALS_INVALID");
    db.deleteConnectedChannel(A, channel.id);
    for (const c of [inA, inB, other]) db.deleteConnector(c.tenant_id, c.id);
  });

  await runTest("a login signed_request (with code) or a stale one is refused", async () => {
    const c = connection(A, adminId, "9310");
    const sign = (payload: Record<string, unknown>) => {
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${crypto.createHmac("sha256", process.env.META_APP_SECRET as string).update(body).digest("base64url")}.${body}`;
    };
    const nowSec = Math.floor(Date.now() / 1000);
    for (const payload of [
      { algorithm: "HMAC-SHA256", user_id: "9310", issued_at: nowSec, code: "AQB..." },
      { algorithm: "HMAC-SHA256", user_id: "9310", issued_at: nowSec - 3 * 86400 },
      { algorithm: "HMAC-SHA256", user_id: "9310" },
    ]) {
      const res = await callback(deauthorizeRoute, "meta", `signed_request=${encodeURIComponent(sign(payload))}`);
      assert.strictEqual(res.status, 400, JSON.stringify(payload));
    }
    assert.strictEqual(reload(c).connection_status, "ACTIVE");
    db.deleteConnector(A, c.id);
  });

  await runTest("junk requests don't block a genuine callback", async () => {
    for (let i = 0; i < 130; i++) await callback(deauthorizeRoute, "meta", "signed_request=junk");
    const c = connection(A, adminId, "9320");
    const res = await callback(deauthorizeRoute, "meta", `signed_request=${encodeURIComponent(signedRequest("9320"))}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(reload(c).connection_status, "NEEDS_REAUTH");
    db.deleteConnector(A, c.id);
  });

  await runTest("deauthorize answers the same whether or not anything matched", async () => {
    const res = await callback(deauthorizeRoute, "meta", `signed_request=${encodeURIComponent(signedRequest("9999000"))}`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(((await res.json()) as { data: unknown }).data, { received: true });
  });

  await runTest("a forged or malformed signed_request changes nothing", async () => {
    const c = connection(A, adminId, "9300");
    const forged = signedRequest("9300", "not-the-app-secret");
    for (const body of [`signed_request=${encodeURIComponent(forged)}`, "signed_request=abc", "", `signed_request=${encodeURIComponent(signedRequest("9300"))}.x`]) {
      const res = await callback(deauthorizeRoute, "meta", body);
      assert.strictEqual(res.status, 400, body);
    }
    assert.strictEqual(reload(c).connection_status, "ACTIVE");
    assert.strictEqual((await callback(deauthorizeRoute, "google", `signed_request=${encodeURIComponent(signedRequest("9300"))}`)).status, 404);
    db.deleteConnector(A, c.id);
  });

  await runTest("data deletion: that Facebook user's connections are deleted; the status URL confirms it", async () => {
    const inA = connection(A, adminId, "9400");
    const res = await callback(dataDeletionRoute, "meta", JSON.stringify({ signed_request: signedRequest("9400") }), "application/json");
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { url: string; confirmation_code: string };
    assert.ok(body.url.startsWith("https://shop.example.com/api/v1/connections/meta/data-deletion/"));
    assert.ok(!body.confirmation_code.includes("9400"), "no Facebook id in the code");
    assert.strictEqual(db.findConnectorById(A, inA.id), undefined);
    const status = await deletionStatusRoute(new Request(body.url), { params: Promise.resolve({ provider: "meta", code: body.confirmation_code }) });
    assert.strictEqual(status.status, 200);
    assert.strictEqual(((await status.json()) as { data: { status: string } }).data.status, "COMPLETED");
  });

  await runTest("data deletion first identifies migrated connections, then deletes them and the channels their Pages served", async () => {
    const migrated = connection(B, regB.user.id, "x", { external_account_id: undefined });
    const page = db.createConnectionResource({
      id: `cres_mig_${stamp}`, tenant_id: B, connection_id: migrated.id, kind: "FB_PAGE", external_id: "7800",
      name: "Page", metadata: {}, token_encrypted: encryptCredential({ token: "PAGE_TOKEN" }), status: "ACTIVE", created_at: at, updated_at: at,
    });
    const channel = db.createConnectedChannel({
      id: `chn_mig_${stamp}`, tenant_id: B, type: "FACEBOOK_MESSENGER", name: "Page", status: "ACTIVE", provider_account_id: "7800",
      credentials_encrypted: encryptCredential({ accessToken: "PAGE_TOKEN", connectedVia: "facebook_login" }),
      resource_id: page.id, configuration: {}, created_at: at, updated_at: at,
    });
    fakeMeta({ body: debugBody({ user_id: "9410" }) });
    let body: { url: string; confirmation_code: string };
    try {
      const res = await callback(dataDeletionRoute, "meta", `signed_request=${encodeURIComponent(signedRequest("9410"))}`);
      body = (await res.json()) as { url: string; confirmation_code: string };
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(db.findConnectorById(B, migrated.id), undefined);
    assert.strictEqual(db.getConnectedChannels(B).some((c) => c.id === channel.id), false);
    const status = await deletionStatusRoute(new Request(body.url), { params: Promise.resolve({ provider: "meta", code: body.confirmation_code }) });
    assert.strictEqual(((await status.json()) as { data: { status: string } }).data.status, "COMPLETED");
  });

  await runTest("if a connection's login can't be identified, the deletion status says IN_PROGRESS, not COMPLETED", async () => {
    const unknown = connection(B, regB.user.id, "x", { external_account_id: undefined });
    fakeMeta({ throws: true });
    let body: { url: string; confirmation_code: string };
    try {
      const res = await callback(dataDeletionRoute, "meta", `signed_request=${encodeURIComponent(signedRequest("9420"))}`);
      body = (await res.json()) as { url: string; confirmation_code: string };
    } finally {
      setOutboundTransportForTesting(null);
    }
    const status = await deletionStatusRoute(new Request(body.url), { params: Promise.resolve({ provider: "meta", code: body.confirmation_code }) });
    assert.strictEqual(((await status.json()) as { data: { status: string } }).data.status, "IN_PROGRESS");
    db.deleteConnector(B, unknown.id);
  });

  await runTest("a tampered or foreign deletion code is not found", async () => {
    const good = signDeletionCode(process.env.META_APP_SECRET as string, Date.now());
    const tampered = `${good.slice(0, -2)}xx`;
    const foreign = signDeletionCode("another-secret", Date.now());
    for (const code of [tampered, foreign, "nope", "%"]) {
      const res = await deletionStatusRoute(new Request("https://x.test/"), { params: Promise.resolve({ provider: "meta", code }) });
      assert.strictEqual(res.status, 404, code);
    }
  });

  console.log(`\n${ANSI_BOLD}[Disconnect revokes at Meta]${ANSI_RESET}`);

  await runTest("disconnecting revokes the app at Meta, unless the same login powers another workspace", async () => {
    const solo = connection(A, adminId, "9500");
    let calls = fakeMeta({});
    try {
      assert.ok(await ConnectorService.deleteConnector(ctxA, solo.id));
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.ok(calls.some((c) => c.method === "DELETE" && c.url.pathname.endsWith("/me/permissions")));

    const shared = connection(A, adminId, "9600");
    const elsewhere = connection(B, regB.user.id, "9600");
    calls = fakeMeta({});
    try {
      assert.ok(await ConnectorService.deleteConnector(ctxA, shared.id));
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.ok(!calls.some((c) => c.method === "DELETE"), "B still uses that login");
    assert.strictEqual(reload(elsewhere).connection_status, "ACTIVE");
    db.deleteConnector(B, elsewhere.id);

    // A connection whose login is still unknown might be the same login: no revoke either
    const mine = connection(A, adminId, "9700");
    const unknown = connection(B, regB.user.id, "x", { external_account_id: undefined });
    calls = fakeMeta({});
    try {
      assert.ok(await ConnectorService.deleteConnector(ctxA, mine.id));
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.ok(!calls.some((c) => c.method === "DELETE"));
    db.deleteConnector(B, unknown.id);
  });

  console.log(`\n${ANSI_BOLD}Results: ${passedCount} passed, ${failedCount} failed${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
