// @ts-nocheck
/**
 * Engagement Analysis + Ad Manager: Meta Graph parsing with a stubbed transport, metric-name fallback, honest "not
 * connected" reports, CommerceOS ad-to-order attribution, tenant isolation, permissions, read-only GETs and the AI coach.
 */
import assert from "assert";
declare const process: { exit(code?: number): void; env: Record<string, string | undefined> };

import { db } from "@/infrastructure/db";
import { encryptCredential } from "@/lib/security";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";
import { ROLE_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";
import { ForbiddenError } from "@/lib/errors";
import { EngagementAnalysisService } from "@/domains/social/insights/engagement-analysis.service";
import { AdPerformanceService } from "@/domains/social/insights/ad-performance.service";
import { InsightsCoachService } from "@/domains/social/insights/insights-coach.service";
import { clearMetaInsightsCacheForTesting } from "@/domains/social/insights/meta-graph-reader";
import { modelRouter } from "@/domains/ai/providers/model-router";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    clearMetaInsightsCacheForTesting();
    await fn();
    console.log(`  \x1b[32m✓ PASS\x1b[0m - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  \x1b[31m✗ FAIL\x1b[0m - ${name}`);
    console.error(err);
    failed++;
  } finally {
    setOutboundTransportForTesting(null);
  }
}

