/**
 * Phase 1 integrity suite (FIX_IMPLEMENTATION_PLAN FX-11 … FX-19).
 * Tests call real route handlers or services with real sessions; nothing uses a bypass.
 * Run: node tests/ts-runner.cjs ./tests/phase1-integrity-tests.ts
 */
import assert from "assert";
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { signSessionToken } from "@/lib/security";
import { RoleName } from "@/lib/permissions";
import { PaymentService } from "@/domains/payments/payment.service";
import type { Order, Payment } from "@/types/commerce";

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

const BASE = "http://localhost:3000/api/v1";
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

type Workspace = Awaited<ReturnType<typeof AuthService.registerTenantWithOwner>>;

async function member(tenantId: string, role: RoleName): Promise<{ id: string; token: string }> {
  const id = uid(`usr_p1_${role.toLowerCase()}`);
  const email = `${id}@phase1.test`;
  const now = new Date().toISOString();
  db.createUser({ id, email, name: `P1 ${role}`, password_hash: "!disabled", status: "ACTIVE", created_at: now, updated_at: now });
  db.createMembership({ id: `mem_${id}`, tenant_id: tenantId, user_id: id, role, created_at: now, updated_at: now });
  return { id, token: await signSessionToken({ userId: id, tenantId, role, email, name: `P1 ${role}` }) };
}

async function contextFor(token: string) {
  return AuthService.resolveRequestContext(token);
}

function order(tenantId: string, grandTotal: number): Order {
  const now = new Date().toISOString();
  return db.createOrder(
    {
      id: uid("ord_p1"),
      tenant_id: tenantId,
      order_number: uid("P1"),
      customer_id: uid("cus_p1"),
      status: "CONFIRMED",
      currency: "BDT",
      subtotal: grandTotal,
      discount_total: 0,
      shipping_total: 0,
      tax_total: 0,
      grand_total: grandTotal,
      payment_method: "BKASH",
      payment_status: "UNPAID",
      fulfillment_status: "UNFULFILLED",
      shipping_address_snapshot: {},
      source: "WEBSITE",
      created_at: now,
      updated_at: now,
    } as Order,
    []
  );
}

function payment(tenantId: string, orderId: string, amount: number): Payment {
  return db.createPayment({
    id: uid("pay_p1"),
    tenant_id: tenantId,
    order_id: orderId,
    provider: "BKASH",
    amount,
    currency: "BDT",
    status: "PENDING",
    created_at: new Date().toISOString(),
  });
}

