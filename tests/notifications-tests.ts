/**
 * Merchant notifications (owner alerts on Telegram): Settings → Notifications and the alerts bot.
 * No network: a fake transport stands in for api.telegram.org.
 * Run: node tests/ts-runner.cjs ./tests/notifications-tests.ts
 */
import assert from "assert";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { signSessionToken } from "@/lib/security";
import { setOutboundTransportForTesting } from "@/lib/outbound-http";
import { resetRateLimitsForTesting } from "@/lib/rate-limit";
import { alertsWebhookSecret, resetAlertsBotForTesting } from "@/domains/notifications/alerts-bot";
import { JobsService } from "@/domains/jobs/jobs.service";
import type { RoleName } from "@/lib/permissions";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
let passed = 0;
let failed = 0;
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${GREEN}✓ PASS${RESET} - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ${RED}✗ FAIL${RESET} - ${name}`);
    console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    failed++;
  }
}

const BASE = "http://localhost:3000/api/v1";
const BOT_TOKEN = `123456789:${"A".repeat(35)}`;
type R = Record<string, any>;
type Handler = (r: Request, ctx?: unknown) => Promise<Response>;

/** What the fake Telegram received, and what it should answer next. */
const telegram = { calls: [] as Array<{ method: string; params: R }>, failSend: 0 };
function fakeTelegram() {
  setOutboundTransportForTesting(async (url, options) => {
    const method = url.pathname.split("/").pop() ?? "";
    const params = options.body ? JSON.parse(String(options.body)) : {};
    telegram.calls.push({ method, params });
    const reply = (status: number, body: R) => ({ status, headers: {}, body: JSON.stringify(body), truncated: false, durationMs: 1 });
    if (method === "getMe") return reply(200, { ok: true, result: { id: 1, is_bot: true, username: "cos_alerts_bot" } });
    if (method === "sendMessage" && telegram.failSend > 0) {
      telegram.failSend--;
      return reply(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
    }
    return reply(200, { ok: true, result: true });
  });
}

async function call(route: string, method: string, token: string | null, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: R }> {
  const mod = (await import(`@/app/api/v1/${route}/route`)) as Record<string, Handler>;
  const init: R = { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await mod[method](new NextRequest(`${BASE}/${route}`, init as never), { params: Promise.resolve({}) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as R };
}

const webhook = (update: unknown, secret: string | null = alertsWebhookSecret()) =>
  call("notifications/telegram/webhook", "POST", null, update, secret ? { "x-telegram-bot-api-secret-token": secret } : {});

const startUpdate = (chatId: number, code: string, extra: R = {}) => ({
  update_id: Date.now(),
  message: { message_id: 1, chat: { id: chatId, type: "private", first_name: "Rahim", ...extra }, from: { id: chatId, first_name: "Rahim", username: "rahim_shop" }, text: `/start ${code}` },
});

async function member(tenantId: string, role: RoleName): Promise<string> {
  return (await memberWithId(tenantId, role)).token;
}

async function memberWithId(tenantId: string, role: RoleName): Promise<{ id: string; token: string }> {
  const id = `usr_ntf_${role.toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.createUser({ id, email: `${id}@ntf.test`, name: `${role} member`, password_hash: "!disabled", status: "ACTIVE", created_at: now, updated_at: now });
  db.createMembership({ id: `mem_${id}`, tenant_id: tenantId, user_id: id, role, created_at: now, updated_at: now });
  return { id, token: await signSessionToken({ userId: id, tenantId, role, email: `${id}@ntf.test`, name: `${role} member` }) };
}