function ctx(tenantId: string, role = "OWNER", permissions = ROLE_PERMISSIONS[role]) {
  return {
    requestId: `req_${tenantId}`,
    traceId: `trc_${tenantId}`,
    user: { id: `usr_${tenantId}`, email: `${tenantId}@example.com`, name: "Test", status: "ACTIVE" },
    tenant: { id: tenantId, name: tenantId, slug: tenantId, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role,
    permissions,
    timestamp: new Date().toISOString(),
  };
}

function addMetaConnector(tenantId: string, extra: Record<string, string> = {}) {
  const now = new Date().toISOString();
  db.saveConnector({
    id: `conn_meta_${tenantId}`,
    tenant_id: tenantId,
    provider_id: "meta_graph",
    category: "SOCIAL_ADS",
    name: "Meta",
    credentials_encrypted: encryptCredential({ page_id: "111", page_access_token: "PAGE_TOKEN", app_id: "1", app_secret: "s", ...extra }),
    credentials_masked: {},
    configuration: {},
    status: "ACTIVE",
    health_status: "HEALTHY",
    enabled: true,
    created_at: now,
    updated_at: now,
  });
}

/** Seeds an order where the order queries read it: the in-memory store, or Postgres when orders are not hydrated. */
async function seedOrder(order: Record<string, unknown>) {
  const client = db.getSqlClient();
  if (client && !db.isCollectionHydrated("orders")) {
    await client.query(
      `INSERT INTO commerceos.orders (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
      [order.id, order.tenant_id, order.created_at, JSON.stringify(order)]
    );
    return;
  }
  db.data.orders.push(order);
  db.markDirty();
  await db.flush();
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const json = (status: number, body: unknown) => ({ status, headers: {}, body: JSON.stringify(body), truncated: false, durationMs: 1 });

/** A fake graph.facebook.com. `fbInsightsSupported` = false makes the first (impressions) metric set fail with code 100. */
function fakeMeta(opts: { fbInsightsSupported?: boolean; urls?: string[] } = {}) {
  setOutboundTransportForTesting(async (url, options) => {
    opts.urls?.push(url.toString());
    assert.strictEqual(url.hostname, "graph.facebook.com", "only Meta is called");
    assert.ok(String(options.headers?.Authorization).startsWith("Bearer "), "token goes in a header, not the URL");
    assert.ok(!url.searchParams.has("access_token"));
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const fields = url.searchParams.get("fields") ?? "";

    if (path === "/111" && fields.includes("instagram_business_account")) return json(200, { instagram_business_account: { id: "999" } });
    if (path === "/111") return json(200, { name: "Shop BD", followers_count: 5400 });
    if (path === "/111/published_posts") {
      if (fields.includes("post_impressions") && opts.fbInsightsSupported === false) {
        return json(400, { error: { code: 100, message: "(#100) The value must be a valid insights metric" } });
      }
      const insights = fields.includes("post_impressions")
        ? { data: [{ name: "post_impressions", values: [{ value: 2000 }] }, { name: "post_impressions_unique", values: [{ value: 1000 }] }] }
        : fields.includes("post_media_view")
          ? { data: [{ name: "post_media_view", values: [{ value: 1800 }] }, { name: "post_total_media_view_unique", values: [{ value: 900 }] }] }
          : undefined;
      return json(200, {
        data: [
          { id: "111_1", message: "Eid collection", created_time: daysAgo(2), permalink_url: "https://facebook.com/1", attachments: { data: [{ media_type: "photo" }] }, reactions: { summary: { total_count: 40 } }, comments: { summary: { total_count: 25 } }, shares: { count: 5 }, insights },
          { id: "111_2", message: "Old post", created_time: daysAgo(60), reactions: { summary: { total_count: 1 } }, comments: { summary: { total_count: 0 } } },
        ],
      });
    }
    if (path === "/999" && fields.includes("username")) return json(200, { username: "shopbd", followers_count: 1200 });
    if (path === "/999/media") {
      return json(200, {
        data: [
          { id: "ig1", caption: "Reel", media_type: "VIDEO", media_product_type: "REELS", timestamp: daysAgo(1), like_count: 80, comments_count: 10, insights: { data: [{ name: "views", values: [{ value: 5000 }] }, { name: "reach", values: [{ value: 3000 }] }, { name: "saved", values: [{ value: 12 }] }, { name: "shares", values: [{ value: 8 }] }] } },
        ],
      });
    }
    if (path === "/act_5550001" ) return json(200, { name: "Shop BD Ads", currency: "BDT", account_status: 1 });
    if (path === "/act_5550001/campaigns") return json(200, { data: [{ id: "c1", effective_status: "ACTIVE" }, { id: "c2", effective_status: "ACTIVE" }] });
    if (path === "/act_5550001/insights") {
      const level = url.searchParams.get("level");
      if (url.searchParams.get("time_increment") === "1") {
        return json(200, { data: [{ date_start: "2026-10-01", spend: "1000", impressions: "20000", clicks: "300", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "40" }] }] });
      }
      if (level === "account") {
        return json(200, { data: [{ spend: "5000", impressions: "100000", reach: "40000", clicks: "1500", inline_link_clicks: "900", frequency: "2.5", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "200" }, { action_type: "omni_purchase", value: "20" }, { action_type: "purchase", value: "20" }], action_values: [{ action_type: "omni_purchase", value: "15000" }] }] });
      }
      return json(200, {
        data: [
          { campaign_id: "c1", campaign_name: "Eid Messages", objective: "OUTCOME_ENGAGEMENT", spend: "4000", impressions: "90000", clicks: "1450", frequency: "4.2", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "200" }, { action_type: "omni_purchase", value: "20" }], action_values: [{ action_type: "omni_purchase", value: "15000" }] },
          { campaign_id: "c2", campaign_name: "Dead Test", objective: "OUTCOME_TRAFFIC", spend: "1000", impressions: "10000", clicks: "50" },
        ],
      });
    }
    return json(404, { error: { code: 803, message: `unexpected ${path}` } });
  });
}

export async function run() {
  console.log("\n\x1b[1m Engagement Analysis & Ad Manager \x1b[0m\n");
  db.clearAllForTesting();
  const A = "tenant_eng_a";
  const B = "tenant_eng_b";

  await test("not connected: both reports say so and carry no Meta numbers", async () => {
    setOutboundTransportForTesting(async () => {
      throw new Error("no network call expected");
    });
    const eng = await EngagementAnalysisService.getReport(ctx(A), 30);
    assert.ok(eng.sources.every((s) => s.status === "NOT_CONNECTED"));
    assert.strictEqual(eng.totals.posts, 0);
    assert.strictEqual(eng.totals.impressions, null, "an unknown metric is null, never 0 or invented");
    const ads = await AdPerformanceService.getReport(ctx(A), 30);
    assert.strictEqual(ads.status, "NOT_CONNECTED");
    assert.strictEqual(ads.totals, null);
    assert.strictEqual(ads.commerce_roas, null);
  });

  await test("engagement: Facebook + Instagram posts parsed, out-of-range posts dropped", async () => {
    addMetaConnector(A);
    const urls: string[] = [];
    fakeMeta({ urls });
    const r = await EngagementAnalysisService.getReport(ctx(A), 30);
    assert.deepStrictEqual(r.sources.map((s) => s.status), ["LIVE", "LIVE"]);
    assert.strictEqual(r.posts.length, 2, "the 60-day-old post is outside a 30-day range");
    const fb = r.posts.find((p) => p.platform === "FACEBOOK");
    assert.strictEqual(fb.impressions, 2000);
    assert.strictEqual(fb.reach, 1000);
    assert.strictEqual(fb.engagements, 70);
    assert.strictEqual(fb.engagement_rate, 7);
    assert.strictEqual(fb.format, "PHOTO");
    const ig = r.posts.find((p) => p.platform === "INSTAGRAM");
    assert.strictEqual(ig.format, "REEL");
    assert.strictEqual(ig.views, 5000);
    assert.strictEqual(ig.impressions, null, "IG views are not relabelled as impressions");
    assert.strictEqual(ig.engagements, 80 + 10 + 8 + 12);
    assert.strictEqual(r.totals.likes, 120);
    assert.strictEqual(r.totals.comments, 35);
    assert.strictEqual(r.sources[0].followers, 5400);
    assert.strictEqual(r.sources[1].account_name, "@shopbd");
    assert.ok(r.timing.length >= 1);
    assert.ok(urls.every((u) => !u.includes("PAGE_TOKEN")), "the token never appears in a URL");
  });

  await test("engagement: an unsupported metric name falls back to the next set", async () => {
    fakeMeta({ fbInsightsSupported: false });
    const r = await EngagementAnalysisService.getReport(ctx(A), 30, { refresh: true });
    const fb = r.posts.find((p) => p.platform === "FACEBOOK");
    assert.strictEqual(fb.impressions, null);
    assert.strictEqual(fb.views, 1800);
    assert.strictEqual(fb.reach, 900);
  });

  await test("engagement: a Meta error is reported per source, not hidden", async () => {
    setOutboundTransportForTesting(async () => json(400, { error: { code: 190, message: "Error validating access token: redacted-token-value" } }));
    const r = await EngagementAnalysisService.getReport(ctx(A), 30, { refresh: true });
    assert.ok(r.sources.some((s) => s.status === "ERROR"));
    assert.ok(r.sources.every((s) => !String(s.message).includes("redacted-token-value")), "token-like text is not echoed");
  });

  await test("ads: metrics, ROAS and CommerceOS attribution; another tenant's orders are not counted", async () => {
    addMetaConnector(A, { ad_account_id: "act_5550001", ads_access_token: "ADS_TOKEN" });
    const now = new Date().toISOString();
    for (const [tenant, n] of [[A, 3], [B, 2]] as const) {
      for (let i = 0; i < n; i++) {
        db.data.conversations.push({
          id: `conv_${tenant}_${i}`, tenant_id: tenant, channel_id: "ch", channel_type: "FACEBOOK_MESSENGER", customer_id: `cus_${tenant}_${i}`,
          external_conversation_id: `x${i}`, status: "OPEN", priority: "NORMAL", mode: "HUMAN", automation_paused: false,
          last_message_at: daysAgo(5), unread_count: 0, tags: [], source: "FACEBOOK", source_campaign: "c1", metadata: {},
          created_at: daysAgo(5), updated_at: now,
        });
      }
      // The first customer orders after chatting; a cancelled order never counts
      await seedOrder({ id: `ord_${tenant}_1`, tenant_id: tenant, customer_id: `cus_${tenant}_0`, status: "DELIVERED", currency: "BDT", grand_total: 2500, created_at: daysAgo(3), updated_at: now });
      await seedOrder({ id: `ord_${tenant}_2`, tenant_id: tenant, customer_id: `cus_${tenant}_1`, status: "CANCELLED", currency: "BDT", grand_total: 9999, created_at: daysAgo(3), updated_at: now });
      // An order placed before the ad conversation is not credited to the ad
      await seedOrder({ id: `ord_${tenant}_3`, tenant_id: tenant, customer_id: `cus_${tenant}_0`, status: "DELIVERED", currency: "BDT", grand_total: 7777, created_at: daysAgo(9), updated_at: now });
    }

    const urls: string[] = [];
    fakeMeta({ urls });
    const r = await AdPerformanceService.getReport(ctx(A), 30);
    assert.strictEqual(r.status, "LIVE");
    assert.strictEqual(r.account.currency, "BDT");
    assert.strictEqual(r.totals.spend, 5000);
    assert.strictEqual(r.totals.messages_started, 200);
    assert.strictEqual(r.totals.purchases, 20, "overlapping purchase action types are not summed");
    assert.strictEqual(r.totals.purchase_value, 15000);
    assert.strictEqual(r.totals.roas, 3);
    assert.strictEqual(r.totals.cost_per_message, 25);
    assert.strictEqual(r.totals.ctr, 1.5);
    assert.strictEqual(r.campaigns[0].name, "Eid Messages");
    assert.strictEqual(r.campaigns[0].status, "ACTIVE");
    assert.strictEqual(r.daily.length, 1);

    assert.strictEqual(r.commerce.ad_conversations, 3, "only tenant A's conversations");
    assert.strictEqual(r.commerce.ad_customers, 3);
    assert.strictEqual(r.commerce.converted_customers, 1);
    assert.strictEqual(r.commerce.orders, 1);
    assert.strictEqual(r.commerce.revenue, 2500);
    assert.strictEqual(r.campaigns[0].commerce.orders, 1, "CommerceOS results join to the Meta campaign by id");
    assert.strictEqual(r.commerce_roas, 0.5);
    assert.ok(urls.some((u) => u.includes("/act_5550001/insights")));

    const ids = r.suggestions.map((s) => s.id);
    assert.ok(ids.includes("no-results-c2"), "a campaign that spent with no results is flagged");
    assert.ok(ids.includes("fatigue-c1"), "frequency over 3.5 is flagged");
    assert.ok(ids.includes("commerce-roas-low"));
    assert.ok(r.suggestions.every((s) => s.evidence.length > 0), "every suggestion carries its evidence");
  });

  await test("ads: a non-BDT ad account is never converted for CommerceOS ROAS", async () => {
    setOutboundTransportForTesting(async (url) => {
      if (url.pathname.endsWith("/act_5550001")) return json(200, { name: "USD acct", currency: "USD", account_status: 1 });
      if (url.pathname.endsWith("/insights")) return json(200, { data: [{ spend: "50", impressions: "1000", clicks: "10" }] });
      return json(200, { data: [] });
    });
    const r = await AdPerformanceService.getReport(ctx(A), 30, { refresh: true });
    assert.strictEqual(r.account.currency, "USD");
    assert.strictEqual(r.commerce_roas, null);
  });

  await test("permissions: roles without the read permission are refused", async () => {
    const noSocial = ROLE_PERMISSIONS.OWNER.filter((p) => p !== PERMISSIONS.SOCIAL_ANALYTICS_READ);
    const noMarketing = ROLE_PERMISSIONS.OWNER.filter((p) => p !== PERMISSIONS.MARKETING_READ);
    await assert.rejects(() => EngagementAnalysisService.getReport(ctx(A, "OWNER", noSocial), 30), ForbiddenError);
    await assert.rejects(() => AdPerformanceService.getReport(ctx(A, "OWNER", noMarketing), 30), ForbiddenError);
    const noAi = ROLE_PERMISSIONS.OWNER.filter((p) => p !== PERMISSIONS.AI_RUN);
    await assert.rejects(() => InsightsCoachService.advise(ctx(A, "OWNER", noAi), "ads", 30), ForbiddenError);
  });

  await test("GET routes write nothing to the store", async () => {
    addMetaConnector(A, { ad_account_id: "act_5550001", ads_access_token: "ADS_TOKEN" });
    fakeMeta();
    const before = JSON.stringify(db.data);
    await EngagementAnalysisService.getReport(ctx(A), 30, { refresh: true });
    await AdPerformanceService.getReport(ctx(A), 30, { refresh: true });
    assert.strictEqual(JSON.stringify(db.data), before);
  });

  await test("AI coach: sends aggregates only and labels the demo model", async () => {
    const previous = { ...process.env };
    modelRouter.configure({ ...process.env, LLM_BASE_URL: "", AI_DEMO_MODE: "1" });
    try {
      fakeMeta();
      const advice = await InsightsCoachService.advise(ctx(A), "ads", 30);
      assert.strictEqual(advice.scope, "ads");
      assert.strictEqual(advice.demo, true);
      assert.ok(typeof advice.advice === "string");
    } finally {
      modelRouter.configure(previous);
    }
  });

  await test("AI coach: refused while the workspace is paused by the platform; the model is not called", async () => {
    const original = db.getPlatformKillSwitches.bind(db);
    const chat = modelRouter.chatWithRouting;
    let called = 0;
    modelRouter.chatWithRouting = async () => {
      called++;
      throw new Error("must not be called");
    };
    db.getPlatformKillSwitches = () => [{ id: "ks_t", scope: "TENANT", target_id: A, is_active: true }];
    try {
      await assert.rejects(() => InsightsCoachService.advise(ctx(A), "ads", 30), (e) => /paused/i.test(e.message));
      assert.strictEqual(called, 0);
    } finally {
      db.getPlatformKillSwitches = original;
      modelRouter.chatWithRouting = chat;
    }
  });

  await test("AI coach prompt: aggregates only, no token or customer data, string fields flagged as untrusted", async () => {
    addMetaConnector(A, { ad_account_id: "act_5550001", ads_access_token: "ADS_TOKEN" });
    fakeMeta();
    const chat = modelRouter.chatWithRouting;
    let sent = "";
    modelRouter.chatWithRouting = async (_tier, messages) => {
      sent = messages.map((m) => m.content).join("\n");
      return { content: "- **Do X**", provider: "stub", demo: true, usage: {}, model: "m", latency_ms: 1, costUsd: 0, costBdt: 0, isFallback: false };
    };
    try {
      await InsightsCoachService.advise(ctx(A), "ads", 30);
      assert.ok(!sent.includes("PAGE_TOKEN") && !sent.includes("ADS_TOKEN"), "no token in the prompt");
      assert.ok(!sent.includes("cus_") && !sent.includes("ord_"), "no customer or order ids in the prompt");
      assert.ok(/untrusted data/i.test(sent), "the system prompt marks string fields as data");
      assert.ok(sent.includes("Eid Messages"));
    } finally {
      modelRouter.chatWithRouting = chat;
    }
  });

  await test("paging: a next link off graph.facebook.com is refused and never requested", async () => {
    const hosts: string[] = [];
    setOutboundTransportForTesting(async (url) => {
      hosts.push(url.hostname);
      const p = url.pathname.replace(/^\/v\d+\.\d+/, "");
      if (p === "/111") return json(200, { name: "Shop" });
      if (p === "/111/published_posts") return json(200, { data: [{ id: "a", created_time: daysAgo(1) }], paging: { next: "https://evil.example/steal" } });
      return json(200, { data: [] });
    });
    const r = await EngagementAnalysisService.getReport(ctx(A), 30);
    assert.ok(hosts.every((h) => h === "graph.facebook.com"));
    assert.strictEqual(r.sources.find((s) => s.platform === "FACEBOOK").status, "ERROR");
  });

  await test("links: javascript:, data: and non-Meta URLs from Meta become null", async () => {
    setOutboundTransportForTesting(async (url) => {
      const p = url.pathname.replace(/^\/v\d+\.\d+/, "");
      if (p === "/111") return json(200, { name: "Shop" });
      if (p === "/111/published_posts") {
        return json(200, {
          data: [
            { id: "x1", created_time: daysAgo(1), permalink_url: "javascript:alert(1)", full_picture: "data:text/html,hi" },
            { id: "x2", created_time: daysAgo(1), permalink_url: "https://evil.example/p" },
            { id: "x3", created_time: daysAgo(1), permalink_url: "https://www.facebook.com/111/posts/3" },
          ],
        });
      }
      return json(200, { data: [] });
    });
    const r = await EngagementAnalysisService.getReport(ctx(A), 30);
    const byId = Object.fromEntries(r.posts.map((p) => [p.id, p]));
    assert.strictEqual(byId.x1.permalink, null);
    assert.strictEqual(byId.x1.thumbnail_url, null);
    assert.strictEqual(byId.x2.permalink, null);
    assert.strictEqual(byId.x3.permalink, "https://www.facebook.com/111/posts/3");
  });

  await test("attribution: returned/refunded orders are not conversions; other-currency orders are not summed", async () => {
    const T = "tenant_eng_c";
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      db.data.conversations.push({
        id: `conv_c_${i}`, tenant_id: T, channel_id: "ch", channel_type: "FACEBOOK_MESSENGER", customer_id: `cus_c_${i}`, external_conversation_id: `c${i}`,
        status: "OPEN", priority: "NORMAL", mode: "HUMAN", automation_paused: false, last_message_at: daysAgo(5), unread_count: 0, tags: [], source: "FACEBOOK",
        source_ad: "ad9", metadata: {}, created_at: daysAgo(5), updated_at: now,
      });
    }
    await seedOrder({ id: "ord_c_1", tenant_id: T, customer_id: "cus_c_0", status: "RETURNED", currency: "BDT", grand_total: 1000, created_at: daysAgo(3), updated_at: now });
    await seedOrder({ id: "ord_c_2", tenant_id: T, customer_id: "cus_c_1", status: "REFUNDED", currency: "BDT", grand_total: 1000, created_at: daysAgo(3), updated_at: now });
    await seedOrder({ id: "ord_c_3", tenant_id: T, customer_id: "cus_c_2", status: "DELIVERED", currency: "USD", grand_total: 50, created_at: daysAgo(3), updated_at: now });
    const r = await AdPerformanceService.getReport(ctx(T), 30);
    assert.strictEqual(r.status, "NOT_CONNECTED");
    assert.strictEqual(r.commerce.ad_customers, 3);
    assert.strictEqual(r.commerce.orders, 0);
    assert.strictEqual(r.commerce.converted_customers, 0);
    assert.strictEqual(r.commerce.revenue, 0);
    assert.strictEqual(r.commerce.other_currency_orders, 1);
    assert.strictEqual(r.commerce.currency, "BDT");
  });

  await test("cache: refresh=1 within a minute reuses the report; a disconnected connector is never served the old one", async () => {
    addMetaConnector(A);
    const urls: string[] = [];
    fakeMeta({ urls });
    await EngagementAnalysisService.getReport(ctx(A), 30);
    const calls = urls.length;
    await EngagementAnalysisService.getReport(ctx(A), 30, { refresh: true });
    await Promise.all([1, 2, 3].map(() => EngagementAnalysisService.getReport(ctx(A), 30, { refresh: true })));
    assert.strictEqual(urls.length, calls, "no new Meta calls within the minute");
    const connector = db.findConnectorByProvider(A, "meta_graph");
    db.saveConnector({ ...connector, enabled: false, updated_at: new Date(Date.now() + 1000).toISOString() });
    const after = await EngagementAnalysisService.getReport(ctx(A), 30);
    assert.ok(after.sources.every((s) => s.status === "NOT_CONNECTED"));
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
