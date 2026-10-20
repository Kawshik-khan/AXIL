/**
 * Connection platform P5 (ADR-119): WhatsApp Embedded Signup on the OAuth broker, and Telegram / courier connectors
 * recorded as connections with resources.
 * Run: node tests/ts-runner.cjs ./tests/whatsapp-signup-tests.ts
 */
// @ts-ignore
import assert from "assert";
import crypto from "crypto";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { OAuthBroker } from "@/domains/connectors/auth/oauth-broker";
import { WhatsAppSignupService } from "@/domains/social/whatsapp/whatsapp-signup.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { ConnectorService } from "@/domains/connectors/service";
import { handleMetaDeauthorize } from "@/domains/connectors/connection-lifecycle";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import type { RequestContext } from "@/lib/context";

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

const rejectsWith = async (fn: () => Promise<unknown>, code: string) => {
  await assert.rejects(fn, (err: unknown) => err instanceof AppError && err.code === code);
};

/** A fake Graph API for Embedded Signup. Records every call. */
function fakeMeta(opts: {
  wabas?: string[];
  numbers?: Record<string, Array<Record<string, unknown>>>;
  registerFails?: boolean;
  subscribeFails?: boolean;
  userId?: string;
} = {}) {
  const calls: Array<{ method: string; url: URL; body: string }> = [];
  setOutboundTransportForTesting(async (raw, options) => {
    const url = new URL(raw.toString());
    calls.push({ method: String(options.method ?? "GET"), url, body: String(options.body ?? "") });
    const json = (status: number, body: unknown) => ({ status, headers: {}, body: JSON.stringify(body), truncated: false, durationMs: 1 });
    if (url.pathname.endsWith("/oauth/access_token")) {
      return url.searchParams.get("code") === "good_code" ? json(200, { access_token: "BUSINESS_TOKEN" }) : json(400, { error: { code: 100, message: "bad" } });
    }
    if (url.pathname.endsWith("/debug_token")) {
      const wabas = opts.wabas ?? ["111"];
      return json(200, {
        data: {
          is_valid: true,
          app_id: process.env.META_APP_ID,
          user_id: opts.userId ?? "8001",
          scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
          expires_at: 0,
          granular_scopes: [
            { scope: "whatsapp_business_management", target_ids: wabas },
            { scope: "whatsapp_business_messaging", target_ids: wabas },
          ],
        },
      });
    }
    const phoneList = url.pathname.match(/\/(\d+)\/phone_numbers$/);
    if (phoneList) return json(200, { data: (opts.numbers ?? {})[phoneList[1]] ?? [] });
    if (url.pathname.endsWith("/subscribed_apps")) {
      return opts.subscribeFails && options.method === "POST" ? json(403, { error: { code: 200, message: "no" } }) : json(200, { success: true });
    }
    if (url.pathname.endsWith("/register")) {
      return opts.registerFails ? json(400, { error: { code: 100, message: "Invalid PIN" } }) : json(200, { success: true });
    }
    return json(404, { error: { code: 803, message: "unknown" } });
  });
  return calls;
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   WHATSAPP SIGN-UP + HUB CONNECTIONS (ADR-119, P5) ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.META_WA_CONFIG_ID = "555000111";
  process.env.APP_URL = "https://shop.example.com";

  const stamp = Date.now();
  const reg = (n: string) =>
    AuthService.registerTenantWithOwner({ workspaceName: `WA ${n} ${stamp}`, name: `Owner ${n}`, email: `wa-${n}-${stamp}@example.com`, password: "Password12345!" });
  const regA = await reg("a");
  const regB = await reg("b");
  const ctx = (r: typeof regA): RequestContext => ({
    requestId: "req_wa",
    traceId: "trc_wa",
    user: { id: r.user.id, email: r.user.email, name: r.user.name, status: "ACTIVE" },
    tenant: { id: r.tenant.id, name: r.tenant.name, slug: r.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions: Object.values(PERMISSIONS),
    timestamp: new Date().toISOString(),
  });
  const ctxA = ctx(regA);
  const ctxB = ctx(regB);
  const numbers = {
    "111": [
      { id: "60001", display_phone_number: "+880 1711-000001", verified_name: "Dhaka Threads", quality_rating: "GREEN" },
      { id: "60002", display_phone_number: "+880 1711-000002", verified_name: "Dhaka Threads 2" },
    ],
    "999": [{ id: "69999", display_phone_number: "+1 555", verified_name: "Not granted" }],
  };

  async function signUp(context: RequestContext, userId = "8001"): Promise<string> {
    const { url, nonce } = await OAuthBroker.start(context, "whatsapp", []);
    fakeMeta({ userId });
    try {
      return await OAuthBroker.completeCallback(context, "whatsapp", { code: "good_code", state: new URL(url).searchParams.get("state")! }, nonce);
    } finally {
      setOutboundTransportForTesting(null);
    }
  }

  console.log(`${ANSI_BOLD}[WhatsApp Embedded Signup]${ANSI_RESET}`);

  await runTest("the sign-up dialog uses the Embedded Signup configuration and the WhatsApp callback", async () => {
    const { url } = await OAuthBroker.start(ctxA, "whatsapp", []);
    const u = new URL(url);
    assert.strictEqual(u.searchParams.get("config_id"), "555000111");
    assert.strictEqual(u.searchParams.get("redirect_uri"), "https://shop.example.com/api/v1/connections/whatsapp/callback");
    assert.strictEqual(u.searchParams.get("override_default_response_type"), "true");
    assert.ok(u.searchParams.get("scope")?.includes("whatsapp_business_messaging"));
  });

  await runTest("without META_WA_CONFIG_ID the sign-up says it isn't set up", async () => {
    const saved = process.env.META_WA_CONFIG_ID;
    delete process.env.META_WA_CONFIG_ID;
    try {
      await rejectsWith(() => OAuthBroker.start(ctxA, "whatsapp", []), "WHATSAPP_LOGIN_NOT_CONFIGURED");
    } finally {
      process.env.META_WA_CONFIG_ID = saved;
    }
  });

  let pendingA = "";
  await runTest("the code becomes the business token without a long-lived exchange", async () => {
    const { url, nonce } = await OAuthBroker.start(ctxA, "whatsapp", []);
    const calls = fakeMeta();
    try {
      pendingA = await OAuthBroker.completeCallback(ctxA, "whatsapp", { code: "good_code", state: new URL(url).searchParams.get("state")! }, nonce);
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.ok(!calls.some((c) => c.url.searchParams.get("grant_type") === "fb_exchange_token"));
    assert.strictEqual(OAuthBroker.readPending(ctxA, "whatsapp", pendingA).token.accessToken, "BUSINESS_TOKEN");
  });

  await runTest("a Facebook sign-in's pending cookie can't be used for WhatsApp", async () => {
    const { encryptCredential } = await import("@/lib/security");
    const fb = encryptCredential({ t: regA.tenant.id, u: regA.user.id, p: "meta", f: [], token: "X", exp: Date.now() + 60_000 });
    await rejectsWith(() => WhatsAppSignupService.listNumbers(ctxA, fb), "WHATSAPP_LOGIN_REQUIRED");
  });

  await runTest("the picker lists only numbers of accounts Meta says the token was granted on, without tokens", async () => {
    const calls = fakeMeta({ numbers });
    let listed;
    try {
      listed = await WhatsAppSignupService.listNumbers(ctxA, pendingA);
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual(listed.numbers.map((n) => [n.id, n.waba_id, n.state]), [["60001", "111", "NOT_CONNECTED"], ["60002", "111", "NOT_CONNECTED"]]);
    assert.ok(!calls.some((c) => c.url.pathname.includes("/999/")), "an account not granted is never queried");
    assert.ok(!JSON.stringify(listed).includes("BUSINESS_TOKEN"));
  });

  await runTest("a number the sign-in doesn't reach is refused and nothing is saved", async () => {
    const before = JSON.stringify([db.getConnectors(regA.tenant.id), db.getConnectedChannels(regA.tenant.id)]);
    fakeMeta({ numbers });
    try {
      await assert.rejects(() => WhatsAppSignupService.connectNumber(ctxA, pendingA, { phone_number_id: "69999" }), (e: unknown) => e instanceof AppError && e.statusCode === 400);
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(JSON.stringify([db.getConnectors(regA.tenant.id), db.getConnectedChannels(regA.tenant.id)]), before);
  });

  await runTest("connecting with the PIN subscribes the account, registers the number, and stores no token on the channel", async () => {
    const calls = fakeMeta({ numbers });
    let r;
    try {
      r = await WhatsAppSignupService.connectNumber(ctxA, pendingA, { phone_number_id: "60001", pin: "123456" });
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual([r.outcome, r.webhooks_subscribed, r.registered], ["CONNECTED", true, true]);
    assert.ok(calls.some((c) => c.method === "POST" && c.url.pathname.endsWith("/111/subscribed_apps")));
    const reg = calls.find((c) => c.url.pathname.endsWith("/60001/register"))!;
    assert.ok(reg.body.includes("pin=123456") && reg.body.includes("messaging_product=whatsapp"));
    const channel = db.findConnectedChannelsByProviderId("WHATSAPP", "60001")[0];
    const resource = db.findConnectionResource(regA.tenant.id, String(channel.resource_id))!;
    assert.deepStrictEqual([resource.kind, resource.status, resource.metadata.waba_id, resource.token_encrypted], ["WA_NUMBER", "ACTIVE", "111", undefined]);
    assert.ok(!JSON.stringify(channel).includes("BUSINESS_TOKEN"));
    const creds = ChannelService.getDecryptedCredentials(channel);
    assert.deepStrictEqual([creds.accessToken, creds.phoneNumberId, creds.businessAccountId], ["BUSINESS_TOKEN", "60001", "111"]);
    const audit = db.getAuditLogsByTenant(regA.tenant.id, 200).logs;
    assert.ok(!JSON.stringify(audit).includes("123456"), "the PIN is never stored");
  });

  await runTest("without a PIN the number is saved as not registered (truthful), and register isn't called", async () => {
    const pending = await signUp(ctxA);
    const calls = fakeMeta({ numbers });
    let r;
    try {
      r = await WhatsAppSignupService.connectNumber(ctxA, pending, { phone_number_id: "60002" });
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual([r.outcome, r.registered], ["CONNECTED_NOT_REGISTERED", null]);
    assert.ok(!calls.some((c) => c.url.pathname.endsWith("/register")));
  });

  await runTest("a refused registration is reported and the number needs attention", async () => {
    const pending = await signUp(ctxA);
    fakeMeta({ numbers, registerFails: true });
    let r;
    try {
      r = await WhatsAppSignupService.connectNumber(ctxA, pending, { phone_number_id: "60002", pin: "000000" });
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual([r.outcome, r.registered], ["CONNECTED_NEEDS_ATTENTION", false]);
    const channel = db.findConnectedChannelsByProviderId("WHATSAPP", "60002")[0];
    assert.strictEqual(db.findConnectionResource(regA.tenant.id, String(channel.resource_id))?.status, "NEEDS_ATTENTION");
    assert.strictEqual(channel.status, "PENDING_SETUP", "not shown as active while it can't receive");
    assert.ok(channel.error_message?.includes("not registered"));
    assert.ok(!channel.error_message?.includes("000000"), "no PIN in the stored error");
  });

  await runTest("a number connected in workspace A is refused for workspace B; A keeps it", async () => {
    const pendingB = await signUp(ctxB, "8002");
    fakeMeta({ numbers, userId: "8002" });
    try {
      const listed = await WhatsAppSignupService.listNumbers(ctxB, pendingB);
      assert.strictEqual(listed.numbers.find((n) => n.id === "60001")?.state, "IN_ANOTHER_WORKSPACE");
      const r = await WhatsAppSignupService.connectNumber(ctxB, pendingB, { phone_number_id: "60001" });
      assert.strictEqual(r.outcome, "IN_ANOTHER_WORKSPACE");
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual(db.findConnectedChannelsByProviderId("WHATSAPP", "60001").map((c) => c.tenant_id), [regA.tenant.id]);
  });

  await runTest("the manual channel route refuses WhatsApp (ownership can't be proven with a pasted token)", async () => {
    const { POST } = await import("@/app/api/v1/social/channels/route");
    const { token } = await AuthService.login(regB.user.email, "Password12345!");
    const res = await POST(new Request("https://shop.example.com/api/v1/social/channels", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ type: "WHATSAPP", name: "Squat", provider_account_id: "60009", credentials: { accessToken: "x", phoneNumberId: "60009" } }),
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.findConnectedChannelsByProviderId("WHATSAPP", "60009").length, 0);
  });

  await runTest("a WhatsApp channel without its own secret never accepts events signed with the platform secret", async () => {
    const { WebhookIngressService } = await import("@/domains/social/webhooks/webhook-ingress.service");
    const at = new Date().toISOString();
    db.createConnectedChannel({
      id: `chn_wa_legacy_${stamp}`, tenant_id: regB.tenant.id, type: "WHATSAPP", name: "Legacy", status: "ACTIVE",
      provider_account_id: "60010", credentials_encrypted: (await import("@/lib/security")).encryptCredential({ accessToken: "x", phoneNumberId: "60010" }),
      configuration: {}, created_at: at, updated_at: at,
    });
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "111", changes: [{ field: "messages", value: { metadata: { phone_number_id: "60010" }, messages: [{ from: "8801700000000", id: "wamid.1", timestamp: "1", type: "text", text: { body: "hi" } }] } }] }] });
    const sig = `sha256=${crypto.createHmac("sha256", process.env.META_APP_SECRET as string).update(body).digest("hex")}`;
    await assert.rejects(() => WebhookIngressService.handleWebhook("WHATSAPP", body, sig, {}));
  });

  await runTest("a pasted-token WhatsApp channel for a number held as a resource elsewhere is refused", async () => {
    await assert.rejects(
      () => ChannelService.connectChannel(ctxB, { type: "WHATSAPP", name: "Squat", provider_account_id: "60001", credentials: { accessToken: "x", phoneNumberId: "60001" } }),
      (e: unknown) => e instanceof AppError && e.statusCode === 409
    );
  });

  await runTest("Connector Hub refuses pasted WhatsApp credentials (USE_SIGN_IN)", async () => {
    await assert.rejects(
      () => ConnectorService.saveConnector(ctxA, { provider_id: "whatsapp_cloud", credentials: { phone_number_id: "1", waba_id: "2", permanent_access_token: "x" } }),
      (e: unknown) => e instanceof AppError && /USE_SIGN_IN/.test(e.message)
    );
  });

  await runTest("a failed webhook subscription is reported and the number isn't shown as active", async () => {
    const pending = await signUp(ctxA);
    fakeMeta({ numbers, subscribeFails: true });
    let r;
    try {
      r = await WhatsAppSignupService.connectNumber(ctxA, pending, { phone_number_id: "60002", pin: "123456" });
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual([r.outcome, r.webhooks_subscribed], ["CONNECTED_NEEDS_ATTENTION", false]);
    assert.strictEqual(db.findConnectedChannelsByProviderId("WHATSAPP", "60002")[0].status, "PENDING_SETUP");
  });

  await runTest("the activate route refuses a malformed PIN", async () => {
    const { POST: activate } = await import("@/app/api/v1/connections/[provider]/activate/route");
    const { token } = await AuthService.login(regA.user.email, "Password12345!");
    for (const pin of ["12345", "1234567", "12a456"]) {
      const res = await activate(new Request("https://shop.example.com/api/v1/connections/whatsapp/activate", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", cookie: `cos_wa_pending=${encodeURIComponent(pendingA)}` },
        body: JSON.stringify({ phone_number_id: "60001", pin }),
      }), { params: Promise.resolve({ provider: "whatsapp" }) });
      assert.strictEqual(res.status, 400, pin);
    }
  });

  await runTest("Meta's deauthorize covers WhatsApp connections: the number stops and its webhooks are refused", async () => {
    const channel = db.findConnectedChannelsByProviderId("WHATSAPP", "60001")[0];
    assert.ok(handleMetaDeauthorize("8001") >= 1);
    assert.throws(() => ChannelService.getDecryptedCredentials(channel), (e: unknown) => e instanceof AppError && e.code === "CHANNEL_CREDENTIALS_INVALID");
    const { WebhookIngressService } = await import("@/domains/social/webhooks/webhook-ingress.service");
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "111", changes: [{ field: "messages", value: { metadata: { phone_number_id: "60001" }, messages: [{ from: "8801700000001", id: "wamid.2", timestamp: "1", type: "text", text: { body: "hi" } }] } }] }] });
    const sig = `sha256=${crypto.createHmac("sha256", process.env.META_APP_SECRET as string).update(body).digest("hex")}`;
    await assert.rejects(() => WebhookIngressService.handleWebhook("WHATSAPP", body, sig, {}));
  });

  await runTest("disconnecting a WhatsApp connection unsubscribes its account from the platform app", async () => {
    const pending = await signUp(ctxB, "8050");
    fakeMeta({ wabas: ["222"], numbers: { "222": [{ id: "60050", display_phone_number: "+880 1711-000050", verified_name: "B" }] }, userId: "8050" });
    let connectionId = "";
    try {
      await WhatsAppSignupService.connectNumber(ctxB, pending, { phone_number_id: "60050", pin: "123456" });
      const channel = db.findConnectedChannelsByProviderId("WHATSAPP", "60050")[0];
      connectionId = db.findConnectionResource(regB.tenant.id, String(channel.resource_id))!.connection_id;
    } finally {
      setOutboundTransportForTesting(null);
    }
    const calls = fakeMeta({});
    try {
      assert.ok(await ConnectorService.deleteConnector(ctxB, connectionId));
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.ok(calls.some((c) => c.method === "DELETE" && c.url.pathname.endsWith("/222/subscribed_apps")), "account 222 unsubscribed");
    assert.strictEqual(db.findConnectedChannelsByProviderId("WHATSAPP", "60050").length, 0);
  });

  console.log(`\n${ANSI_BOLD}[Telegram and couriers as connections]${ANSI_RESET}`);

  const BOT_A = "123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKKlll";
  const BOT_A2 = "987654321:ZZZyyyXXXwwwVVVuuuTTTsssRRRqqqPPPooo";

  await runTest("saving a Telegram bot records the connection and its bot resource, and the channel points at it", async () => {
    await ConnectorService.saveConnector(ctxA, { provider_id: "telegram", credentials: { bot_token: BOT_A } });
    const connector = db.findConnectorByProvider(regA.tenant.id, "telegram")!;
    assert.deepStrictEqual([connector.auth_method, connector.owner_user_id], ["bot_token", regA.user.id]);
    const res = db.getConnectionResources(regA.tenant.id, connector.id);
    assert.deepStrictEqual(res.map((r) => [r.kind, r.external_id, r.status]), [["TELEGRAM_BOT", "123456789", "ACTIVE"]]);
    assert.ok(!JSON.stringify(res).includes(BOT_A), "the bot token stays in the connector only");
    const channel = db.getConnectedChannels(regA.tenant.id).find((c) => c.connector_id === connector.id)!;
    assert.strictEqual(channel.resource_id, res[0].id);
  });

  await runTest("another workspace can't save the same bot", async () => {
    await assert.rejects(() => ConnectorService.saveConnector(ctxB, { provider_id: "telegram", credentials: { bot_token: BOT_A } }));
    assert.strictEqual(db.getConnectionResources(regB.tenant.id).filter((r) => r.kind === "TELEGRAM_BOT").length, 0);
  });

  await runTest("changing the bot token frees the old bot", async () => {
    await ConnectorService.saveConnector(ctxA, { provider_id: "telegram", credentials: { bot_token: BOT_A2 } });
    assert.deepStrictEqual(db.findLiveConnectionResourcesByExternalId("TELEGRAM_BOT", "123456789"), []);
    assert.deepStrictEqual(db.findLiveConnectionResourcesByExternalId("TELEGRAM_BOT", "987654321").map((r) => r.tenant_id), [regA.tenant.id]);
  });

  await runTest("a courier connector records its store as a resource", async () => {
    await ConnectorService.saveConnector(ctxA, {
      provider_id: "pathao",
      credentials: { client_id: "cid", client_secret: "sec", username: "m@shop.test", password: "pw", store_id: "12345", environment: "PRODUCTION" },
    });
    const connector = db.findConnectorByProvider(regA.tenant.id, "pathao")!;
    assert.strictEqual(connector.auth_method, "api_key");
    assert.deepStrictEqual(db.getConnectionResources(regA.tenant.id, connector.id).map((r) => [r.kind, r.external_id]), [["COURIER_STORE", "12345"]]);
  });

  console.log(`\n${ANSI_BOLD}Results: ${passedCount} passed, ${failedCount} failed${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
