// @ts-ignore
import assert from "assert";
import crypto from "crypto";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { MetaLoginService, readCookie } from "@/domains/social/meta/meta-login.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";
import { decryptCredential, signMetaOAuthState, signStepUpToken } from "@/lib/security";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError, ForbiddenError } from "@/lib/errors";
import { POST as connectChannelRoute } from "@/app/api/v1/social/channels/route";
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

function contextFor(reg: Awaited<ReturnType<typeof AuthService.registerTenantWithOwner>>, permissions = Object.values(PERMISSIONS)): RequestContext {
  return {
    requestId: `req_${crypto.randomUUID().slice(0, 8)}`,
    traceId: `trc_${crypto.randomUUID().slice(0, 8)}`,
    user: { id: reg.user.id, email: reg.user.email, name: reg.user.name, status: "ACTIVE" },
    tenant: { id: reg.tenant.id, name: reg.tenant.name, slug: reg.tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions,
    timestamp: new Date().toISOString(),
  };
}

const rejectsWith = async (fn: () => Promise<unknown>, code: string) => {
  await assert.rejects(fn, (err: unknown) => err instanceof AppError && err.code === code);
};

/** A fake Graph API. `subscribeFails` makes /subscribed_apps refuse. Records every call. */
function fakeMeta(opts: { pages: Array<Record<string, unknown>>; granted?: string[]; subscribeFails?: boolean }) {
  const calls: Array<{ url: URL; body: string }> = [];
  setOutboundTransportForTesting(async (raw, options) => {
    const url = new URL(raw.toString());
    calls.push({ url, body: String(options.body ?? "") });
    const json = (status: number, body: unknown) => ({ status, headers: {}, body: JSON.stringify(body), truncated: false, durationMs: 1 });
    if (url.pathname.endsWith("/oauth/access_token")) {
      if (url.searchParams.get("grant_type") === "fb_exchange_token") return json(200, { access_token: "LONG_USER_TOKEN" });
      return url.searchParams.get("code") === "good_code" ? json(200, { access_token: "SHORT_USER_TOKEN" }) : json(400, { error: { code: 100, message: "bad code" } });
    }
    if (url.pathname.endsWith("/me/accounts")) return json(200, { data: opts.pages });
    if (url.pathname.endsWith("/me/permissions")) {
      return json(200, { data: (opts.granted ?? []).map((p) => ({ permission: p, status: "granted" })) });
    }
    if (url.pathname.endsWith("/subscribed_apps")) {
      return opts.subscribeFails ? json(403, { error: { code: 200, message: "no permission" } }) : json(200, { success: true });
    }
    return json(404, { error: { code: 803, message: "unknown" } });
  });
  return calls;
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   CONNECT WITH FACEBOOK SUITE                       ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();
  process.env.META_APP_ID = "1234567890";
  process.env.META_APP_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.APP_URL = "https://shop.example.com";

  const stamp = Date.now();
  const regA = await AuthService.registerTenantWithOwner({ workspaceName: `FB Shop A ${stamp}`, name: "Owner A", email: `fb-a-${stamp}@example.com`, password: "Password12345!" });
  const regB = await AuthService.registerTenantWithOwner({ workspaceName: `FB Shop B ${stamp}`, name: "Owner B", email: `fb-b-${stamp}@example.com`, password: "Password12345!" });
  const ctxA = contextFor(regA);
  const ctxB = contextFor(regB);

  const PAGE_1 = "1001";
  const PAGE_2 = "1002";
  const pages = [
    { id: PAGE_1, name: "Dhaka Threads", access_token: "PAGE_TOKEN_1", tasks: ["MANAGE", "MESSAGING"], instagram_business_account: { id: "17841400001", username: "dhakathreads" } },
    { id: PAGE_2, name: "Second Page", access_token: "PAGE_TOKEN_2", tasks: ["MESSAGING"] },
  ];

  console.log(`${ANSI_BOLD}[Start and callback]${ANSI_RESET}`);

  let pendingA = "";
  await runTest("start returns a Facebook dialog URL with the app id, redirect URI, scopes and a signed state", async () => {
    const { url, nonce } = await MetaLoginService.start(ctxA);
    const u = new URL(url);
    assert.strictEqual(u.hostname, "www.facebook.com");
    assert.strictEqual(u.searchParams.get("client_id"), "1234567890");
    assert.strictEqual(u.searchParams.get("redirect_uri"), "https://shop.example.com/api/v1/social/meta/oauth/callback");
    assert.ok(u.searchParams.get("scope")?.includes("pages_messaging"));
    assert.ok(u.searchParams.get("scope")?.includes("instagram_manage_comments"));
    const state = u.searchParams.get("state")!;
    fakeMeta({ pages });
    try {
      pendingA = await MetaLoginService.completeCallback(ctxA, { code: "good_code", state }, nonce);
    } finally {
      setOutboundTransportForTesting(null);
    }
    const pending = decryptCredential<{ t: string; u: string; token: string }>(pendingA);
    assert.deepStrictEqual([pending.t, pending.u, pending.token], [regA.tenant.id, regA.user.id, "LONG_USER_TOKEN"]);
  });

  await runTest("a role without social.channel.manage can't start", async () => {
    await assert.rejects(() => MetaLoginService.start(contextFor(regA, [PERMISSIONS.SOCIAL_CHANNEL_READ])), ForbiddenError);
  });

  await runTest("without META_APP_ID the flow says it isn't set up", async () => {
    const saved = process.env.META_APP_ID;
    delete process.env.META_APP_ID;
    try {
      await rejectsWith(() => MetaLoginService.start(ctxA), "META_LOGIN_NOT_CONFIGURED");
    } finally {
      process.env.META_APP_ID = saved;
    }
  });

  await runTest("the callback refuses another browser (nonce cookie missing or different)", async () => {
    const { url, nonce } = await MetaLoginService.start(ctxA);
    const state = new URL(url).searchParams.get("state")!;
    await rejectsWith(() => MetaLoginService.completeCallback(ctxA, { code: "good_code", state }, undefined), "META_STATE_INVALID");
    await rejectsWith(() => MetaLoginService.completeCallback(ctxA, { code: "good_code", state }, `${nonce}x`), "META_STATE_INVALID");
  });

  await runTest("a state started in workspace A can't be completed by workspace B's user", async () => {
    const { url, nonce } = await MetaLoginService.start(ctxA);
    const state = new URL(url).searchParams.get("state")!;
    await rejectsWith(() => MetaLoginService.completeCallback(ctxB, { code: "good_code", state }, nonce), "META_STATE_INVALID");
  });

  await runTest("another kind of signed token can't be used as a state", async () => {
    const stepUp = await signStepUpToken(regA.user.id);
    await rejectsWith(() => MetaLoginService.completeCallback(ctxA, { code: "good_code", state: stepUp }, "n"), "META_STATE_INVALID");
  });

  await runTest("a cancelled Facebook dialog is reported as cancelled", async () => {
    const state = await signMetaOAuthState({ tenantId: regA.tenant.id, userId: regA.user.id, nonce: "n1" });
    await rejectsWith(() => MetaLoginService.completeCallback(ctxA, { error: "access_denied", state }, "n1"), "META_DENIED");
  });

  console.log(`\n${ANSI_BOLD}[Pick and connect Pages]${ANSI_RESET}`);

  await runTest("the Page list has no tokens and reports permissions Facebook didn't grant", async () => {
    fakeMeta({ pages, granted: ["pages_show_list", "pages_messaging"] });
    try {
      const listed = await MetaLoginService.listPages(ctxA, pendingA);
      assert.strictEqual(listed.pages.length, 2);
      assert.ok(!JSON.stringify(listed).includes("PAGE_TOKEN"), "page tokens must never leave the server");
      assert.strictEqual(listed.pages[0].instagram?.username, "dhakathreads");
      assert.ok(listed.missing_permissions.includes("instagram_manage_comments"));
    } finally {
      setOutboundTransportForTesting(null);
    }
  });

  await runTest("workspace B can't use workspace A's pending sign-in cookie", async () => {
    await rejectsWith(() => MetaLoginService.listPages(ctxB, pendingA), "META_LOGIN_REQUIRED");
    await rejectsWith(() => MetaLoginService.connectPages(ctxB, pendingA, { page_ids: [PAGE_1], include_instagram: true }), "META_LOGIN_REQUIRED");
  });

  await runTest("connecting subscribes the Page and creates Facebook + Instagram channels with Meta's Page token", async () => {
    const calls = fakeMeta({ pages });
    let results;
    try {
      results = await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [PAGE_1], include_instagram: true });
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(results.length, 1);
    assert.deepStrictEqual([results[0].facebook, results[0].instagram, results[0].webhooks_subscribed], ["CONNECTED", "CONNECTED", true]);
    const sub = calls.find((c) => c.url.pathname.endsWith(`/${PAGE_1}/subscribed_apps`))!;
    assert.ok(sub.body.includes("subscribed_fields=feed%2Cmessages"));
    assert.ok(sub.body.includes("appsecret_proof="), "every Graph call carries appsecret_proof");
    const fb = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1)[0];
    const ig = db.findConnectedChannelsByProviderId("INSTAGRAM", "17841400001")[0];
    assert.strictEqual(fb.tenant_id, regA.tenant.id);
    assert.strictEqual(ig.tenant_id, regA.tenant.id);
    assert.strictEqual(fb.configuration.auto_reply_enabled, true);
    assert.strictEqual(ChannelService.getDecryptedCredentials(fb).accessToken, "PAGE_TOKEN_1");
    assert.strictEqual(ChannelService.getDecryptedCredentials(ig).accessToken, "PAGE_TOKEN_1");
  });

  await runTest("connecting again refreshes the token instead of adding a duplicate channel", async () => {
    fakeMeta({ pages: [{ ...pages[0], access_token: "PAGE_TOKEN_1_NEW" }] });
    try {
      const [r] = await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [PAGE_1], include_instagram: false });
      assert.strictEqual(r.facebook, "RECONNECTED");
    } finally {
      setOutboundTransportForTesting(null);
    }
    const fbs = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1);
    assert.strictEqual(fbs.length, 1);
    assert.strictEqual(ChannelService.getDecryptedCredentials(fbs[0]).accessToken, "PAGE_TOKEN_1_NEW");
  });

  await runTest("a Page already in workspace A is refused for workspace B, and A keeps it", async () => {
    const { url, nonce } = await MetaLoginService.start(ctxB);
    fakeMeta({ pages });
    try {
      const pendingB = await MetaLoginService.completeCallback(ctxB, { code: "good_code", state: new URL(url).searchParams.get("state")! }, nonce);
      const listed = await MetaLoginService.listPages(ctxB, pendingB);
      assert.strictEqual(listed.pages.find((p) => p.id === PAGE_1)?.facebook, "IN_ANOTHER_WORKSPACE");
      const [r] = await MetaLoginService.connectPages(ctxB, pendingB, { page_ids: [PAGE_1], include_instagram: true });
      assert.strictEqual(r.facebook, "IN_ANOTHER_WORKSPACE");
    } finally {
      setOutboundTransportForTesting(null);
    }
    const fbs = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1);
    assert.deepStrictEqual(fbs.map((c) => c.tenant_id), [regA.tenant.id]);
  });

  await runTest("a Page id the Facebook user doesn't manage is not connected", async () => {
    fakeMeta({ pages });
    try {
      await assert.rejects(() => MetaLoginService.connectPages(ctxA, pendingA, { page_ids: ["9999"], include_instagram: true }));
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", "9999").length, 0);
  });

  await runTest("if Facebook refuses the webhook subscription the result says so (not reported as receiving)", async () => {
    fakeMeta({ pages, subscribeFails: true });
    try {
      const [r] = await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [PAGE_2], include_instagram: true });
      assert.strictEqual(r.facebook, "CONNECTED_NO_WEBHOOKS");
      assert.strictEqual(r.webhooks_subscribed, false);
      assert.ok(r.error?.includes("Webhooks not subscribed"));
    } finally {
      setOutboundTransportForTesting(null);
    }
    const channel = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_2)[0];
    assert.ok(channel.error_message?.includes("webhook subscription"), "the stored channel records the problem too");
  });

  await runTest("listing or connecting Pages needs social.channel.manage", async () => {
    const readOnly = contextFor(regA, [PERMISSIONS.SOCIAL_CHANNEL_READ]);
    await assert.rejects(() => MetaLoginService.listPages(readOnly, pendingA), ForbiddenError);
    await assert.rejects(() => MetaLoginService.connectPages(readOnly, pendingA, { page_ids: [PAGE_1], include_instagram: true }), ForbiddenError);
  });

  console.log(`\n${ANSI_BOLD}[Manual token route: Page ownership (shared-app hijack)]${ANSI_RESET}`);

  const { token: tokenB } = await AuthService.login(regB.user.email, "Password12345!");
  const manualConnect = (body: unknown) =>
    connectChannelRoute(new Request("https://shop.example.com/api/v1/social/channels", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));

  await runTest("a pasted token that doesn't belong to the Page is refused, and nothing is saved", async () => {
    setOutboundTransportForTesting(async () => ({ status: 200, headers: {}, body: JSON.stringify({ id: "5555" }), truncated: false, durationMs: 1 }));
    try {
      const res = await manualConnect({ type: "FACEBOOK_MESSENGER", name: "Squat", provider_account_id: "7777", credentials: { accessToken: "EAAB-attacker" } });
      assert.strictEqual(res.status, 400);
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", "7777").length, 0);
  });

  await runTest("a token Facebook rejects is refused", async () => {
    setOutboundTransportForTesting(async () => ({ status: 400, headers: {}, body: JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }), truncated: false, durationMs: 1 }));
    try {
      const res = await manualConnect({ type: "INSTAGRAM", name: "Squat IG", provider_account_id: "17841499999", credentials: { accessToken: "junk" } });
      assert.strictEqual(res.status, 400);
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(db.findConnectedChannelsByProviderId("INSTAGRAM", "17841499999").length, 0);
  });

  await runTest("a pasted Page token that Facebook says is that Page is accepted", async () => {
    setOutboundTransportForTesting(async () => ({ status: 200, headers: {}, body: JSON.stringify({ id: "8888" }), truncated: false, durationMs: 1 }));
    try {
      const res = await manualConnect({ type: "FACEBOOK_MESSENGER", name: "Own page", provider_account_id: "8888", credentials: { accessToken: "EAAB-owner" } });
      assert.strictEqual(res.status, 201);
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", "8888")[0]?.tenant_id, regB.tenant.id);
  });

  await runTest("unknown fields in the manual connect body (tenant_id) are rejected", async () => {
    const res = await manualConnect({ type: "WEBSITE_CHAT", name: "Web", provider_account_id: "web_x", credentials: {}, tenant_id: regA.tenant.id });
    assert.strictEqual(res.status, 400);
  });

  await runTest("an expired pending sign-in is refused", async () => {
    const { encryptCredential } = await import("@/lib/security");
    const expired = encryptCredential({ t: regA.tenant.id, u: regA.user.id, token: "LONG_USER_TOKEN", exp: Date.now() - 1 });
    await rejectsWith(() => MetaLoginService.listPages(ctxA, expired), "META_LOGIN_REQUIRED");
  });

  await runTest("readCookie reads one cookie by exact name", () => {
    const req = new Request("https://x.test/", { headers: { cookie: "a=1; cos_meta_oauth=abc%3D; cos_meta_oauth_x=no" } });
    assert.strictEqual(readCookie(req, "cos_meta_oauth"), "abc=");
    assert.strictEqual(readCookie(req, "missing"), undefined);
  });

  console.log(`\n${ANSI_BOLD}Results: ${passedCount} passed, ${failedCount} failed${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
