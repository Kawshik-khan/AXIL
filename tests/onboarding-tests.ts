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
import { WorkspaceAccessService } from "@/domains/billing/workspace-access.service";
import { BillingService, SELF_SERVE_TRIAL_FLAG, SELF_SERVE_TRIAL_PLAN_ID, SUPPORT_CONTACT_SETTING, TRIAL_WHEN_UNPAYABLE_SETTING } from "@/domains/billing/billing.service";
import { platformBillingReadiness } from "@/domains/payments/gateways/gateway-accounts";
import { validateSettingValue } from "@/domains/platform/settings-registry";
import { activationInvoices } from "@/components/billing/activation-invoice";
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

  await runTest("hiding folds the setup guide; it stays reachable and unfolds again until setup is finished", async () => {
    const res = await call("onboarding", "PATCH", A.auth, { dismiss_checklist: true });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data!.show_checklist, true, "folded, not gone");
    assert.strictEqual(res.body.data!.checklist_collapsed, true);
    const read = (await call("onboarding", "GET", A.auth)).body.data!;
    assert.strictEqual(read.show_checklist, true);
    assert.strictEqual(read.checklist_collapsed, true, "the fold sticks across reads");
    const open = await call("onboarding", "PATCH", A.auth, { checklist_collapsed: false });
    assert.strictEqual(open.body.data!.checklist_collapsed, false);
    const fold = await call("onboarding", "PATCH", A.auth, { checklist_collapsed: true });
    assert.strictEqual(fold.body.data!.checklist_collapsed, true);
    assert.strictEqual((await call("onboarding", "PATCH", A.auth, { checklist_collapsed: "yes" })).status, 400);
  });

  await runTest("the guide counts required items only; real records tick them; it stays while any is open", async () => {
    let data = (await call("onboarding", "GET", A.auth)).body.data!;
    assert.strictEqual(data.required_total, 6, "the first order is optional");
    assert.strictEqual(data.checklist.find((i: { id: string }) => i.id === "first_order").required, false);
    assert.strictEqual(data.setup_finished, false);
    // Complete the open required items with real records (payments, product, channel)
    const now = new Date().toISOString();
    db.saveTenantPaymentSettings({ tenant_id: A.tenantId, manual: { bkash_number: "01711111111" }, gateways: {}, updated_by: "usr_test", updated_at: now });
    const done = new Set(data.checklist.filter((i: { done: boolean }) => i.done).map((i: { id: string }) => i.id));
    data = (await call("onboarding", "GET", A.auth)).body.data!;
    assert.strictEqual(data.required_done, done.size + 1, "a wallet number ticks 'a way to get paid'");
    assert.strictEqual(data.show_checklist, true, "still open while product and channel are missing");
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

  console.log(`${BOLD}[3] Paywall: public sign-ups use CommerceOS only after paying (ADR-125)${RESET}`);

  const signUp = async (label: string) => {
    const shop = await AuthService.registerTenantWithOwner(
      { email: `paywall_${label}_${crypto.randomUUID().slice(0, 8)}@onboarding.test`, password, name: `${label} Owner`, workspaceName: `Paywall Shop ${label}` },
      { publicSignUp: true }
    );
    const token = (await AuthService.login(shop.user.email, password, shop.tenant.id)).token;
    return { tenantId: shop.tenant.id, auth: { authorization: `Bearer ${token}` } };
  };
  const setPaywall = (on: boolean) =>
    db.savePlatformSetting({ key: "billing.require_paid_subscription", value: on, category: "BILLING", description: "test", is_sensitive: false, updated_at: new Date().toISOString() });
  const P = await signUp("P");
  const Q = await signUp("Q");
  const expect402 = async (auth: Record<string, string>, code: string, nextPath: string) => {
    const res = await call("products", "GET", auth);
    assert.strictEqual(res.status, 402, JSON.stringify(res.body));
    assert.strictEqual(res.body.error!.code, code);
    assert.strictEqual((res.body.error as { details?: { next_path?: string } }).details?.next_path, nextPath);
  };

  await runTest("only the public sign-up route marks a workspace for the paywall", async () => {
    const { POST } = await import("@/app/api/v1/auth/register/route");
    const res = await POST(
      new NextRequest("http://localhost:3000/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `route_${crypto.randomUUID().slice(0, 8)}@onboarding.test`, password, name: "Route Owner", workspaceName: "Route Shop" }),
      }),
      { params: Promise.resolve({}) }
    );
    assert.strictEqual(res.status, 201);
    const tenantId = ((await res.json()) as { data: { tenant: { id: string } } }).data.tenant.id;
    assert.ok((db.findTenantById(tenantId)!.settings as Record<string, unknown>).access_gate, "route sign-up is paywalled");
    assert.strictEqual((db.findTenantById(A.tenantId)!.settings as Record<string, unknown>).access_gate, undefined, "other workspaces are not");
    assert.strictEqual((await call("products", "GET", A.auth)).status, 200, "a workspace without the marker is never held back");
  });

  await runTest("before setup is finished: shop data is 402 (go to setup); setup, billing, session and the test chat work", async () => {
    await expect402(P.auth, "WORKSPACE_SETUP_REQUIRED", "/onboarding");
    assert.strictEqual((await call("onboarding", "GET", P.auth)).status, 200);
    assert.strictEqual((await call("billing", "GET", P.auth)).status, 200);
    const session = await call("auth/session", "GET", P.auth);
    assert.strictEqual(session.status, 200);
    assert.strictEqual(session.body.data!.access.state, "SETUP_REQUIRED");
    assert.notStrictEqual((await call("ai/simulate", "POST", P.auth, { message: "hi" })).status, 402, "the setup step's test chat is allowed");
    assert.strictEqual((await call("products", "POST", P.auth, { name: "Sneaky" })).status, 402, "writes are held back too");
  });

  await runTest("staying on Free is refused for a paywalled shop (409) and nothing is saved", async () => {
    const res = await call("onboarding", "PATCH", P.auth, { step: "plan", complete: true, choose_free_plan: true });
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.error!.code, "PAID_PLAN_REQUIRED");
    const onboarding = (db.findTenantById(P.tenantId)!.settings as Record<string, { completed_at: string | null }>).onboarding;
    assert.strictEqual(onboarding.completed_at, null);
  });

  await runTest("setup finished, nothing paid: 402 (go pay); the test chat is closed now", async () => {
    const res = await call("onboarding", "PATCH", P.auth, { step: "plan", complete: true });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    await expect402(P.auth, "WORKSPACE_PAYMENT_REQUIRED", "/activate");
    assert.strictEqual((await call("ai/simulate", "POST", P.auth, { message: "hi" })).status, 402);
    const billing = await call("billing", "GET", P.auth);
    assert.strictEqual(billing.body.data!.access.state, "PAYMENT_REQUIRED");
    assert.strictEqual(billing.body.data!.access.paywalled, true);
  });

  await runTest("an unpaid invoice opens nothing; a manual payment being checked is PAYMENT_PENDING", async () => {
    const created = await call("billing/invoices", "POST", P.auth, { plan_id: SELF_SERVE_TRIAL_PLAN_ID, billing_period: "MONTHLY" });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    await expect402(P.auth, "WORKSPACE_PAYMENT_REQUIRED", "/activate");
    const invoice = db.getBillingInvoices(P.tenantId).find((i) => i.status === "ISSUED")!;
    db.saveBillingInvoice({ ...invoice, status: "PENDING_VERIFICATION", manual_transaction_id: "TRX123456", updated_at: new Date().toISOString() });
    await expect402(P.auth, "WORKSPACE_PAYMENT_PENDING", "/activate");
  });

  await runTest("the paid invoice opens the workspace at once; another paywalled shop stays closed", async () => {
    const invoice = db.getBillingInvoices(P.tenantId).find((i) => i.status === "PENDING_VERIFICATION")!;
    BillingService.settle(invoice, { method: "MANUAL_BKASH", reference: "TRX123456", verifiedBy: "usr_test_operator" });
    assert.strictEqual((await call("products", "GET", P.auth)).status, 200);
    assert.strictEqual((await call("auth/session", "GET", P.auth)).body.data!.access.state, "ACTIVE");
    await expect402(Q.auth, "WORKSPACE_SETUP_REQUIRED", "/onboarding");
  });

  await runTest("overdue within the grace period: still open (GRACE); after it, or ended: LOCKED with billing open", async () => {
    const sub = db.findSubscriptionByTenantId(P.tenantId)!;
    const day = 24 * 60 * 60 * 1000;
    db.saveSubscription({ ...sub, status: "PAST_DUE", current_period_end: new Date(Date.now() - day).toISOString() });
    assert.strictEqual((await call("products", "GET", P.auth)).status, 200);
    const grace = (await call("auth/session", "GET", P.auth)).body.data!.access;
    assert.strictEqual(grace.state, "GRACE");
    assert.ok(Date.parse(grace.grace_ends_at) > Date.now());
    db.saveSubscription({ ...sub, status: "PAST_DUE", current_period_end: new Date(Date.now() - 60 * day).toISOString() });
    await expect402(P.auth, "WORKSPACE_LOCKED", "/activate");
    db.saveSubscription({ ...sub, status: "EXPIRED" });
    await expect402(P.auth, "WORKSPACE_LOCKED", "/activate");
    assert.strictEqual((await call("billing", "GET", P.auth)).status, 200, "billing stays open so the shop can pay");
    db.saveSubscription(sub);
    assert.strictEqual((await call("products", "GET", P.auth)).status, 200);
  });

  await runTest("a trial gives access while it runs", async () => {
    await call("onboarding", "PATCH", Q.auth, { step: "plan", complete: true });
    const res = await call("billing/trial", "POST", Q.auth);
    if (res.status === 201) assert.strictEqual((await call("products", "GET", Q.auth)).status, 200);
    else assert.strictEqual(res.body.error!.code, "TRIAL_NOT_AVAILABLE", JSON.stringify(res.body));
  });

  await runTest("the paywall marker can't be removed through the settings route", async () => {
    const R = await signUp("R2");
    const res = await call("tenants/current/settings", "PATCH", R.auth, { settings: { access_gate: null } });
    assert.notStrictEqual(res.status, 200);
    assert.ok((db.findTenantById(R.tenantId)!.settings as Record<string, unknown>).access_gate);
  });

  await runTest("look-alike and dot-segment paths don't slip through the allow-list", async () => {
    const R = await signUp("R3");
    for (const path of ["/api/v1/billingx", "/api/v1/authx/products", "/api/v1/onboarding-export", new URL("http://x/api/v1/auth/../products").pathname, new URL("http://x/api/v1/billing/%2e%2e/products").pathname]) {
      assert.throws(() => WorkspaceAccessService.assertAllowed(R.tenantId, path), (e: { statusCode?: number }) => e.statusCode === 402, path);
    }
    for (const path of ["/api/v1/billing", "/api/v1/billing/invoices", "/api/v1/auth/session", "/api/v1/onboarding"]) {
      WorkspaceAccessService.assertAllowed(R.tenantId, path);
    }
    WorkspaceAccessService.assertAllowed(R.tenantId, "/api/v1/products", { bypass: true }); // a support session
  });

  await runTest("operators can turn the paywall off platform-wide", async () => {
    const R = await signUp("R");
    await expect402(R.auth, "WORKSPACE_SETUP_REQUIRED", "/onboarding");
    setPaywall(false);
    try {
      assert.strictEqual((await call("products", "GET", R.auth)).status, 200);
    } finally {
      setPaywall(true);
    }
    await expect402(R.auth, "WORKSPACE_SETUP_REQUIRED", "/onboarding");
  });

  await runTest("a past-due invoice isn't offered as payable on /activate; choosing the plan again replaces it", async () => {
    const S = await signUp("S");
    assert.strictEqual((await call("onboarding", "PATCH", S.auth, { step: "plan", complete: true })).status, 200);
    const first = await call("billing/invoices", "POST", S.auth, { plan_id: SELF_SERVE_TRIAL_PLAN_ID, billing_period: "MONTHLY" });
    assert.strictEqual(first.status, 201, JSON.stringify(first.body));
    const old = db.getBillingInvoices(S.tenantId).find((i) => i.status === "ISSUED")!;
    assert.strictEqual(activationInvoices(db.getBillingInvoices(S.tenantId)).open?.id, old.id, "payable before its due date");
    db.saveBillingInvoice({ ...old, due_date: new Date(Date.now() - 60_000).toISOString(), updated_at: new Date().toISOString() });

    // The server refuses payment for it, so the page must not present it as the open invoice
    const manual = (await import("@/app/api/v1/billing/invoices/[id]/manual-payment/route")) as unknown as Record<string, Handler>;
    const refusedRes = await manual.POST(
      new NextRequest(`http://localhost:3000/api/v1/billing/invoices/${old.id}/manual-payment`, {
        method: "POST",
        headers: { ...S.auth, "content-type": "application/json" },
        body: JSON.stringify({ method: "MANUAL_BKASH", transaction_id: "TRX99887766" }),
      }),
      { params: Promise.resolve({ id: old.id }) },
    );
    const refused = (await refusedRes.json()) as Envelope;
    assert.strictEqual(refusedRes.status, 409, JSON.stringify(refused));
    assert.match(String(refused.error!.message), /due date/);
    const listed = (await call("billing", "GET", S.auth)).body.data!.invoices as Array<{ id: string; status: string; due_date: string }>;
    const view = activationInvoices(listed);
    assert.strictEqual(view.open, undefined);
    assert.strictEqual(view.expired?.id, old.id);

    // Choosing the plan again voids the old invoice and gives a payable one
    const again = await call("billing/invoices", "POST", S.auth, { plan_id: SELF_SERVE_TRIAL_PLAN_ID, billing_period: "MONTHLY" });
    assert.strictEqual(again.status, 201, JSON.stringify(again.body));
    const after = db.getBillingInvoices(S.tenantId);
    assert.strictEqual(after.find((i) => i.id === old.id)!.status, "VOID");
    const next = activationInvoices(after);
    assert.ok(next.open && next.open.id !== old.id && next.expired === undefined);
    await expect402(S.auth, "WORKSPACE_PAYMENT_REQUIRED", "/activate");
  });

  console.log(`${BOLD}[9] No way to pay yet: trial safety net and support contact${RESET}`);

  const BILLING_ENV = [
    "PLATFORM_SSLCOMMERZ_STORE_ID", "PLATFORM_SSLCOMMERZ_STORE_PASSWORD", "PLATFORM_SSLCOMMERZ_MODE",
    "PLATFORM_BKASH_APP_KEY", "PLATFORM_BKASH_APP_SECRET", "PLATFORM_BKASH_USERNAME", "PLATFORM_BKASH_PASSWORD", "PLATFORM_BKASH_MODE",
    "PLATFORM_BILLING_BKASH_NUMBER", "PLATFORM_BILLING_NAGAD_NUMBER", "PLATFORM_BILLING_BANK_DETAILS",
  ];
  const savedEnv = Object.fromEntries(BILLING_ENV.map((k) => [k, process.env[k]]));
  const setSetting = (key: string, value: unknown) =>
    db.savePlatformSetting({ key, value, category: "BILLING", description: "test", is_sensitive: false, updated_at: new Date().toISOString() });
  const setTrialFlag = (on: boolean) => {
    const at = new Date().toISOString();
    const existing = db.findPlatformFeatureFlag(SELF_SERVE_TRIAL_FLAG);
    db.savePlatformFeatureFlag({
      id: existing?.id ?? `ff_${crypto.randomUUID().slice(0, 8)}`, key: SELF_SERVE_TRIAL_FLAG, description: "test", is_enabled_globally: on,
      percentage_rollout: 100, scope: "GLOBAL", tenant_allowlist: [], rules: {}, created_at: existing?.created_at ?? at, updated_at: at,
    });
  };
  const savedFlag = db.findPlatformFeatureFlag(SELF_SERVE_TRIAL_FLAG);
  try {
    for (const k of BILLING_ENV) delete process.env[k];
    setSetting("billing.manual_bkash_number", "");
    setSetting("billing.manual_nagad_number", "");
    setSetting("billing.manual_bank_details", "");

    await runTest("readiness reports each gateway's mode, never its credentials", () => {
      process.env.PLATFORM_SSLCOMMERZ_STORE_ID = "store_test";
      process.env.PLATFORM_SSLCOMMERZ_STORE_PASSWORD = "secret_value_never_shown";
      process.env.PLATFORM_SSLCOMMERZ_MODE = "live";
      const r = platformBillingReadiness();
      assert.deepStrictEqual(r.gateway_modes, { SSLCOMMERZ: "LIVE", BKASH: null });
      assert.deepStrictEqual(r.gateways, ["SSLCOMMERZ"]);
      assert.ok(r.configured);
      assert.ok(!JSON.stringify(r).includes("secret_value_never_shown") && !JSON.stringify(r).includes("store_test"));
      for (const k of BILLING_ENV) delete process.env[k];
      assert.strictEqual(platformBillingReadiness().configured, false);
    });

    await runTest("with no way to pay, the trial is offered even when self-serve trials are off", async () => {
      setTrialFlag(false);
      setSetting(TRIAL_WHEN_UNPAYABLE_SETTING, true);
      const N = await register("N");
      const offer = (await call("billing", "GET", N.auth)).body.data!.trial_offer;
      assert.ok(offer, "safety-net trial offered");
      assert.strictEqual(offer.plan_id, SELF_SERVE_TRIAL_PLAN_ID);
      const started = await call("billing/trial", "POST", N.auth);
      assert.strictEqual(started.status, 201, JSON.stringify(started.body));
    });

    await runTest("the safety net is off by default: an operator's 'trials off' flag holds until they turn it on", async () => {
      setTrialFlag(false);
      db.savePlatformSetting({ key: TRIAL_WHEN_UNPAYABLE_SETTING, value: false, category: "BILLING", description: "test", is_sensitive: false, updated_at: new Date().toISOString() });
      assert.strictEqual(validateSettingValue(TRIAL_WHEN_UNPAYABLE_SETTING, false), false);
      const D = await register("D");
      assert.strictEqual((await call("billing", "GET", D.auth)).body.data!.trial_offer, null);
      assert.strictEqual((await call("billing/trial", "POST", D.auth)).status, 409);
    });

    await runTest("the safety net stops once a way to pay exists, or when it is switched off", async () => {
      setTrialFlag(false);
      setSetting(TRIAL_WHEN_UNPAYABLE_SETTING, true);
      setSetting("billing.manual_bkash_number", "01700000009");
      const M = await register("M");
      assert.strictEqual((await call("billing", "GET", M.auth)).body.data!.trial_offer, null, "payable install: flag off means no trial");
      assert.strictEqual((await call("billing/trial", "POST", M.auth)).status, 409);
      setSetting("billing.manual_bkash_number", "");
      setSetting(TRIAL_WHEN_UNPAYABLE_SETTING, false);
      assert.strictEqual((await call("billing", "GET", M.auth)).body.data!.trial_offer, null, "safety net off");
    });

    await runTest("the billing support contact is typed for the activation page, and only valid values are accepted", async () => {
      const W = await register("W");
      setSetting(SUPPORT_CONTACT_SETTING, "");
      assert.strictEqual((await call("billing", "GET", W.auth)).body.data!.support_contact, null);
      setSetting(SUPPORT_CONTACT_SETTING, "01712345678");
      assert.deepStrictEqual((await call("billing", "GET", W.auth)).body.data!.support_contact, { kind: "WHATSAPP", value: "01712345678" });
      setSetting(SUPPORT_CONTACT_SETTING, "billing@commerceos.example");
      assert.deepStrictEqual((await call("billing", "GET", W.auth)).body.data!.support_contact, { kind: "EMAIL", value: "billing@commerceos.example" });
      assert.throws(() => validateSettingValue(SUPPORT_CONTACT_SETTING, "https://evil.example/pay"));
      assert.throws(() => validateSettingValue(SUPPORT_CONTACT_SETTING, "0171234"));
      assert.strictEqual(validateSettingValue(SUPPORT_CONTACT_SETTING, ""), "");
      assert.throws(() => validateSettingValue(TRIAL_WHEN_UNPAYABLE_SETTING, "yes"));
      assert.throws(() => validateSettingValue(SUPPORT_CONTACT_SETTING, "a@b.co?cc=evil.example"), "no mailto parameters");
      assert.throws(() => validateSettingValue(SUPPORT_CONTACT_SETTING, "a@b.co&body=x"));
    });

    await runTest("the checkout shows who is billed: this workspace and the signed-in payer, from the session only", async () => {
      const P = await register("P");
      const billedTo = (await call("billing", "GET", P.auth)).body.data!.billed_to as { workspace_name: string; payer_name: string; payer_email: string };
      assert.strictEqual(billedTo.workspace_name, "Onboarding Shop P");
      assert.strictEqual(billedTo.payer_name, "P Owner");
      assert.match(billedTo.payer_email, /^owner_p_[0-9a-f]{8}@onboarding\.test$/);
      const other = (await call("billing", "GET", A.auth)).body.data!.billed_to as { workspace_name: string };
      assert.strictEqual(other.workspace_name, db.findTenantById(A.tenantId)?.name, "each workspace sees only its own name");
      assert.notStrictEqual(other.workspace_name, billedTo.workspace_name);
    });
  } finally {
    for (const k of BILLING_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    setSetting(TRIAL_WHEN_UNPAYABLE_SETTING, false);
    setSetting(SUPPORT_CONTACT_SETTING, "");
    if (savedFlag) db.savePlatformFeatureFlag(savedFlag);
    else setTrialFlag(true);
  }

  console.log(`\n${BOLD}====================================================${RESET}`);
  console.log(`  Tests Passed: ${passed} | Tests Failed: ${failed}`);
  console.log(`${BOLD}====================================================${RESET}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Onboarding suite crashed:", err);
  process.exit(1);
});
