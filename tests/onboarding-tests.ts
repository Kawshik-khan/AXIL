/**
 * New-shop onboarding (GET/PATCH /api/v1/onboarding) and the self-serve free trial (POST /api/v1/billing/trial).
 * Real route handlers, real sessions, the JSON store (or Postgres with COMMERCEOS_TEST_PG=1).
 * Run: node tests/ts-runner.cjs ./tests/onboarding-tests.ts
 */
import assert from "assert";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { PricingService } from "@/domains/pricing/pricing.service";
import { SELF_SERVE_TRIAL_FLAG, SELF_SERVE_TRIAL_PLAN_ID } from "@/domains/billing/billing.service";
import { hashPassword, signSessionToken } from "@/lib/security";
import { resetRateLimitsForTesting } from "@/lib/rate-limit";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
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

interface Envelope {
  success: boolean;
  data?: Record<string, any>;
  error?: { code: string; message: string };
}
type Handler = (r: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(route: string, method: "GET" | "POST" | "PATCH", headers: Record<string, string> = {}, body?: unknown) {
  const mod = (await import(`@/app/api/v1/${route}/route`)) as Record<string, Handler>;
  const h: Record<string, string> = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  const response = await mod[method](
    new NextRequest(`http://localhost:3000/api/v1/${route}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );
  const parsed = (await response.json().catch(() => ({ success: false }))) as Envelope;
  return { status: response.status, body: parsed };
}

async function main() {
  console.log(`\n${BOLD}   COMMERCEOS NEW-SHOP ONBOARDING   ${RESET}\n`);
  await (db as unknown as { ready?: () => Promise<void> }).ready?.();
  resetRateLimitsForTesting();

  const password = "Onboarding-Owner-Pass-5531!";
  const register = async (label: string) => {
    const shop = await AuthService.registerTenantWithOwner({
      email: `owner_${label}_${crypto.randomUUID().slice(0, 8)}@onboarding.test`,
      password,
      name: `${label} Owner`,
      workspaceName: `Onboarding Shop ${label}`,
    });
    const token = (await AuthService.login(shop.user.email, password, shop.tenant.id)).token;
    return { tenantId: shop.tenant.id, auth: { authorization: `Bearer ${token}` } };
  };
  const A = await register("A");
  const B = await register("B");

  const now = new Date().toISOString();
  const supportId = `usr_onb_support_${crypto.randomUUID().slice(0, 8)}`;
  db.createUser({ id: supportId, email: `${supportId}@onboarding.test`, name: "Support", password_hash: await hashPassword(password), status: "ACTIVE", created_at: now, updated_at: now });
  db.createMembership({ id: `mem_${supportId}`, tenant_id: A.tenantId, user_id: supportId, role: "SUPPORT", created_at: now, updated_at: now });
  const supportAuth = {
    authorization: `Bearer ${await signSessionToken({ userId: supportId, tenantId: A.tenantId, role: "SUPPORT", email: `${supportId}@onboarding.test`, name: "Support" })}`,
  };

  console.log(`${BOLD}[1] Progress and answers${RESET}`);

  await runTest("a new shop starts onboarding at the welcome step; no session is 401", async () => {
    assert.strictEqual((await call("onboarding", "GET")).status, 401);
    const res = await call("onboarding", "GET", A.auth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data!.needs_onboarding, true);
    assert.strictEqual(res.body.data!.state.step, "welcome");
    assert.strictEqual(res.body.data!.show_checklist, false, "no checklist before setup is finished");
  });

  await runTest("answers are saved: shop name, language, category, delivery charges (used by order pricing)", async () => {
    const res = await call("onboarding", "PATCH", A.auth, {
      step: "try",
      language: "en",
      shop_name: "Dhaka D2C Apparel",
      business_category: "CLOTHING",
      delivery_charge_inside_dhaka: 70,
      delivery_charge_outside_dhaka: 130,
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const tenant = db.findTenantById(A.tenantId)!;
    assert.strictEqual(tenant.name, "Dhaka D2C Apparel");
    assert.strictEqual(tenant.language, "en");
    assert.deepStrictEqual(PricingService.getDeliveryFees(A.tenantId), { inside_dhaka_bdt: 70, outside_dhaka_bdt: 130 });
    assert.strictEqual(res.body.data!.state.step, "try");
    const shopItem = res.body.data!.checklist.find((i: { id: string }) => i.id === "shop");
    assert.strictEqual(shopItem.done, true);
  });

  await runTest("strict body: unknown fields, a client tenant_id and bad values are refused (400) and change nothing", async () => {
    for (const body of [{ tenant_id: B.tenantId, shop_name: "Hijack" }, { step: "launch" }, { business_category: "WEAPONS" }, { delivery_charge_inside_dhaka: -5 }, { language: "fr" }, { onboarding: { step: "plan", completed_at: "2020-01-01" } }, { settings: { allow_overselling: true } }, { plan_id: "ENTERPRISE" }]) {
      const res = await call("onboarding", "PATCH", A.auth, body);
      assert.strictEqual(res.status, 400, `${JSON.stringify(body)} → ${res.status}`);
    }
    assert.strictEqual(db.findTenantById(A.tenantId)!.name, "Dhaka D2C Apparel");
    assert.strictEqual(db.findTenantById(B.tenantId)!.name, "Onboarding Shop B", "another shop is never touched");
  });

  await runTest("reading needs settings.read and changing needs settings.update (SUPPORT has neither: 403)", async () => {
    assert.strictEqual((await call("onboarding", "GET", supportAuth)).status, 403);
    const res = await call("onboarding", "PATCH", supportAuth, { shop_name: "Support was here" });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(db.findTenantById(A.tenantId)!.name, "Dhaka D2C Apparel");
  });

  await runTest("finishing turns on the launch checklist; each item comes from real data; Free counts as a plan choice", async () => {
    const res = await call("onboarding", "PATCH", A.auth, { step: "plan", complete: true, choose_free_plan: true });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const data = res.body.data!;
    assert.strictEqual(data.needs_onboarding, false);
    assert.strictEqual(data.show_checklist, true);
    const done = Object.fromEntries(data.checklist.map((i: { id: string; done: boolean }) => [i.id, i.done]));
    assert.deepStrictEqual(done, { shop: true, delivery: true, payments: false, product: false, channel: false, plan: true, first_order: false });
    assert.strictEqual(data.done_count, 3);
  });

  await runTest("hiding the checklist sticks", async () => {
    const res = await call("onboarding", "PATCH", A.auth, { dismiss_checklist: true });
    assert.strictEqual(res.body.data!.show_checklist, false);
    assert.strictEqual((await call("onboarding", "GET", A.auth)).body.data!.show_checklist, false);
  });

  await runTest("a workspace that existed before onboarding is never sent through it", async () => {
    const legacy = db.getTenants().find((t) => !(t.settings as Record<string, unknown> | undefined)?.onboarding && db.findMembershipsByTenantId(t.id).some((m) => m.role === "OWNER"));
    assert.ok(legacy, "a seeded workspace without onboarding state");
    const owner = db.findMembershipsByTenantId(legacy!.id).find((m) => m.role === "OWNER")!;
    const user = db.findUserById(owner.user_id)!;
    const auth = { authorization: `Bearer ${await signSessionToken({ userId: user.id, tenantId: legacy!.id, role: "OWNER", email: user.email, name: user.name, sv: user.session_version ?? 1 })}` };
    const res = await call("onboarding", "GET", auth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data!.state, null);
    assert.strictEqual(res.body.data!.needs_onboarding, false);
    assert.strictEqual(res.body.data!.show_checklist, false);
  });

  await runTest("each shop changes only itself: B's answers never reach A", async () => {
    const before = JSON.stringify(db.findTenantById(A.tenantId)!.settings);
    const res = await call("onboarding", "PATCH", B.auth, { shop_name: "Shop B Renamed", delivery_charge_inside_dhaka: 55 });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(db.findTenantById(B.tenantId)!.name, "Shop B Renamed");
    assert.strictEqual(db.findTenantById(A.tenantId)!.name, "Dhaka D2C Apparel");
    assert.strictEqual(JSON.stringify(db.findTenantById(A.tenantId)!.settings), before);
  });

  await runTest("the general settings route can't set or erase onboarding progress", async () => {
    const before = JSON.stringify((db.findTenantById(B.tenantId)!.settings as Record<string, unknown>).onboarding);
    const forged = await call("tenants/current/settings", "PATCH", B.auth, { settings: { onboarding: { step: "plan", completed_at: "2020-01-01" } } });
    assert.strictEqual(forged.status, 400);
    const ok = await call("tenants/current/settings", "PATCH", B.auth, { settings: { delivery_charge_outside_dhaka: 140 } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(JSON.stringify((db.findTenantById(B.tenantId)!.settings as Record<string, unknown>).onboarding), before);
  });

  console.log(`${BOLD}[2] Self-serve free trial${RESET}`);

  await runTest("a new shop is offered one trial of the self-serve plan", async () => {
    const res = await call("billing", "GET", B.auth);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const offer = res.body.data!.trial_offer;
    assert.ok(offer, "trial offered");
    assert.strictEqual(offer.plan_id, SELF_SERVE_TRIAL_PLAN_ID);
    assert.ok(offer.days > 0);
  });

  await runTest("starting the trial needs settings.update", async () => {
    assert.strictEqual((await call("billing/trial", "POST")).status, 401);
    assert.strictEqual((await call("billing/trial", "POST", supportAuth)).status, 403);
  });

  await runTest("the trial starts once: TRIAL subscription with an end date; a second start is refused (409)", async () => {
    // Two tabs at once, one with a forged body: one trial, server-chosen plan and length
    const [first, second] = await Promise.all([call("billing/trial", "POST", B.auth, { plan_id: "ENTERPRISE", days: 365 }), call("billing/trial", "POST", B.auth)]);
    assert.deepStrictEqual([first.status, second.status].sort(), [201, 409], `${first.status} / ${second.status}`);
    const sub = db.findSubscriptionByTenantId(B.tenantId)!;
    assert.ok(Date.parse(sub.trial_ends_at!) - Date.now() < 91 * 24 * 60 * 60 * 1000, "length comes from the server");
    assert.strictEqual(sub.status, "TRIAL");
    assert.strictEqual(sub.plan_id, SELF_SERVE_TRIAL_PLAN_ID);
    assert.ok(Date.parse(sub.trial_ends_at!) > Date.now());
    const again = await call("billing/trial", "POST", B.auth);
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.body.error!.code, "TRIAL_NOT_AVAILABLE");
    assert.strictEqual((await call("billing", "GET", B.auth)).body.data!.trial_offer, null, "no offer once a subscription exists");
    const audit = db.getAuditLogsByTenant(B.tenantId, 200).logs.find((log) => log.action === "SUBSCRIPTION_TRIAL_STARTED");
    assert.ok(audit, "trial start is audited");
  });

  await runTest("a shop that already has any subscription gets no trial", async () => {
    const C = await register("C");
    const at = new Date().toISOString();
    db.saveSubscription({
      id: `sub_${crypto.randomUUID().slice(0, 12)}`, tenant_id: C.tenantId, plan_id: "STARTER", plan_version_id: "pv_starter_v1", status: "EXPIRED",
      billing_period: "MONTHLY", current_period_start: at, current_period_end: at, cancel_at_period_end: false, created_at: at, updated_at: at,
    });
    assert.strictEqual((await call("billing", "GET", C.auth)).body.data!.trial_offer, null);
    assert.strictEqual((await call("billing/trial", "POST", C.auth)).status, 409);
  });

  console.log(`\n${BOLD}====================================================${RESET}`);
  console.log(`  Tests Passed: ${passed} | Tests Failed: ${failed}`);
  console.log(`${BOLD}====================================================${RESET}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Onboarding suite crashed:", err);
  process.exit(1);
});
