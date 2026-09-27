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

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Phase 1 integrity suite crashed:", err);
  process.exit(1);
});