async function postJson(route: string, token: string, body: unknown): Promise<Response> {
  const mod = (await import(`@/app/api/v1/${route}/route`)) as { POST: (r: Request) => Promise<Response> };
  return mod.POST(
    new Request(`${BASE}/${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

async function sendJson(route: string, id: string, method: "PATCH" | "PUT", token: string, body: unknown): Promise<Response> {
  type Handler = (r: Request, ctx: { params: { id: string } }) => Promise<Response>;
  const mod = (await import(`@/app/api/v1/${route}/route`)) as Partial<Record<"PATCH" | "PUT", Handler>>;
  const handler = mod[method];
  if (!handler) throw new Error(`${method} ${route} is not exported`);
  return handler(
    new Request(`${BASE}/${route.replace("[id]", id)}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id } }
  );
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 1: INTEGRITY (FX-11 … FX-19)      ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);
  db.clearAllForTesting();

  const shop: Workspace = await AuthService.registerTenantWithOwner({
    email: `${uid("owner")}@phase1.test`,
    password: "Phase1-Owner-Pass-4471!",
    name: "Phase 1 Owner",
    workspaceName: `Phase 1 Shop ${Date.now()}`,
  });
  const tenantId = shop.tenant.id;
  const analyst = await member(tenantId, "ANALYST");
  const finance = await member(tenantId, "FINANCE");

  // ---------------------------------------------------------------------------
  console.log(`${ANSI_BOLD}[FX-11] Payment verification (H3)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("ANALYST (payments.read only) cannot mark a payment paid → 403", async () => {
    const o = order(tenantId, 1500);
    const p = payment(tenantId, o.id, 1500);
    const res = await postJson("payments/verify", analyst.token, { payment_id: p.id, transaction_id: "9J7A5B2C1D" });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(db.findPaymentById(tenantId, p.id)?.status, "PENDING");
  });

  await runTest("FINANCE verifies a full payment: payment and order become PAID, verifier recorded", async () => {
    const o = order(tenantId, 1500);
    const p = payment(tenantId, o.id, 1500);
    const res = await postJson("payments/verify", finance.token, { payment_id: p.id, transaction_id: "8k2m4n6p8q" });
    assert.strictEqual(res.status, 200);
    const stored = db.findPaymentById(tenantId, p.id);
    assert.strictEqual(stored?.status, "PAID");
    assert.strictEqual(stored?.transaction_id, "8K2M4N6P8Q", "TrxID is normalized");
    assert.strictEqual(stored?.verified_by, finance.id);
    assert.strictEqual(stored?.verification_method, "MANUAL");
    assert.strictEqual(db.findOrderById(tenantId, o.id)?.payment_status, "PAID");
  });

  await runTest("re-verifying with the same TrxID is idempotent (200)", async () => {
    const o = order(tenantId, 900);
    const p = payment(tenantId, o.id, 900);
    assert.strictEqual((await postJson("payments/verify", finance.token, { payment_id: p.id, transaction_id: "IDEMP12345" })).status, 200);
    assert.strictEqual((await postJson("payments/verify", finance.token, { payment_id: p.id, transaction_id: "idemp12345" })).status, 200);
  });

  await runTest("a TrxID already used on another payment → 409", async () => {
    const o1 = order(tenantId, 700);
    const o2 = order(tenantId, 700);
    const p1 = payment(tenantId, o1.id, 700);
    const p2 = payment(tenantId, o2.id, 700);
    assert.strictEqual((await postJson("payments/verify", finance.token, { payment_id: p1.id, transaction_id: "REUSE00001" })).status, 200);
    assert.strictEqual((await postJson("payments/verify", finance.token, { payment_id: p2.id, transaction_id: "REUSE00001" })).status, 409);
    assert.strictEqual(db.findPaymentById(tenantId, p2.id)?.status, "PENDING");
  });

  await runTest("a malformed TrxID → 400", async () => {
    const o = order(tenantId, 500);
    const p = payment(tenantId, o.id, 500);
    for (const trx of ["", "12", "has space 1", "<script>alert(1)</script>"]) {
      const res = await postJson("payments/verify", finance.token, { payment_id: p.id, transaction_id: trx });
      assert.ok(res.status === 400, `${JSON.stringify(trx)} gave ${res.status}`);
    }
  });

  await runTest("a partial payment (advance) is verified but the order stays unpaid until covered", async () => {
    const o = order(tenantId, 2000);
    const advance = payment(tenantId, o.id, 120);
    assert.strictEqual((await postJson("payments/verify", finance.token, { payment_id: advance.id, transaction_id: "ADV0000001" })).status, 200);
    assert.notStrictEqual(db.findOrderById(tenantId, o.id)?.payment_status, "PAID");
    const rest = payment(tenantId, o.id, 1880);
    assert.strictEqual((await postJson("payments/verify", finance.token, { payment_id: rest.id, transaction_id: "REST000001" })).status, 200);
    assert.strictEqual(db.findOrderById(tenantId, o.id)?.payment_status, "PAID");
  });

  await runTest("a payment larger than the amount still due is rejected", async () => {
    const o = order(tenantId, 1000);
    const p = payment(tenantId, o.id, 1000);
    const extra = payment(tenantId, o.id, 1000);
    assert.strictEqual((await postJson("payments/verify", finance.token, { payment_id: p.id, transaction_id: "FIRST00001" })).status, 200);
    assert.strictEqual((await postJson("payments/verify", finance.token, { payment_id: extra.id, transaction_id: "SECOND0001" })).status, 400);
  });

  await runTest("createPayment rejects zero, negative and above-total amounts", async () => {
    const o = order(tenantId, 1000);
    const ctx = await contextFor((await AuthService.login(shop.user.email, "Phase1-Owner-Pass-4471!")).token);
    for (const amount of [0, -50, 1000000]) {
      await assert.rejects(() => PaymentService.createPayment(ctx, { order_id: o.id, provider: "BKASH", amount }), /amount/i);
    }
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-12] Strict update schemas (H4) and workspace-only suspension (N5)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const ownerToken = (await AuthService.login(shop.user.email, "Phase1-Owner-Pass-4471!")).token;
  const other: Workspace = await AuthService.registerTenantWithOwner({
    email: `${uid("owner2")}@phase1.test`,
    password: "Phase1-Other-Pass-5582!",
    name: "Other Owner",
    workspaceName: `Phase 1 Other ${Date.now()}`,
  });
  const nowIso = () => new Date().toISOString();

  await runTest("product PATCH with tenant_id → 400, and the product stays in its tenant", async () => {
    const product = db.createProduct({
      id: uid("prd_p1"), tenant_id: tenantId, name: "Panjabi", slug: uid("panjabi"), description: "", sku: uid("SKU"),
      base_price: 1200, currency: "BDT", status: "ACTIVE", images: [], created_at: nowIso(), updated_at: nowIso(),
    });
    const res = await sendJson(`products/[id]`, product.id, "PATCH", ownerToken, { name: "Moved", tenant_id: other.tenant.id });
    assert.strictEqual(res.status, 400);
    const stored = db.findProductById(tenantId, product.id);
    assert.ok(stored, "product still in its tenant");
    assert.strictEqual(stored?.name, "Panjabi");
    const ok = await sendJson(`products/[id]`, product.id, "PATCH", ownerToken, { name: "Eid Panjabi", base_price: 1350 });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(db.findProductById(tenantId, product.id)?.base_price, 1350);
  });

  await runTest("customer PATCH cannot set computed totals → 400", async () => {
    const customer = db.createCustomer({
      id: uid("cus_p1"), tenant_id: tenantId, first_name: "Rahim", last_name: "Uddin", phone: "+8801811000001",
      status: "ACTIVE", source: "WEBSITE", created_at: nowIso(), updated_at: nowIso(),
    });
    const res = await sendJson(`customers/[id]`, customer.id, "PATCH", ownerToken, { total_spent: 999999 });
    assert.strictEqual(res.status, 400);
  });

  await runTest("the store never moves a record to another tenant, even if a caller forwards tenant_id", () => {
    const product = db.createProduct({
      id: uid("prd_p1"), tenant_id: tenantId, name: "Saree", slug: uid("saree"), description: "", sku: uid("SKU"),
      base_price: 900, currency: "BDT", status: "ACTIVE", images: [], created_at: nowIso(), updated_at: nowIso(),
    });
    db.updateProduct(tenantId, product.id, { tenant_id: other.tenant.id, id: "prd_hijacked", name: "Silk Saree" } as never);
    assert.strictEqual(db.findProductById(tenantId, product.id)?.name, "Silk Saree");
    assert.strictEqual(db.findProductById(other.tenant.id, product.id), undefined);
  });

  await runTest("business-hours PUT with tenant_id → 400 (the record can't be rewritten into another tenant)", async () => {
    const mod = (await import("@/app/api/v1/social/business-hours/route")) as { PUT: (r: Request) => Promise<Response> };
    const res = await mod.PUT(new Request(`${BASE}/social/business-hours`, {
      method: "PUT",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: other.tenant.id, offline_message: "closed" }),
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.getBusinessHours(other.tenant.id), undefined);
  });

  await runTest("campaign PUT cannot set status APPROVED (would skip approval and four-eyes) → 400", async () => {
    const id = uid("camp_p1");
    db.insertCampaign({
      id, tenant_id: tenantId, name: "Draft", objective: "ENGAGEMENT", status: "DRAFT", audience_id: "aud_x", channel: "WHATSAPP",
      variants: [], action_risk_level: "LOW", required_approval: false, risk_class: "LOW", created_by: shop.user.id,
      created_at: nowIso(), updated_at: nowIso(),
    } as never);
    const res = await sendJson(`growth/campaigns/[id]`, id, "PUT", ownerToken, { status: "APPROVED" });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.getCampaignById(id)?.status, "DRAFT");
  });

  await runTest("editing a draft campaign re-classifies its risk from the new budget", async () => {
    const audienceId = uid("aud_p1");
    db.insertAudience({
      id: audienceId, tenant_id: tenantId, name: "Small", description: "", type: "STATIC", status: "ACTIVE", rule_groups: [],
      estimated_size: 10, last_evaluated_at: nowIso(), created_by: shop.user.id, created_at: nowIso(), updated_at: nowIso(),
    } as never);
    const id = uid("camp_p1");
    db.insertCampaign({
      id, tenant_id: tenantId, name: "Draft", objective: "ENGAGEMENT", status: "DRAFT", audience_id: audienceId, channel: "WHATSAPP",
      variants: [], action_risk_level: "LOW", required_approval: false, risk_class: "LOW", created_by: shop.user.id,
      created_at: nowIso(), updated_at: nowIso(),
    } as never);
    const res = await sendJson(`growth/campaigns/[id]`, id, "PUT", ownerToken, { budget_bdt: 50000 });
    assert.strictEqual(res.status, 200);
    const stored = db.getCampaignById(id);
    assert.strictEqual(stored?.risk_class, "HIGH");
    assert.strictEqual(stored?.required_approval, true);
  });

  await runTest("a campaign that left DRAFT can't be edited → 409", async () => {
    const id = uid("camp_p1");
    db.insertCampaign({
      id, tenant_id: tenantId, name: "Live", objective: "ENGAGEMENT", status: "RUNNING", audience_id: "aud_x", channel: "WHATSAPP",
      variants: [], action_risk_level: "LOW", required_approval: false, risk_class: "LOW", created_by: shop.user.id,
      created_at: nowIso(), updated_at: nowIso(),
    } as never);
    assert.strictEqual((await sendJson(`growth/campaigns/[id]`, id, "PUT", ownerToken, { budget_bdt: 1 })).status, 409);
  });

  await runTest("N5: suspending a member affects only this workspace, never their account", async () => {
    // other's owner is also a member (SALES) of this shop.
    db.createMembership({ id: uid("mem_p1"), tenant_id: tenantId, user_id: other.user.id, role: "SALES", created_at: nowIso(), updated_at: nowIso() });
    const res = await sendJson(`users/[id]`, other.user.id, "PATCH", ownerToken, { status: "SUSPENDED" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(db.findUserById(other.user.id)?.status, "ACTIVE", "the account itself is untouched");
    const inShop = await signSessionToken({ userId: other.user.id, tenantId, role: "SALES", email: other.user.email, name: other.user.name });
    await assert.rejects(() => AuthService.resolveRequestContext(inShop), /suspended/i);
    const ownShop = await AuthService.login(other.user.email, "Phase1-Other-Pass-5582!", other.tenant.id);
    const ctx = await AuthService.resolveRequestContext(ownShop.token);
    assert.strictEqual(ctx.tenant.id, other.tenant.id, "their own workspace still works");
  });

  await runTest("N5: account-level statuses (DEACTIVATED) are rejected by the member route → 400", async () => {
    assert.strictEqual((await sendJson(`users/[id]`, other.user.id, "PATCH", ownerToken, { status: "DEACTIVATED" })).status, 400);
  });

  await runTest("only an OWNER can grant OWNER or change an owner", async () => {
    const admin = await member(tenantId, "ADMIN");
    const target = await member(tenantId, "SALES");
    assert.strictEqual((await sendJson(`users/[id]`, target.id, "PATCH", admin.token, { role: "OWNER" })).status, 403);
    assert.strictEqual((await sendJson(`users/[id]`, shop.user.id, "PATCH", admin.token, { status: "SUSPENDED" })).status, 403);
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Phase 1 integrity suite crashed:", err);
  process.exit(1);
});
