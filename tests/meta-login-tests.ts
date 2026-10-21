// @ts-ignore
import assert from "assert";
import crypto from "crypto";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { MetaLoginService, readCookie } from "@/domains/social/meta/meta-login.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";
import { decryptCredential, encryptCredential as encryptCredentialSync, signOAuthState, signStepUpToken } from "@/lib/security";
import { PERMISSIONS } from "@/lib/permissions";
import { AppError, ForbiddenError } from "@/lib/errors";
import { POST as connectChannelRoute } from "@/app/api/v1/social/channels/route";
import { resolveMetaReadCredentials } from "@/domains/social/insights/meta-graph-reader";
import { OAuthBroker } from "@/domains/connectors/auth/oauth-broker";
import { POST as startRoute } from "@/app/api/v1/connections/[provider]/start/route";
import { GET as callbackRoute } from "@/app/api/v1/connections/[provider]/callback/route";
import { POST as activateRoute } from "@/app/api/v1/connections/[provider]/activate/route";
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

const ALL_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "business_management",
  "ads_read",
];

/** A fake Graph API. `subscribeFails` makes /subscribed_apps refuse. Records every call. */
function fakeMeta(opts: {
  pages: Array<Record<string, unknown>>;
  granted?: string[];
  subscribeFails?: boolean;
  adAccounts?: Array<Record<string, unknown>>;
  adsDenied?: boolean;
  /** What /debug_token says about the user token. */
  debug?: { user_id?: string; app_id?: string; is_valid?: boolean; scopes?: string[]; expires_at?: number };
}) {
  const calls: Array<{ url: URL; body: string }> = [];
  setOutboundTransportForTesting(async (raw, options) => {
    const url = new URL(raw.toString());
    calls.push({ url, body: String(options.body ?? "") });
    const json = (status: number, body: unknown) => ({ status, headers: {}, body: JSON.stringify(body), truncated: false, durationMs: 1 });
    if (url.pathname.endsWith("/oauth/access_token")) {
      if (url.searchParams.get("grant_type") === "fb_exchange_token") return json(200, { access_token: "LONG_USER_TOKEN" });
      return url.searchParams.get("code") === "good_code" ? json(200, { access_token: "SHORT_USER_TOKEN" }) : json(400, { error: { code: 100, message: "bad code" } });
    }
    if (url.pathname.endsWith("/debug_token")) {
      return json(200, {
        data: {
          is_valid: true,
          app_id: process.env.META_APP_ID,
          user_id: "7001",
          scopes: ALL_SCOPES,
          expires_at: Math.floor(Date.now() / 1000) + 60 * 86400,
          ...opts.debug,
        },
      });
    }
    if (url.pathname.endsWith("/me/accounts")) return json(200, { data: opts.pages });
    if (url.pathname.endsWith("/me/adaccounts")) {
      return opts.adsDenied ? json(403, { error: { code: 200, message: "ads_read not granted" } }) : json(200, { data: opts.adAccounts ?? [] });
    }
    if (url.pathname.endsWith("/me/permissions")) {
      return json(200, { data: (opts.granted ?? ALL_SCOPES).map((p) => ({ permission: p, status: "granted" })) });
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
    const { url, nonce } = await MetaLoginService.start(ctxA, ["ads"]);
    const u = new URL(url);
    assert.strictEqual(u.hostname, "www.facebook.com");
    assert.strictEqual(u.searchParams.get("client_id"), "1234567890");
    assert.strictEqual(u.searchParams.get("redirect_uri"), "https://shop.example.com/api/v1/connections/meta/callback");
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
    const state = await signOAuthState({ tenantId: regA.tenant.id, userId: regA.user.id, nonce: "n1", provider: "meta", features: [] });
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

  console.log(`\n${ANSI_BOLD}[Ad account for Ad Manager]${ANSI_RESET}`);

  const adAccounts = [
    { id: "act_55500011", account_id: "55500011", name: "Dhaka Threads Ads", currency: "BDT", account_status: 1 },
    { id: "act_55500022", account_id: "55500022", name: "Old Ads", currency: "USD", account_status: 2 },
  ];

  await runTest("Connect ads asks for ads_read; a plain sign-in doesn't", async () => {
    const ads = await MetaLoginService.start(ctxA, ["ads"]);
    const plain = await MetaLoginService.start(ctxA);
    assert.ok(new URL(ads.url).searchParams.get("scope")?.split(",").includes("ads_read"));
    assert.ok(!new URL(plain.url).searchParams.get("scope")?.split(",").includes("ads_read"));
  });

  await runTest("the Page list also lists the user's ad accounts (ids and names, no token)", async () => {
    fakeMeta({ pages, adAccounts });
    try {
      const listed = await MetaLoginService.listPages(ctxA, pendingA);
      assert.deepStrictEqual(listed.ad_accounts.map((a) => [a.id, a.active]), [["55500011", true], ["55500022", false]]);
      assert.ok(!JSON.stringify(listed).includes("LONG_USER_TOKEN"), "the user token never leaves the server");
    } finally {
      setOutboundTransportForTesting(null);
    }
  });

  await runTest("without ads_read the ad account list is empty and the Pages still load", async () => {
    fakeMeta({ pages, adsDenied: true });
    try {
      const listed = await MetaLoginService.listPages(ctxA, pendingA);
      assert.strictEqual(listed.ad_accounts.length, 0);
      assert.strictEqual(listed.pages.length, 2);
    } finally {
      setOutboundTransportForTesting(null);
    }
  });

  await runTest("an ad account the Facebook user can't read is refused and nothing is saved", async () => {
    const before = ChannelService.getDecryptedCredentials(db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1)[0]);
    fakeMeta({ pages, adAccounts });
    try {
      await assert.rejects(() => MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [PAGE_1], include_instagram: false, ad_account_id: "99999999" }));
    } finally {
      setOutboundTransportForTesting(null);
    }
    const after = ChannelService.getDecryptedCredentials(db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1)[0]);
    assert.deepStrictEqual(after, before);
  });

  await runTest("a picked ad account becomes the workspace's ad account resource and Ad Manager reads it", async () => {
    fakeMeta({ pages, adAccounts });
    try {
      const [r] = await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [PAGE_1], include_instagram: true, ad_account_id: "act_55500011" });
      assert.strictEqual(r.facebook, "RECONNECTED");
    } finally {
      setOutboundTransportForTesting(null);
    }
    const fb = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1)[0];
    const creds = ChannelService.getDecryptedCredentials(fb);
    assert.strictEqual(creds.adsToken, undefined, "the user token is not copied onto channels");
    assert.strictEqual(creds.adAccountId, undefined, "the ad account is a resource, not a channel field");
    const ads = db.getConnectionResources(regA.tenant.id).filter((r) => r.kind === "AD_ACCOUNT" && r.status === "ACTIVE");
    assert.deepStrictEqual(ads.map((r) => [r.external_id, r.metadata.currency]), [["55500011", "BDT"]]);
    const connection = db.findConnectorById(regA.tenant.id, ads[0].connection_id);
    assert.deepStrictEqual([creds.accessToken, connection?.owner_user_id], ["PAGE_TOKEN_1", regA.user.id]);
    const read = resolveMetaReadCredentials(regA.tenant.id)!;
    assert.deepStrictEqual([read.source, read.adAccountId, read.adsToken, read.pageToken], ["CHANNEL", "55500011", "LONG_USER_TOKEN", "PAGE_TOKEN_1"]);
    assert.strictEqual(resolveMetaReadCredentials(regB.tenant.id)?.adAccountId ?? "", "", "another workspace never sees it");
  });

  await runTest("reconnecting without picking an ad account keeps the one already chosen", async () => {
    fakeMeta({ pages: [{ ...pages[0], access_token: "PAGE_TOKEN_1_V3" }], adAccounts });
    try {
      await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [PAGE_1], include_instagram: false });
    } finally {
      setOutboundTransportForTesting(null);
    }
    const creds = ChannelService.getDecryptedCredentials(db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1)[0]);
    assert.strictEqual(creds.accessToken, "PAGE_TOKEN_1_V3");
    assert.strictEqual(resolveMetaReadCredentials(regA.tenant.id)?.adAccountId, "55500011");
  });

  await runTest("picking another ad account replaces the first (one ad account per workspace)", async () => {
    fakeMeta({ pages, adAccounts });
    try {
      await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [PAGE_1], include_instagram: false, ad_account_id: "55500022" });
    } finally {
      setOutboundTransportForTesting(null);
    }
    const live = db.getConnectionResources(regA.tenant.id).filter((r) => r.kind === "AD_ACCOUNT" && r.status !== "DETACHED");
    assert.deepStrictEqual(live.map((r) => r.external_id), ["55500022"]);
    assert.strictEqual(resolveMetaReadCredentials(regA.tenant.id)?.adAccountId, "55500022");
    // back to the first for the tests below
    fakeMeta({ pages, adAccounts });
    try {
      await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [PAGE_1], include_instagram: false, ad_account_id: "55500011" });
    } finally {
      setOutboundTransportForTesting(null);
    }
  });

  console.log(`\n${ANSI_BOLD}[Ads only on request (ADR-119 P3)]${ANSI_RESET}`);

  let plainPending = "";
  await runTest("a plain sign-in doesn't ask ads_read, and its picker lists no ad accounts and calls no ads API", async () => {
    const { url, nonce } = await MetaLoginService.start(ctxA);
    assert.ok(!new URL(url).searchParams.get("scope")!.split(",").includes("ads_read"));
    const calls = fakeMeta({ pages, adAccounts, granted: ALL_SCOPES.filter((x) => x !== "ads_read") });
    try {
      plainPending = await MetaLoginService.completeCallback(ctxA, { code: "good_code", state: new URL(url).searchParams.get("state")! }, nonce);
      const listed = await MetaLoginService.listPages(ctxA, plainPending);
      assert.deepStrictEqual(listed.ads, { requested: false, granted: false });
      assert.deepStrictEqual(listed.ad_accounts, []);
      assert.deepStrictEqual(listed.missing_permissions, [], "ads_read is never reported as a missing required permission");
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.ok(!calls.some((c) => c.url.pathname.endsWith("/me/adaccounts")));
  });

  await runTest("Connect ads declined: the picker says ads weren't granted, Pages still listed", async () => {
    fakeMeta({ pages, adAccounts, granted: ALL_SCOPES.filter((x) => x !== "ads_read") });
    try {
      const listed = await MetaLoginService.listPages(ctxA, pendingA);
      assert.deepStrictEqual(listed.ads, { requested: true, granted: false });
      assert.deepStrictEqual(listed.ad_accounts, []);
      assert.strictEqual(listed.pages.length, 2);
    } finally {
      setOutboundTransportForTesting(null);
    }
  });

  await runTest("Connect ads can save only an ad account, without touching Pages", async () => {
    const before = JSON.stringify(db.getConnectedChannels(regA.tenant.id).map((c) => [c.id, c.updated_at]));
    fakeMeta({ pages, adAccounts });
    let results;
    try {
      results = await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [], include_instagram: false, ad_account_id: "55500022" });
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual(results, []);
    assert.strictEqual(resolveMetaReadCredentials(regA.tenant.id)?.adAccountId, "55500022");
    assert.strictEqual(JSON.stringify(db.getConnectedChannels(regA.tenant.id).map((c) => [c.id, c.updated_at])), before);
    // back to the first account for the tests below
    fakeMeta({ pages, adAccounts });
    try {
      await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [], include_instagram: false, ad_account_id: "55500011" });
    } finally {
      setOutboundTransportForTesting(null);
    }
  });

  await runTest("activating with neither a Page nor an ad account is refused", async () => {
    await assert.rejects(
      () => MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [], include_instagram: false }),
      (e: unknown) => e instanceof AppError && e.statusCode === 400
    );
    const { POST: activate } = await import("@/app/api/v1/connections/[provider]/activate/route");
    const { token } = await AuthService.login(regA.user.email, "Password12345!");
    const res = await activate(new Request("https://shop.example.com/api/v1/connections/meta/activate", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", cookie: `cos_meta_pending=${encodeURIComponent(pendingA)}` },
      body: JSON.stringify({ page_ids: [] }),
    }), { params: Promise.resolve({ provider: "meta" }) });
    assert.strictEqual(res.status, 400);
  });

  console.log(`\n${ANSI_BOLD}[Resources (ADR-119 P2)]${ANSI_RESET}`);

  await runTest("connecting saves the Page and its Instagram account as resources holding the Page token", () => {
    const fb = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1)[0];
    const ig = db.findConnectedChannelsByProviderId("INSTAGRAM", "17841400001")[0];
    const page = db.findConnectionResource(regA.tenant.id, String(fb.resource_id));
    const igRes = db.findConnectionResource(regA.tenant.id, String(ig.resource_id));
    assert.deepStrictEqual([page?.kind, page?.external_id, page?.status], ["FB_PAGE", PAGE_1, "ACTIVE"]);
    assert.deepStrictEqual([igRes?.kind, igRes?.external_id, igRes?.metadata.username], ["IG_ACCOUNT", "17841400001", "dhakathreads"]);
    assert.ok(page?.token_encrypted && !page.token_encrypted.includes("PAGE_TOKEN"), "Page token stored encrypted");
    assert.strictEqual(page?.connection_id, igRes?.connection_id);
  });

  await runTest("a channel uses its resource's token (the resource wins over the channel's own copy)", async () => {
    const fb = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1)[0];
    const { encryptCredential } = await import("@/lib/security");
    db.updateConnectionResource(regA.tenant.id, String(fb.resource_id), { token_encrypted: encryptCredential({ token: "PAGE_TOKEN_FROM_RESOURCE" }) });
    assert.strictEqual(ChannelService.getDecryptedCredentials(fb).accessToken, "PAGE_TOKEN_FROM_RESOURCE");
    db.updateConnectionResource(regA.tenant.id, String(fb.resource_id), { token_encrypted: encryptCredential({ token: "PAGE_TOKEN_1_V3" }) });
  });

  await runTest("a Page that failed its webhook subscription is a resource that needs attention", () => {
    const fb2 = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_2)[0];
    assert.strictEqual(db.findConnectionResource(regA.tenant.id, String(fb2.resource_id))?.status, "NEEDS_ATTENTION");
  });

  await runTest("deleting a channel frees its Page: another workspace can then connect it", async () => {
    const fb2 = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_2)[0];
    const resourceId = String(fb2.resource_id);
    assert.ok(db.deleteConnectedChannel(regA.tenant.id, fb2.id));
    assert.strictEqual(db.findConnectionResource(regA.tenant.id, resourceId)?.status, "DETACHED");
    const { url, nonce } = await MetaLoginService.start(ctxB);
    fakeMeta({ pages, debug: { user_id: "7100" } });
    try {
      const pendingB = await MetaLoginService.completeCallback(ctxB, { code: "good_code", state: new URL(url).searchParams.get("state")! }, nonce);
      const [r] = await MetaLoginService.connectPages(ctxB, pendingB, { page_ids: [PAGE_2], include_instagram: false });
      assert.ok(r.facebook === "CONNECTED" || r.facebook === "CONNECTED_NO_WEBHOOKS", r.facebook);
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.deepStrictEqual(db.findLiveConnectionResourcesByExternalId("FB_PAGE", PAGE_2).map((r) => r.tenant_id), [regB.tenant.id]);
    // B gives it back so later tests start from the same state
    const fbB = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_2)[0];
    db.deleteConnectedChannel(regB.tenant.id, fbB.id);
  });

  await runTest("the connect route rejects a malformed ad account id", async () => {
    const { POST: activate } = await import("@/app/api/v1/connections/[provider]/activate/route");
    const { token: tokenA } = await AuthService.login(regA.user.email, "Password12345!");
    for (const bad of ["../me", "act_abc", "1234", "1".repeat(26)]) {
      const res = await activate(new Request("https://shop.example.com/api/v1/connections/meta/activate", {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json", cookie: `cos_meta_pending=${encodeURIComponent(pendingA)}` },
        body: JSON.stringify({ page_ids: [PAGE_1], ad_account_id: bad }),
      }), { params: Promise.resolve({ provider: "meta" }) });
      assert.strictEqual(res.status, 400, bad);
    }
  });

  console.log(`\n${ANSI_BOLD}[OAuth broker and connection (ADR-119 P1)]${ANSI_RESET}`);

  const metaConnections = (tenantId: string) =>
    db.getConnectors(tenantId).filter((c) => c.provider_id === "meta_graph" && c.auth_method === "oauth2");

  await runTest("scopes come from the manifest: ads_read only when the ads feature is asked", async () => {
    const plain = new URL((await OAuthBroker.start(ctxA, "meta", [])).url).searchParams.get("scope")!.split(",");
    const withAds = new URL((await OAuthBroker.start(ctxA, "meta", ["ads"])).url).searchParams.get("scope")!.split(",");
    assert.ok(plain.includes("pages_messaging") && !plain.includes("ads_read"));
    assert.ok(withAds.includes("ads_read"));
    await assert.rejects(() => OAuthBroker.start(ctxA, "meta", ["everything"]), (e: unknown) => e instanceof AppError && e.statusCode === 400);
  });

  await runTest("an unknown provider has no sign-in", async () => {
    await assert.rejects(() => OAuthBroker.start(ctxA, "myspace", []), (e: unknown) => e instanceof AppError && e.statusCode === 404);
  });

  await runTest("a state signed for another provider is refused", async () => {
    const state = await signOAuthState({ tenantId: regA.tenant.id, userId: regA.user.id, nonce: "n2", provider: "google", features: [] });
    await rejectsWith(() => MetaLoginService.completeCallback(ctxA, { code: "good_code", state }, "n2"), "META_STATE_INVALID");
  });

  await runTest("a pending sign-in for another provider is refused", async () => {
    const { encryptCredential } = await import("@/lib/security");
    const other = encryptCredential({ t: regA.tenant.id, u: regA.user.id, p: "google", f: [], token: "LONG_USER_TOKEN", exp: Date.now() + 60_000 });
    await rejectsWith(() => MetaLoginService.listPages(ctxA, other), "META_LOGIN_REQUIRED");
  });

  await runTest("connecting saved one connection: owner, Meta's scopes and expiry, token encrypted and masked", async () => {
    const [connection] = metaConnections(regA.tenant.id);
    assert.ok(connection, "connection saved by the earlier connects");
    assert.strictEqual(metaConnections(regA.tenant.id).length, 1, "reconnects by the same Facebook user reuse it");
    assert.deepStrictEqual(
      [connection.external_account_id, connection.owner_user_id, connection.connection_status, connection.health_status],
      ["7001", regA.user.id, "ACTIVE", "HEALTHY"]
    );
    assert.deepStrictEqual(connection.scopes_granted, ALL_SCOPES);
    assert.ok(connection.token_expires_at && Date.parse(connection.token_expires_at) > Date.now());
    assert.ok(!JSON.stringify(connection).includes("LONG_USER_TOKEN"), "token only encrypted");
    assert.notStrictEqual(connection.credentials_masked.access_token, "LONG_USER_TOKEN");
    assert.strictEqual(OAuthBroker.connectionToken(connection), "LONG_USER_TOKEN");
    const audits = db.getAuditLogsByTenant(regA.tenant.id, 1000).logs;
    assert.ok(!JSON.stringify(audits).includes("LONG_USER_TOKEN"), "no token in the audit log");
  });

  await runTest("another Facebook user in the same workspace gets their own connection", async () => {
    fakeMeta({ pages, debug: { user_id: "7002", scopes: ["pages_show_list", "pages_messaging"] } });
    try {
      await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: [PAGE_1], include_instagram: false });
    } finally {
      setOutboundTransportForTesting(null);
    }
    const second = metaConnections(regA.tenant.id).find((c) => c.external_account_id === "7002");
    assert.ok(second);
    assert.strictEqual(second.health_code, "SCOPES_MISSING", "fewer scopes than asked are recorded, not assumed");
    assert.strictEqual(metaConnections(regA.tenant.id).length, 2);
  });

  await runTest("a token Meta says is invalid or for another app is refused, and nothing is saved", async () => {
    for (const debug of [{ is_valid: false }, { app_id: "999" }]) {
      const before = JSON.stringify([db.getConnectors(regB.tenant.id), db.getConnectedChannels(regB.tenant.id)]);
      const { url, nonce } = await MetaLoginService.start(ctxB);
      fakeMeta({ pages: [{ id: "4004", name: "B page", access_token: "PAGE_TOKEN_B", tasks: ["MESSAGING"] }], debug });
      try {
        const pendingB = await MetaLoginService.completeCallback(ctxB, { code: "good_code", state: new URL(url).searchParams.get("state")! }, nonce);
        await rejectsWith(() => MetaLoginService.connectPages(ctxB, pendingB, { page_ids: ["4004"], include_instagram: false }), "META_TOKEN_INVALID");
      } finally {
        setOutboundTransportForTesting(null);
      }
      assert.strictEqual(JSON.stringify([db.getConnectors(regB.tenant.id), db.getConnectedChannels(regB.tenant.id)]), before);
    }
  });

  await runTest("Engagement keeps using the Page token, never the sign-in user token", () => {
    const read = resolveMetaReadCredentials(regA.tenant.id)!;
    assert.strictEqual(read.source, "CHANNEL");
    assert.notStrictEqual(read.pageToken, "LONG_USER_TOKEN");
  });

  console.log(`\n${ANSI_BOLD}[Connection routes]${ANSI_RESET}`);

  const { token: tokenA } = await AuthService.login(regA.user.email, "Password12345!");
  const call = (path: string, init: RequestInit = {}) =>
    new Request(`https://shop.example.com/api/v1/connections/${path}`, {
      ...init,
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
  const params = (provider: string) => ({ params: Promise.resolve({ provider }) });
  const setCookie = (res: Response, name: string) => {
    const header = res.headers.get("set-cookie") ?? "";
    const match = header.match(new RegExp(`${name}=([^;]*)`));
    return { value: match ? decodeURIComponent(match[1]) : undefined, header };
  };

  let routeNonce: string | undefined;
  let routeState = "";
  await runTest("POST /connections/meta/start returns the dialog URL and a nonce cookie on /api/v1", async () => {
    const res = await startRoute(call("meta/start", { method: "POST", body: JSON.stringify({ features: ["ads"] }) }), params("meta"));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    routeState = new URL(body.data.url).searchParams.get("state")!;
    const cookie = setCookie(res, "cos_meta_oauth");
    routeNonce = cookie.value;
    assert.ok(routeNonce);
    assert.ok(/Path=\/api\/v1/i.test(cookie.header) && /HttpOnly/i.test(cookie.header));
  });

  await runTest("start refuses unknown providers, unknown fields and unknown features", async () => {
    assert.strictEqual((await startRoute(call("x/start", { method: "POST", body: "{}" }), params("x"))).status, 404);
    assert.strictEqual((await startRoute(call("meta/start", { method: "POST", body: JSON.stringify({ tenant_id: regB.tenant.id }) }), params("meta"))).status, 400);
    assert.strictEqual((await startRoute(call("meta/start", { method: "POST", body: JSON.stringify({ features: ["billing"] }) }), params("meta"))).status, 400);
  });

  let routePending: string | undefined;
  await runTest("GET /connections/meta/callback writes nothing and sends the browser to the picker with a pending cookie", async () => {
    const before = JSON.stringify([db.getConnectors(regA.tenant.id), db.getConnectedChannels(regA.tenant.id)]);
    fakeMeta({ pages });
    let res: Response;
    try {
      res = await callbackRoute(
        call(`meta/callback?code=good_code&state=${encodeURIComponent(routeState)}`, { headers: { cookie: `cos_meta_oauth=${encodeURIComponent(routeNonce!)}` } }),
        params("meta")
      );
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(res.status, 303);
    assert.strictEqual(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search, "/connector/facebook?step=pick");
    routePending = setCookie(res, "cos_meta_pending").value;
    assert.ok(routePending);
    assert.strictEqual(JSON.stringify([db.getConnectors(regA.tenant.id), db.getConnectedChannels(regA.tenant.id)]), before);
  });

  await runTest("a callback without the nonce cookie goes back with an error code only", async () => {
    const res = await callbackRoute(call(`meta/callback?code=good_code&state=${encodeURIComponent(routeState)}`), params("meta"));
    assert.strictEqual(new URL(res.headers.get("location")!).search, "?error=META_STATE_INVALID");
  });

  await runTest("POST /connections/meta/activate connects, and clears the pending cookie; extra fields are refused", async () => {
    const cookie = { cookie: `cos_meta_pending=${encodeURIComponent(routePending!)}` };
    const bad = await activateRoute(call("meta/activate", { method: "POST", headers: cookie, body: JSON.stringify({ page_ids: [PAGE_1], adsToken: "x" }) }), params("meta"));
    assert.strictEqual(bad.status, 400);
    fakeMeta({ pages });
    let res: Response;
    try {
      res = await activateRoute(call("meta/activate", { method: "POST", headers: cookie, body: JSON.stringify({ page_ids: [PAGE_1], include_instagram: false }) }), params("meta"));
    } finally {
      setOutboundTransportForTesting(null);
    }
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.results[0].facebook, "RECONNECTED");
    assert.ok(!JSON.stringify(body).includes("TOKEN"), "no token in the response");
    assert.ok(/cos_meta_pending=;/.test(res.headers.get("set-cookie") ?? ""), "pending cookie cleared");
  });

  await runTest("a replayed callback (nonce cookie already cleared) is refused", async () => {
    const res = await callbackRoute(call(`meta/callback?code=good_code&state=${encodeURIComponent(routeState)}`), params("meta"));
    assert.strictEqual(new URL(res.headers.get("location")!).search, "?error=META_STATE_INVALID");
    assert.ok(!/cos_meta_pending=[^;]/.test(res.headers.get("set-cookie") ?? ""), "no pending cookie");
  });

  await runTest("a role without social.channel.manage gets 403 from start, pending resources and activate", async () => {
    const { signSessionToken } = await import("@/lib/security");
    const id = `usr_meta_analyst_${stamp}`;
    const email = `${id}@example.com`;
    const at = new Date().toISOString();
    db.createUser({ id, email, name: "Analyst", password_hash: "!disabled", status: "ACTIVE", created_at: at, updated_at: at });
    db.createMembership({ id: `mem_${id}`, tenant_id: regA.tenant.id, user_id: id, role: "ANALYST", created_at: at, updated_at: at });
    const token = await signSessionToken({ userId: id, tenantId: regA.tenant.id, role: "ANALYST", email, name: "Analyst" });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const { GET: pendingRoute } = await import("@/app/api/v1/connections/[provider]/pending/resources/route");
    assert.strictEqual((await startRoute(new Request("https://x.test/api/v1/connections/meta/start", { method: "POST", headers, body: "{}" }), params("meta"))).status, 403);
    assert.strictEqual((await pendingRoute(new Request("https://x.test/api/v1/connections/meta/pending/resources", { headers }), params("meta"))).status, 403);
    assert.strictEqual((await activateRoute(new Request("https://x.test/api/v1/connections/meta/activate", { method: "POST", headers, body: JSON.stringify({ page_ids: [PAGE_1] }) }), params("meta"))).status, 403);
  });

  console.log(`\n${ANSI_BOLD}[Connector Hub and sign-in connections]${ANSI_RESET}`);

  await runTest("the hub refuses a pasted-credential save for Meta, and the sign-in connection is unchanged", async () => {
    const { ConnectorService } = await import("@/domains/connectors/service");
    const before = JSON.stringify([metaConnections(regA.tenant.id), db.getConnectedChannels(regA.tenant.id)]);
    await assert.rejects(
      () => ConnectorService.saveConnector(ctxA, { provider_id: "meta_graph", credentials: { access_token: "x•", page_id: "9", ad_account_id: "act_12345" } }),
      (e: unknown) => e instanceof AppError && /USE_SIGN_IN/.test(e.message)
    );
    assert.strictEqual(JSON.stringify([metaConnections(regA.tenant.id), db.getConnectedChannels(regA.tenant.id)]), before);
    assert.strictEqual(db.findConnectorByProvider(regA.tenant.id, "meta_graph"), undefined, "the hub never sees the sign-in row as its connector");
  });

  await runTest("rotate-secret is refused on a sign-in connection", async () => {
    const { ConnectorService } = await import("@/domains/connectors/service");
    const [connection] = metaConnections(regA.tenant.id);
    await assert.rejects(() => ConnectorService.rotateSecret(ctxA, connection.id), (e: unknown) => e instanceof AppError && e.statusCode === 400);
  });

  await runTest("a disabled sign-in connection gives Ad Manager no token", async () => {
    const { ConnectorService } = await import("@/domains/connectors/service");
    const ad = db.getConnectionResources(regA.tenant.id).find((r) => r.kind === "AD_ACCOUNT" && r.status === "ACTIVE")!;
    const connectionId = ad.connection_id;
    await ConnectorService.setEnabled(ctxA, connectionId, false);
    try {
      assert.strictEqual(resolveMetaReadCredentials(regA.tenant.id)?.adsToken ?? "", "");
    } finally {
      await ConnectorService.setEnabled(ctxA, connectionId, true);
    }
    assert.strictEqual(resolveMetaReadCredentials(regA.tenant.id)?.adsToken, "LONG_USER_TOKEN");
  });

  await runTest("a channel naming another workspace's connection gets no ads token", () => {
    const [connectionA] = metaConnections(regA.tenant.id);
    const at = new Date().toISOString();
    const channel = db.createConnectedChannel({
      id: `chn_forged_${stamp}`,
      tenant_id: regB.tenant.id,
      type: "FACEBOOK_MESSENGER",
      name: "B page",
      status: "ACTIVE",
      provider_account_id: "6006",
      credentials_encrypted: encryptCredentialSync({ accessToken: "PAGE_TOKEN_B", pageId: "6006", adAccountId: "55500011", adsConnectionId: connectionA.id }),
      configuration: {},
      created_at: at,
      updated_at: at,
    });
    try {
      const read = resolveMetaReadCredentials(regB.tenant.id)!;
      assert.strictEqual(read.pageToken, "PAGE_TOKEN_B");
      assert.strictEqual(read.adsToken, "", "A's connection is not found from B");
      assert.strictEqual(read.adAccountId, "", "no ad account without its token");
    } finally {
      db.deleteConnectedChannel(regB.tenant.id, channel.id);
    }
  });

  console.log(`\n${ANSI_BOLD}[Resources: review fixes (P2)]${ANSI_RESET}`);

  await runTest("a detached Page resource keeps no token", () => {
    const detached = db.getConnectionResources(regA.tenant.id).filter((r) => r.kind === "FB_PAGE" && r.status === "DETACHED");
    assert.ok(detached.length > 0);
    for (const r of detached) assert.strictEqual(r.token_encrypted, undefined, r.id);
  });

  await runTest("a channel whose resource is gone fails closed instead of using its own token copy", () => {
    const at = new Date().toISOString();
    const ch = db.createConnectedChannel({
      id: `chn_orphan_${stamp}`,
      tenant_id: regA.tenant.id,
      type: "FACEBOOK_MESSENGER",
      name: "Orphan",
      status: "ACTIVE",
      provider_account_id: "8001",
      credentials_encrypted: encryptCredentialSync({ accessToken: "OLD_COPY", pageId: "8001" }),
      resource_id: "cres_missing",
      configuration: {},
      created_at: at,
      updated_at: at,
    });
    try {
      assert.throws(() => ChannelService.getDecryptedCredentials(ch), (e: unknown) => e instanceof AppError && e.code === "CHANNEL_CREDENTIALS_INVALID");
    } finally {
      db.deleteConnectedChannel(regA.tenant.id, ch.id);
    }
  });

  await runTest("a Page another workspace holds as a resource can't be connected with a pasted token", async () => {
    const [connA] = metaConnections(regA.tenant.id);
    const at = new Date().toISOString();
    db.createConnectionResource({
      id: `cres_held_${stamp}`, tenant_id: regA.tenant.id, connection_id: connA.id, kind: "FB_PAGE", external_id: "8100",
      name: "Held", metadata: {}, status: "ACTIVE", created_at: at, updated_at: at,
    });
    await assert.rejects(
      () => ChannelService.connectChannel(ctxB, { type: "FACEBOOK_MESSENGER", name: "Squat", provider_account_id: "8100", credentials: { accessToken: "x" } }),
      (e: unknown) => e instanceof AppError && e.statusCode === 409
    );
  });

  await runTest("a bound ad account that can't be used doesn't fall back to an ad account recorded on a channel", async () => {
    const { ConnectorService } = await import("@/domains/connectors/service");
    const ad = db.getConnectionResources(regA.tenant.id).find((r) => r.kind === "AD_ACCOUNT" && r.status === "ACTIVE")!;
    const other = metaConnections(regA.tenant.id).find((c) => c.id !== ad.connection_id)!;
    const fb = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1)[0];
    const creds = ChannelService.getDecryptedCredentials(fb);
    db.updateConnectedChannel(regA.tenant.id, fb.id, {
      credentials_encrypted: encryptCredentialSync({ ...creds, adAccountId: "99999999", adsConnectionId: other.id }),
    });
    await ConnectorService.setEnabled(ctxA, ad.connection_id, false);
    try {
      const read = resolveMetaReadCredentials(regA.tenant.id)!;
      assert.deepStrictEqual([read.adAccountId, read.adsToken], ["", ""]);
    } finally {
      await ConnectorService.setEnabled(ctxA, ad.connection_id, true);
      db.updateConnectedChannel(regA.tenant.id, fb.id, { credentials_encrypted: encryptCredentialSync(creds) });
    }
  });

  await runTest("if saving a Page fails part way, its result is FAILED, not CONNECTED", async () => {
    const original = ChannelService.connectChannel;
    (ChannelService as unknown as { connectChannel: typeof original }).connectChannel = async (ctx, payload) => {
      if (payload.type === "INSTAGRAM") throw new AppError("PLAN_LIMIT_REACHED", "Channel limit reached.", 402);
      return original.call(ChannelService, ctx, payload);
    };
    const fresh = { id: "1003", name: "Third Page", access_token: "PAGE_TOKEN_3", tasks: ["MESSAGING"], instagram_business_account: { id: "17841400003", username: "third" } };
    fakeMeta({ pages: [...pages, fresh] });
    try {
      const [r] = await MetaLoginService.connectPages(ctxA, pendingA, { page_ids: ["1003"], include_instagram: true });
      assert.deepStrictEqual([r.facebook, r.instagram], ["FAILED", "FAILED"]);
    } finally {
      setOutboundTransportForTesting(null);
      (ChannelService as unknown as { connectChannel: typeof original }).connectChannel = original;
    }
  });

  await runTest("disconnecting the sign-in connection removes the channels its Pages serve", async () => {
    const { ConnectorService } = await import("@/domains/connectors/service");
    const fb = db.findConnectedChannelsByProviderId("FACEBOOK_MESSENGER", PAGE_1)[0];
    const connectionId = db.findConnectionResource(regA.tenant.id, String(fb.resource_id))!.connection_id;
    const served = db.getConnectedChannels(regA.tenant.id).filter((c) => {
      const r = c.resource_id ? db.findConnectionResource(regA.tenant.id, c.resource_id) : undefined;
      return r?.connection_id === connectionId;
    });
    assert.ok(served.length >= 1);
    assert.ok(await ConnectorService.deleteConnector(ctxA, connectionId));
    for (const c of served) assert.strictEqual(db.getConnectedChannels(regA.tenant.id).some((x) => x.id === c.id), false, c.id);
    assert.strictEqual(db.getConnectionResources(regA.tenant.id, connectionId).length, 0);
    assert.strictEqual(db.findLiveConnectionResourcesByExternalId("FB_PAGE", PAGE_1).length, 0, "the Page is free again");
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