async function main() {
  console.log("\nMerchant notifications (Settings → Notifications, Telegram alerts bot)\n");
  resetRateLimitsForTesting();
  delete process.env.TELEGRAM_ALERTS_BOT_TOKEN;
  process.env.APP_URL = "https://shop.test";

  const shop = await AuthService.registerTenantWithOwner({ email: `ntf_${crypto.randomUUID().slice(0, 8)}@ntf.test`, password: "Notify-Owner-Pass-2026!", name: "Notify Owner", workspaceName: "Notify Shop" });
  const other = await AuthService.registerTenantWithOwner({ email: `ntf_o_${crypto.randomUUID().slice(0, 8)}@ntf.test`, password: "Notify-Owner-Pass-2026!", name: "Other Owner", workspaceName: "Other Shop" });
  const owner = shop.token;
  const T = shop.tenant.id;

  await runTest("GET shows the defaults without storing anything (GETs never write); no bot configured is said plainly", async () => {
    const before = db.getAllNotificationSettings().length;
    const r = await call("notifications/settings", "GET", owner);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const v = r.json.data;
    assert.deepStrictEqual(v.bot, { configured: false, username: null });
    assert.strictEqual(v.telegram.connected, false);
    assert.deepStrictEqual(v.alerts, { daily_summary: true, low_stock: true, failed_deliveries: true, cod_weekly: false });
    assert.strictEqual(v.can_manage, true);
    assert.strictEqual(db.getAllNotificationSettings().length, before);
    const link = await call("notifications/telegram/link", "POST", owner);
    assert.strictEqual(link.status, 503);
    assert.strictEqual(link.json.error.code, "ALERTS_BOT_NOT_CONFIGURED");
  });

  await runTest("permissions: SALES can't see them (403); MANAGER sees them read-only and can't change them", async () => {
    const sales = await member(T, "SALES");
    assert.strictEqual((await call("notifications/settings", "GET", sales)).status, 403);
    const manager = await member(T, "MANAGER");
    const view = await call("notifications/settings", "GET", manager);
    assert.strictEqual(view.status, 200);
    assert.strictEqual(view.json.data.can_manage, false);
    assert.strictEqual((await call("notifications/settings", "PATCH", manager, { alerts: { cod_weekly: true } })).status, 403);
    assert.strictEqual((await call("notifications/telegram/link", "POST", manager)).status, 403);
    assert.strictEqual((await call("notifications/test", "POST", manager)).status, 403);
    assert.strictEqual((await call("notifications/telegram", "DELETE", manager)).status, 403);
  });

  await runTest("alerts are switched with a strict body; unknown keys (or a tenant id) are refused", async () => {
    const ok = await call("notifications/settings", "PATCH", owner, { alerts: { cod_weekly: true, low_stock: false } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
    assert.deepStrictEqual(ok.json.data.alerts, { daily_summary: true, low_stock: false, failed_deliveries: true, cod_weekly: true });
    assert.strictEqual((await call("notifications/settings", "PATCH", owner, { alerts: { sms: true } })).status, 400);
    assert.strictEqual((await call("notifications/settings", "PATCH", owner, { tenant_id: other.tenant.id, alerts: {} })).status, 400);
    assert.strictEqual((await call("notifications/settings", "GET", other.token)).json.data.alerts.cod_weekly, false, "another shop is untouched");
    await call("notifications/settings", "PATCH", owner, { alerts: { low_stock: true } });
  });

  // ---- with the alerts bot configured ----
  process.env.TELEGRAM_ALERTS_BOT_TOKEN = BOT_TOKEN;
  resetAlertsBotForTesting();
  fakeTelegram();
  let code = "";

  await runTest("Connect: a one-time t.me link, and the bot's webhook points at this app with its secret", async () => {
    const r = await call("notifications/telegram/link", "POST", owner);
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    const url = new URL(r.json.data.url);
    assert.strictEqual(url.origin + url.pathname, "https://t.me/cos_alerts_bot");
    code = url.searchParams.get("start") ?? "";
    assert.match(code, /^[A-Za-z0-9_-]{24}$/);
    assert.ok(r.json.data.group_url.includes(`startgroup=${code}`));
    const hook = telegram.calls.find((c) => c.method === "setWebhook");
    assert.ok(hook, "setWebhook was called");
    assert.strictEqual(hook!.params.url, "https://shop.test/api/v1/notifications/telegram/webhook");
    assert.strictEqual(hook!.params.secret_token, alertsWebhookSecret());
    assert.ok(!JSON.stringify(db.findNotificationSettings(T)).includes(code), "only the code's hash is stored");
  });

  await runTest("the webhook refuses calls without the bot's secret", async () => {
    assert.strictEqual((await webhook(startUpdate(111, code), null)).status, 401);
    assert.strictEqual((await webhook(startUpdate(111, code), "wrong")).status, 401);
    assert.strictEqual(db.findNotificationSettings(T)?.telegram, undefined);
  });

  await runTest("pressing Start links that chat to this shop, once; the chat is told what it will get", async () => {
    telegram.calls = [];
    const r = await webhook(startUpdate(555001, code));
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.handled, "LINKED");
    const v = (await call("notifications/settings", "GET", owner)).json.data;
    assert.strictEqual(v.telegram.connected, true);
    assert.strictEqual(v.telegram.chat_label, "@rahim_shop");
    const reply = telegram.calls.find((c) => c.method === "sendMessage");
    assert.strictEqual(reply?.params.chat_id, "555001");
    assert.ok(String(reply?.params.text).includes("Notify Shop") && String(reply?.params.text).includes("Daily summary"));
    assert.strictEqual(reply?.params.parse_mode, undefined, "plain text: names can't inject formatting");
    assert.strictEqual((await webhook(startUpdate(666002, code))).json.handled, "LINK_INVALID", "the code works once");
    assert.strictEqual((await call("notifications/settings", "GET", other.token)).json.data.telegram.connected, false, "another shop isn't linked");
  });

  await runTest("an expired link doesn't connect", async () => {
    const r = await call("notifications/telegram/link", "POST", other.token);
    const otherCode = new URL(r.json.data.url).searchParams.get("start")!;
    const rec = db.findNotificationSettings(other.tenant.id)!;
    db.saveNotificationSettings({ ...rec, link: { ...rec.link!, expires_at: new Date(Date.now() - 1000).toISOString() } });
    assert.strictEqual((await webhook(startUpdate(777003, otherCode))).json.handled, "LINK_INVALID");
    assert.strictEqual(db.findNotificationSettings(other.tenant.id)?.telegram, undefined);
  });

  await runTest("Send test: SENT only when Telegram took it; a blocked bot is a 502, never a false success", async () => {
    telegram.calls = [];
    const ok = await call("notifications/test", "POST", owner);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
    assert.strictEqual(ok.json.data.status, "SENT");
    assert.strictEqual(telegram.calls.filter((c) => c.method === "sendMessage")[0]?.params.chat_id, "555001");
    telegram.failSend = 1;
    const blocked = await call("notifications/test", "POST", owner);
    assert.strictEqual(blocked.status, 502);
    assert.strictEqual(blocked.json.error.code, "SEND_FAILED");
    assert.strictEqual((await call("notifications/test", "POST", other.token)).status, 400, "not connected: nothing to test");
  });

  await runTest("the daily summary job sends to shops that want it, at 9 PM their time, and says whether it was sent", async () => {
    telegram.calls = [];
    const at = Date.parse("2026-10-14T15:10:00Z"); // 21:10 in Dhaka
    const run = (await JobsService.run("daily-report", "daily-report:ntf", at)) as R;
    const mine = (run.tenants as R[]).find((t) => t.tenant_id === T);
    assert.ok(mine, "the connected shop is included");
    assert.strictEqual(mine!.delivery, "SENT");
    assert.ok(!(run.tenants as R[]).some((t) => t.tenant_id === other.tenant.id), "a shop without Telegram is skipped");
    const sent = telegram.calls.find((c) => c.method === "sendMessage" && c.params.chat_id === "555001");
    assert.ok(String(sent?.params.text).startsWith("📊 Notify Shop"), String(sent?.params.text));
    assert.ok(!JSON.stringify(run).includes("555001"), "the stored job result has no chat id");

    await call("notifications/settings", "PATCH", owner, { alerts: { daily_summary: false } });
    const off = (await JobsService.run("daily-report", "daily-report:ntf2", at + 2 * 3600_000 + 24 * 3600_000)) as R;
    assert.ok(!(off.tenants as R[]).some((t) => t.tenant_id === T), "switched off: not sent");
    await call("notifications/settings", "PATCH", owner, { alerts: { daily_summary: true } });
  });

  await runTest("/stop in the chat turns alerts off there; Disconnect does the same from CommerceOS", async () => {
    const stop = await webhook({ update_id: 9, message: { message_id: 2, chat: { id: 555001, type: "private" }, text: "/stop" } });
    assert.strictEqual(stop.json.handled, "UNLINKED");
    assert.strictEqual((await call("notifications/settings", "GET", owner)).json.data.telegram.connected, false);

    const again = await call("notifications/telegram/link", "POST", owner);
    const code2 = new URL(again.json.data.url).searchParams.get("start")!;
    assert.strictEqual((await webhook(startUpdate(-100555, code2, { type: "group", title: "Notify Shop Team" }))).json.handled, "LINKED");
    assert.strictEqual((await call("notifications/settings", "GET", owner)).json.data.telegram.chat_label, "Notify Shop Team", "a group shows its title");
    const del = await call("notifications/telegram", "DELETE", owner);
    assert.strictEqual(del.status, 200);
    assert.strictEqual((await call("notifications/settings", "GET", owner)).json.data.telegram.connected, false);
    assert.ok(db.getAuditLogsByTenant(T, 50).logs.some((l) => l.action === "NOTIFICATION_TELEGRAM_DISCONNECTED"));
  });

  await runTest("alerts stop when the person who linked the chat loses access (removed, suspended or a role without settings)", async () => {
    const admin = await memberWithId(T, "ADMIN");
    const link = await call("notifications/telegram/link", "POST", admin.token);
    const adminCode = new URL(link.json.data.url).searchParams.get("start")!;
    assert.strictEqual((await webhook(startUpdate(888004, adminCode))).json.handled, "LINKED");
    const send = async () => {
      telegram.calls = [];
      const { NotificationService } = await import("@/domains/notifications/notification.service");
      const r = await NotificationService.deliver(T, "low_stock", "⚠️ test");
      return { status: r.status, sent: telegram.calls.some((c) => c.method === "sendMessage" && c.params.chat_id === "888004") };
    };
    assert.deepStrictEqual(await send(), { status: "SENT", sent: true });
    db.updateMembershipStatus(T, admin.id, "SUSPENDED");
    assert.deepStrictEqual(await send(), { status: "NOT_SENT", sent: false }, "suspended");
    assert.strictEqual((await call("notifications/settings", "GET", owner)).json.data.telegram.paused, true, "the page says alerts are paused");
    db.updateMembershipStatus(T, admin.id, "ACTIVE");
    db.updateMembershipRole(T, admin.id, "SALES");
    assert.deepStrictEqual(await send(), { status: "NOT_SENT", sent: false }, "role without settings.read");
    db.updateMembershipRole(T, admin.id, "ADMIN");
    db.removeMembership(T, admin.id);
    assert.deepStrictEqual(await send(), { status: "NOT_SENT", sent: false }, "removed from the team");
    const { NotificationService } = await import("@/domains/notifications/notification.service");
    assert.strictEqual(NotificationService.wants(T, "low_stock"), false, "the jobs skip it too");
    await call("notifications/telegram", "DELETE", owner);
  });

  await runTest("Disconnect also cancels a link that hasn't been used yet; /stop is audited", async () => {
    const r = await call("notifications/telegram/link", "POST", owner);
    const pending = new URL(r.json.data.url).searchParams.get("start")!;
    assert.strictEqual((await call("notifications/telegram", "DELETE", owner)).status, 200);
    assert.strictEqual((await webhook(startUpdate(999005, pending))).json.handled, "LINK_INVALID", "a cancelled code doesn't link");
    assert.strictEqual(db.findNotificationSettings(T)?.telegram, undefined);

    const r2 = await call("notifications/telegram/link", "POST", owner);
    const code3 = new URL(r2.json.data.url).searchParams.get("start")!;
    assert.strictEqual((await webhook(startUpdate(999006, code3))).json.handled, "LINKED");
    assert.strictEqual((await webhook({ update_id: 12, message: { message_id: 5, chat: { id: 999006, type: "private" }, text: "/stop" } })).json.handled, "UNLINKED");
    const stopped = db.getAuditLogsByTenant(T, 50).logs.find((l) => l.action === "NOTIFICATION_TELEGRAM_DISCONNECTED" && (l.metadata as R)?.via === "telegram_stop");
    assert.ok(stopped, "/stop leaves an audit entry");
    const view = JSON.stringify((await call("notifications/settings", "GET", owner)).json);
    assert.ok(!/chat_id|code_hash|999006/.test(view), "the settings response never carries a chat id or code hash");
  });

  await runTest("other messages to the bot get a short help reply in private chats and are ignored in groups", async () => {
    assert.strictEqual((await webhook({ update_id: 10, message: { message_id: 3, chat: { id: 42, type: "private" }, text: "hello" } })).json.handled, "HELP");
    assert.strictEqual((await webhook({ update_id: 11, message: { message_id: 4, chat: { id: -42, type: "group" }, text: "hello" } })).json.handled, "IGNORED");
    assert.strictEqual((await webhook("not json")).status, 200, "junk is acknowledged so Telegram doesn't retry it");
    telegram.calls = [];
    for (let i = 0; i < 6; i++) await webhook({ update_id: 20 + i, message: { message_id: 6, chat: { id: 4242, type: "private" }, text: "spam" } });
    assert.strictEqual(telegram.calls.filter((c) => c.method === "sendMessage").length, 3, "at most 3 help replies per chat per minute");
    const big = await webhook(JSON.stringify({ update_id: 30, message: { chat: { id: 1, type: "private" }, text: "x".repeat(70_000) } }));
    assert.deepStrictEqual([big.status, big.json.handled], [200, undefined], "an oversized body is dropped unparsed");
  });

  setOutboundTransportForTesting(null);
  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
