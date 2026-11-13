/**
 * Online payments (ADR-123): shop payment settings, payment links, SSLCommerz and bKash hosted checkout, and
 * subscription invoices. Every call goes through the real route handlers with real sessions; the gateways are a
 * stubbed outbound transport that speaks their documented wire format. No request leaves this machine.
 * Run: node tests/ts-runner.cjs ./tests/payments-gateway-tests.ts
 */
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { hashPassword, PLATFORM_AUTH_COOKIE_NAME, signSessionToken } from "@/lib/security";
import { resetRateLimitsForTesting } from "@/lib/rate-limit";
import { setOutboundTransportForTesting, type OutboundResponse } from "@/lib/outbound-http";
import { resetBkashTokensForTesting } from "@/domains/payments/gateways/bkash.adapter";
import { orderNumberCandidates } from "@/domains/payments/payment-link.service";
import { parseBkashTime } from "@/domains/payments/gateways/bkash.adapter";
import { evaluateLookup, isIncomingPaymentType, trxAutoConfirmEnabled } from "@/domains/payments/trx-lookup.service";
import type { Customer, Order } from "@/types/commerce";

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
    console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    failedCount++;
  }
}

const BASE = "http://localhost:3000/api/v1";
type Handler = (r: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface Envelope {
  success: boolean;
  data?: Record<string, any>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

async function call(
  route: string,
  method: "GET" | "POST" | "PUT",
  options: { headers?: Record<string, string>; body?: unknown; form?: Record<string, string>; params?: Record<string, string>; query?: string } = {}
): Promise<{ status: number; body: Envelope; response: Response }> {
  const mod = (await import(`@/app/api/v1/${route}/route`)) as Record<string, Handler>;
  const params = options.params ?? {};
  const url = `${BASE}/${route.replace(/\[([^\]]+)\]/g, (_m, name: string) => params[name] ?? "missing")}${options.query ?? ""}`;
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await mod[method](new NextRequest(url, { method, headers, body }), { params: Promise.resolve(params) });
  let parsed: Envelope = { success: false };
  try {
    parsed = (await response.clone().json()) as Envelope;
  } catch {
    // redirects carry no JSON
  }
  return { status: response.status, body: parsed, response };
}

// ---- A stub that speaks the gateways' documented wire formats ----------------------------------------------------------

interface SslSession {
  tran_id: string;
  amount: string;
  store_id: string;
}
const gateway = {
  requests: [] as Array<{ url: string; method: string; body: string; headers: Record<string, string> }>,
  ssl: { sessions: new Map<string, SslSession>(), validations: new Map<string, Record<string, unknown>>() },
  bkash: {
    grants: 0,
    payments: new Map<string, { amount: string; invoice: string; status: "Initiated" | "Completed"; trxId?: string }>(),
    executeUnanswered: false,
    /** What Search Transaction answers, by TrxID: transactions received in the shop's bKash merchant account. */
    received: new Map<string, Record<string, unknown>>(),
    searchDown: false,
    /** The TrxID the next Execute Payment hands out (else a random one). */
    nextTrxId: undefined as string | undefined,
  },
};

const json = (status: number, body: unknown): OutboundResponse => ({ status, headers: {}, body: JSON.stringify(body), truncated: false, durationMs: 1 });

function installGatewayStub() {
  setOutboundTransportForTesting(async (url, options) => {
    const body = typeof options.body === "string" ? options.body : "";
    gateway.requests.push({ url: url.toString(), method: options.method, body, headers: options.headers ?? {} });

    if (url.hostname === "sandbox.sslcommerz.com" && url.pathname === "/gwprocess/v4/api.php") {
      const form = new URLSearchParams(body);
      if (form.get("store_passwd") !== "shop-pass@ssl" && form.get("store_passwd") !== "platform-pass@ssl") {
        return json(200, { status: "FAILED", failedreason: "Store Credential Error Or Store is De-active" });
      }
      const sessionkey = `SESS${crypto.randomBytes(6).toString("hex")}`;
      gateway.ssl.sessions.set(sessionkey, { tran_id: form.get("tran_id")!, amount: form.get("total_amount")!, store_id: form.get("store_id")! });
      return json(200, { status: "SUCCESS", sessionkey, GatewayPageURL: `https://sandbox.sslcommerz.com/EasyCheckOut/${sessionkey}` });
    }
    if (url.hostname === "sandbox.sslcommerz.com" && url.pathname === "/validator/api/validationserverAPI.php") {
      const record = gateway.ssl.validations.get(url.searchParams.get("val_id") ?? "");
      return json(200, record ?? { status: "INVALID_TRANSACTION" });
    }
    if (url.hostname === "tokenized.sandbox.bka.sh") {
      if (url.pathname.endsWith("/auth/grant-token")) {
        gateway.bkash.grants++;
        const ok = options.headers?.username === "shopBkashUser" && JSON.parse(body).app_secret === "shop-app-secret";
        return ok ? json(200, { statusCode: "0000", id_token: "bk-id-token", expires_in: 3600, token_type: "Bearer" }) : json(200, { statusCode: "9999", statusMessage: "Invalid credentials" });
      }
      if (options.headers?.authorization !== "bk-id-token") return json(401, { message: "Unauthorized" });
      const payload = JSON.parse(body) as Record<string, string>;
      if (url.pathname.endsWith("/general/searchTransaction")) {
        if (gateway.bkash.searchDown) throw new Error("socket hang up");
        return json(200, gateway.bkash.received.get(payload.trxID) ?? { statusCode: "2117", statusMessage: "Invalid trxID" });
      }
      if (url.pathname.endsWith("/payment/create")) {
        const paymentId = `TR0011${crypto.randomBytes(6).toString("hex")}`;
        gateway.bkash.payments.set(paymentId, { amount: payload.amount, invoice: payload.merchantInvoiceNumber, status: "Initiated" });
        return json(200, { paymentId, bkashURL: `https://sandbox.payment.bkash.com/?paymentId=${paymentId}`, transactionStatus: "Initiated", amount: payload.amount, currency: "BDT" });
      }
      const payment = gateway.bkash.payments.get(payload.paymentId);
      if (!payment) return json(200, { externalCode: "2002", errorMessageEn: "Invalid Payment ID" });
      if (url.pathname.endsWith("/payment/execute")) {
        if (gateway.bkash.executeUnanswered) {
          payment.status = "Completed";
          payment.trxId = `BK${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
          throw new Error("socket hang up");
        }
        if (payment.status === "Completed") return json(200, { externalCode: "2062", internalCode: "payment_already_completed", errorMessageEn: "The payment has already been completed" });
        payment.status = "Completed";
        payment.trxId = gateway.bkash.nextTrxId ?? `BK${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        gateway.bkash.nextTrxId = undefined;
        return json(200, { paymentId: payload.paymentId, trxId: payment.trxId, transactionStatus: "Completed", amount: payment.amount, currency: "BDT", intent: "sale", merchantInvoiceNumber: payment.invoice });
      }
      if (url.pathname.endsWith("/query/payment")) {
        return json(200, { paymentId: payload.paymentId, trxId: payment.trxId, transactionStatus: payment.status, amount: payment.amount, currency: "BDT", merchantInvoice: payment.invoice });
      }
    }
    return json(404, { error: "unexpected request" });
  });
}

/** The payer approves at SSLCommerz: its validation API will now confirm `val_id` for this session. */
function sslPay(redirectUrl: string, overrides: Record<string, unknown> = {}): { tran_id: string; val_id: string } {
  const session = gateway.ssl.sessions.get(redirectUrl.split("/").pop()!)!;
  const val_id = `VAL${crypto.randomBytes(6).toString("hex")}`;
  gateway.ssl.validations.set(val_id, {
    status: "VALID",
    tran_id: session.tran_id,
    val_id,
    amount: session.amount,
    currency: "BDT",
    currency_type: "BDT",
    currency_amount: session.amount,
    bank_tran_id: `BANK${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
    card_type: "BKASH-BKash",
    risk_level: "0",
    ...overrides,
  });
  return { tran_id: session.tran_id, val_id };
}

/** A time as bKash writes it: Dhaka time, milliseconds after a colon, "GMT+0600". */
function bkashTime(date: Date): string {
  const local = new Date(date.getTime() + 6 * 3600_000).toISOString();
  return `${local.slice(0, 19)}:${local.slice(20, 23)} GMT+0600`;
}

/** The customer paid the shop's bKash merchant number: Search Transaction will now find this TrxID. */
function bkashReceived(trxID: string, amount: number, overrides: Record<string, unknown> = {}): void {
  gateway.bkash.received.set(trxID, {
    trxID,
    transactionStatus: "Completed",
    amount: amount.toFixed(2),
    currency: "BDT",
    transactionType: "Payment",
    customerMsisdn: "01770000000",
    organizationShortCode: "50022",
    initiationTime: bkashTime(new Date()),
    completedTime: bkashTime(new Date()),
    statusCode: "0000",
    statusMessage: "Successful",
    ...overrides,
  });
}

let seeded = 111;
function seedOrder(tenantId: string, key: string, total: number, status = "CONFIRMED"): Order {
  const iso = new Date().toISOString();
  // Through the store's own create methods, so the rows are saved like any other (Postgres mode checks the order FK)
  db.createCustomer({
    id: `cus_${key}`, tenant_id: tenantId, first_name: "Rahim", last_name: "Uddin", phone: `+88017110${String(seeded++).padStart(5, "0")}`, email: "rahim@customer.test",
    status: "ACTIVE", source: "FACEBOOK", created_at: iso, updated_at: iso,
  } as unknown as Customer);
  const order = {
    id: `ord_${key}`, tenant_id: tenantId, order_number: `PAY-${key.toUpperCase()}`, customer_id: `cus_${key}`, status, currency: "BDT",
    subtotal: total - 120, discount_total: 0, shipping_total: 120, tax_total: 0, grand_total: total, payment_method: "BKASH", payment_status: "UNPAID",
    fulfillment_status: "UNFULFILLED", shipping_address_snapshot: { district: "Sylhet", address_line_1: "Zindabazar" }, source: "FACEBOOK",
    created_at: iso, updated_at: iso,
  } as unknown as Order;
  db.createOrder(order, []);
  return order;
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS ONLINE PAYMENTS & BILLING (ADR-123)   ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  process.env.APP_URL = "https://shop.commerceos.test";
  delete process.env.PAYMENTS_SANDBOX_SETTLES;
  for (const name of Object.keys(process.env)) if (name.startsWith("PLATFORM_") && /SSLCOMMERZ|BKASH|BILLING/.test(name)) delete process.env[name];
  installGatewayStub();

  const password = "Payments-Owner-Pass-7741!";
  const register = async (label: string) => {
    const shop = await AuthService.registerTenantWithOwner({
      email: `owner_${label}_${crypto.randomUUID().slice(0, 8)}@payments.test`,
      password,
      name: `${label} Owner`,
      workspaceName: `Payments Shop ${label}`,
    });
    const token = (await AuthService.login(shop.user.email, password, shop.tenant.id)).token;
    return { shop, tenantId: shop.tenant.id, auth: { authorization: `Bearer ${token}` } };
  };
  const A = await register("A");
  const B = await register("B");

  const now = new Date().toISOString();
  const supportId = `usr_pay_support_${crypto.randomUUID().slice(0, 8)}`;
  db.createUser({ id: supportId, email: `${supportId}@payments.test`, name: "Support", password_hash: await hashPassword(password), status: "ACTIVE", created_at: now, updated_at: now });
  db.createMembership({ id: `mem_${supportId}`, tenant_id: A.tenantId, user_id: supportId, role: "SUPPORT", created_at: now, updated_at: now });
  const supportAuth = {
    authorization: `Bearer ${await signSessionToken({ userId: supportId, tenantId: A.tenantId, role: "SUPPORT", email: `${supportId}@payments.test`, name: "Support" })}`,
  };

  // =====================================================================================================================
  console.log(`${ANSI_BOLD}[1] Shop payment settings${ANSI_RESET}`);

  await runTest("settings need a session (401) and settings.update to change (SUPPORT → 403)", async () => {
    assert.strictEqual((await call("payments/settings", "GET")).status, 401);
    assert.strictEqual((await call("payments/settings", "PUT", { body: { manual: { bkash_number: "01711000222" } } })).status, 401);
    const denied = await call("payments/settings", "PUT", { headers: supportAuth, body: { manual: { bkash_number: "01711000222" } } });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(db.getTenantPaymentSettings(A.tenantId), undefined, "nothing saved by a refused request");
  });

  await runTest("unknown fields, a client tenant_id and a malformed wallet number are refused (400)", async () => {
    const extra = await call("payments/settings", "PUT", { headers: A.auth, body: { manual: { bkash_number: "01711000222" }, tenant_id: B.tenantId } });
    assert.strictEqual(extra.status, 400);
    const bad = await call("payments/settings", "PUT", { headers: A.auth, body: { manual: { bkash_number: "12345" } } });
    assert.strictEqual(bad.status, 400);
    const noCreds = await call("payments/settings", "PUT", { headers: A.auth, body: { gateways: { SSLCOMMERZ: { enabled: true, mode: "SANDBOX" } } } });
    assert.strictEqual(noCreds.status, 400, "a gateway can't be switched on without credentials");
  });

  await runTest("gateway credentials are stored encrypted and never returned", async () => {
    const saved = await call("payments/settings", "PUT", {
      headers: A.auth,
      body: {
        manual: { bkash_number: "01711000222", bkash_account_type: "PERSONAL", nagad_number: "01811000333", instructions: "Use the order number as reference" },
        gateways: {
          SSLCOMMERZ: { enabled: true, mode: "SANDBOX", credentials: { store_id: "shopstore001", store_password: "shop-pass@ssl" } },
          BKASH: { enabled: true, mode: "SANDBOX", credentials: { app_key: "shop-app-key", app_secret: "shop-app-secret", username: "shopBkashUser", password: "shop-bkash-pass" } },
        },
      },
    });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    const text = JSON.stringify(saved.body) + JSON.stringify((await call("payments/settings", "GET", { headers: A.auth })).body);
    for (const secret of ["shop-pass@ssl", "shop-app-secret", "shop-bkash-pass", "shop-app-key", "shopstore001"]) {
      assert.ok(!text.includes(secret), `${secret} must not be returned`);
    }
    const view = saved.body.data!.settings;
    assert.strictEqual(view.gateways.SSLCOMMERZ.configured, true);
    assert.strictEqual(view.gateways.BKASH.enabled, true);
    assert.strictEqual(view.manual.bkash_number, "01711000222");
    const stored = JSON.stringify(db.getTenantPaymentSettings(A.tenantId));
    assert.ok(!stored.includes("shop-pass@ssl") && !stored.includes("shop-app-secret"), "credentials are not stored in the clear");
    const audit = db.getAuditLogsByTenant(A.tenantId, 20).logs.find((l) => l.action === "PAYMENT_SETTINGS_UPDATED");
    assert.ok(audit, "the change is audited");
    assert.ok(!JSON.stringify(audit).includes("shop-pass@ssl"), "the audit row carries no credential");
  });

  await runTest("saving again without credentials keeps them; another shop sees none of it", async () => {
    const again = await call("payments/settings", "PUT", { headers: A.auth, body: { gateways: { SSLCOMMERZ: { enabled: true, mode: "SANDBOX" } } } });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.data!.settings.manual.nagad_number, "01811000333", "manual accounts untouched when left out");
    const other = await call("payments/settings", "GET", { headers: B.auth });
    assert.strictEqual(other.body.data!.settings.gateways.SSLCOMMERZ.configured, false);
    assert.deepStrictEqual(other.body.data!.settings.manual, {});
  });

  // =====================================================================================================================
  console.log(`\n${ANSI_BOLD}[2] Payment links${ANSI_RESET}`);

  const order1 = seedOrder(A.tenantId, "a1", 2620);
  let link1: { id: string; path: string; url: string; amount: number };
  let token1 = "";

  await runTest("creating a link needs orders.write; another shop can't make one for this shop's order", async () => {
    assert.strictEqual((await call("payments/links", "POST", { body: { order_id: order1.id } })).status, 401);
    assert.strictEqual((await call("payments/links", "POST", { headers: supportAuth, body: { order_id: order1.id } })).status, 403);
    assert.strictEqual((await call("payments/links", "POST", { headers: B.auth, body: { order_id: order1.id } })).status, 404);
    assert.strictEqual((await call("payments/links", "POST", { headers: B.auth, body: { order_number: order1.order_number } })).status, 404);
    assert.strictEqual(db.getPaymentLinks(A.tenantId).length, 0);
  });

  await runTest("an order number copied as 'Order ORD-…' (or '#…', lower case) is found; the message reads once", async () => {
    assert.deepStrictEqual(orderNumberCandidates("Order ORD-2026-000005"), ["Order ORD-2026-000005", "ORD-2026-000005"]);
    assert.deepStrictEqual(orderNumberCandidates("  #ord-2026-000005 "), ["#ord-2026-000005", "ord-2026-000005", "ORD-2026-000005"]);
    assert.deepStrictEqual(orderNumberCandidates("Order no: ORD-1"), ["Order no: ORD-1", "ORD-1"]);
    assert.deepStrictEqual(orderNumberCandidates("ORD-1"), ["ORD-1"], "an exact number is looked up as typed");
    // Still scoped to the caller's shop, and the error is not "not found. was not found."
    const fromB = await call("payments/links", "POST", { headers: B.auth, body: { order_number: `Order ${order1.order_number}` } });
    assert.strictEqual(fromB.status, 404);
    assert.strictEqual(fromB.body.error?.message, `Order '${order1.order_number}' was not found.`);
    assert.strictEqual(db.getPaymentLinks(A.tenantId).length + db.getPaymentLinks(B.tenantId).length, 0);
  });

  await runTest("a link defaults to what is due, can ask for less, never for more", async () => {
    const tooMuch = await call("payments/links", "POST", { headers: A.auth, body: { order_id: order1.id, amount: 5000 } });
    assert.strictEqual(tooMuch.status, 400);
    const both = await call("payments/links", "POST", { headers: A.auth, body: { order_id: order1.id, order_number: order1.order_number } });
    assert.strictEqual(both.status, 400);
    const created = await call("payments/links", "POST", { headers: A.auth, body: { order_number: `Order ${order1.order_number}`, amount: 120, note: "Advance delivery charge" } });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    link1 = created.body.data!.link;
    assert.strictEqual(link1.amount, 120);
    assert.strictEqual(link1.url, `https://shop.commerceos.test${link1.path}`);
    token1 = link1.path.split("/").pop()!;
    assert.ok(token1.length >= 40, "an unguessable token");
    assert.ok(!("token" in link1), "the record's token field is not returned separately");
    const listedByB = await call("payments/links", "GET", { headers: B.auth });
    assert.strictEqual(listedByB.body.data!.links.length, 0, "another shop lists none of them");
  });

  await runTest("the public page shows the shop, order number, amount and methods, and no personal data", async () => {
    const view = await call("pay/[token]", "GET", { params: { token: token1 } });
    assert.strictEqual(view.status, 200, JSON.stringify(view.body));
    const link = view.body.data!.link;
    assert.strictEqual(link.order_number, order1.order_number);
    assert.strictEqual(link.amount, 120);
    assert.strictEqual(link.status, "ACTIVE");
    assert.strictEqual(link.methods.manual.bkash_number, "01711000222");
    assert.deepStrictEqual(link.methods.gateways, ["SSLCOMMERZ", "BKASH"]);
    const text = JSON.stringify(view.body);
    for (const leak of ["Rahim", "8801711000111", "rahim@customer.test", "Zindabazar", A.tenantId, order1.id, "credentials"]) {
      assert.ok(!text.includes(leak), `${leak} must not be on the public page`);
    }
    assert.strictEqual((await call("pay/[token]", "GET", { params: { token: "x".repeat(43) } })).status, 404);
    assert.strictEqual((await call("pay/[token]", "GET", { params: { token: "../../etc" } })).status, 404);
  });

  await runTest("a submitted transaction id is a PENDING payment: the order is not paid until staff verify it", async () => {
    const badMethod = await call("pay/[token]/manual", "POST", { params: { token: token1 }, body: { method: "ROCKET", transaction_id: "ABC12345" } });
    assert.strictEqual(badMethod.status, 400, "the shop takes no Rocket");
    const extra = await call("pay/[token]/manual", "POST", { params: { token: token1 }, body: { method: "BKASH", transaction_id: "ABC12345", amount: 1, status: "PAID" } });
    assert.strictEqual(extra.status, 400, "the customer can't set an amount or a status");
    const submitted = await call("pay/[token]/manual", "POST", { params: { token: token1 }, body: { method: "BKASH", transaction_id: "bk9x7y5z3a" } });
    assert.strictEqual(submitted.status, 201, JSON.stringify(submitted.body));
    assert.strictEqual(submitted.body.data!.status, "PENDING_VERIFICATION");
    const payments = db.getPayments(A.tenantId, order1.id);
    assert.strictEqual(payments.length, 1);
    assert.strictEqual(payments[0].status, "PENDING");
    assert.strictEqual(payments[0].amount, 120, "the amount comes from the link, not the customer");
    assert.strictEqual(payments[0].transaction_id, "BK9X7Y5Z3A");
    assert.strictEqual(payments[0].verification_method, undefined);
    assert.strictEqual(db.data.orders.find((o) => o.id === order1.id)!.payment_status, "UNPAID");
    assert.strictEqual(db.findPaymentLinkById(A.tenantId, link1.id)!.status, "ACTIVE");
    const view = await call("pay/[token]", "GET", { params: { token: token1 } });
    assert.strictEqual(view.body.data!.link.awaiting_verification, true);
    assert.ok(!JSON.stringify(view.body).includes("BK9X7Y5Z3A"), "the public page does not echo transaction ids");

    const repeat = await call("pay/[token]/manual", "POST", { params: { token: token1 }, body: { method: "BKASH", transaction_id: "BK9X7Y5Z3A" } });
    assert.strictEqual(repeat.status, 201, "the same submission again is accepted once");
    assert.strictEqual(db.getPayments(A.tenantId, order1.id).length, 1);
  });

  await runTest("staff verification marks the payment and the link paid (the order only when fully covered)", async () => {
    const payment = db.getPayments(A.tenantId, order1.id)[0];
    const denied = await call("payments/verify", "POST", { headers: supportAuth, body: { payment_id: payment.id, transaction_id: "BK9X7Y5Z3A" } });
    assert.strictEqual(denied.status, 403);
    const verified = await call("payments/verify", "POST", { headers: A.auth, body: { payment_id: payment.id, transaction_id: "BK9X7Y5Z3A" } });
    assert.strictEqual(verified.status, 200, JSON.stringify(verified.body));
    assert.strictEqual(db.findPaymentById(A.tenantId, payment.id)!.status, "PAID");
    assert.strictEqual(db.findPaymentLinkById(A.tenantId, link1.id)!.status, "PAID");
    assert.strictEqual(db.data.orders.find((o) => o.id === order1.id)!.payment_status, "UNPAID", "৳120 of ৳2,620 does not pay the order");
    const closed = await call("pay/[token]/manual", "POST", { params: { token: token1 }, body: { method: "BKASH", transaction_id: "ZZ11223344" } });
    assert.strictEqual(closed.status, 409, "a paid link takes nothing more");
  });

  await runTest("a transaction id is single-use, pending submissions are capped, cancelled and expired links are closed", async () => {
    const created = await call("payments/links", "POST", { headers: A.auth, body: { order_id: order1.id } });
    const link = created.body.data!.link;
    assert.strictEqual(link.amount, 2500, "what is still due after the ৳120 advance");
    const token = link.path.split("/").pop()!;
    const reused = await call("pay/[token]/manual", "POST", { params: { token }, body: { method: "BKASH", transaction_id: "BK9X7Y5Z3A" } });
    assert.strictEqual(reused.status, 409);
    for (const trx of ["AAAA111111", "BBBB222222", "CCCC333333"]) {
      assert.strictEqual((await call("pay/[token]/manual", "POST", { params: { token }, body: { method: "NAGAD", transaction_id: trx } })).status, 201);
    }
    const flood = await call("pay/[token]/manual", "POST", { params: { token }, body: { method: "NAGAD", transaction_id: "DDDD444444" } });
    assert.strictEqual(flood.status, 409, "a fourth unverified submission is refused");

    assert.strictEqual((await call("payments/links/[id]/cancel", "POST", { headers: B.auth, params: { id: link.id } })).status, 404, "another shop can't cancel it");
    assert.strictEqual((await call("payments/links/[id]/cancel", "POST", { headers: A.auth, params: { id: link.id } })).status, 200);
    assert.strictEqual((await call("pay/[token]", "GET", { params: { token } })).body.data!.link.status, "CANCELLED");
    assert.strictEqual((await call("pay/[token]/checkout", "POST", { params: { token }, body: { provider: "SSLCOMMERZ" } })).status, 409);

    const expiring = (await call("payments/links", "POST", { headers: A.auth, body: { order_id: order1.id, amount: 500 } })).body.data!.link;
    db.savePaymentLink({ ...db.findPaymentLinkById(A.tenantId, expiring.id)!, expires_at: new Date(Date.now() - 1000).toISOString() });
    const expiredToken = expiring.path.split("/").pop()!;
    assert.strictEqual((await call("pay/[token]", "GET", { params: { token: expiredToken } })).body.data!.link.status, "EXPIRED");
    assert.strictEqual((await call("pay/[token]/manual", "POST", { params: { token: expiredToken }, body: { method: "BKASH", transaction_id: "EEEE555555" } })).status, 409);
  });

  await runTest("staff can reject a submitted id (payments.verify): FAILED, never PAID, and another shop can't touch it", async () => {
    const pending = db.getPayments(A.tenantId, order1.id).find((p) => p.status === "PENDING")!;
    assert.strictEqual((await call("payments/[id]/reject", "POST", { params: { id: pending.id } })).status, 401);
    assert.strictEqual((await call("payments/[id]/reject", "POST", { headers: supportAuth, params: { id: pending.id } })).status, 403);
    assert.strictEqual((await call("payments/[id]/reject", "POST", { headers: B.auth, params: { id: pending.id } })).status, 404);
    const rejected = await call("payments/[id]/reject", "POST", { headers: A.auth, params: { id: pending.id } });
    assert.strictEqual(rejected.status, 200, JSON.stringify(rejected.body));
    assert.strictEqual(db.findPaymentById(A.tenantId, pending.id)!.status, "FAILED");
    const paid = db.getPayments(A.tenantId, order1.id).find((p) => p.status === "PAID")!;
    assert.strictEqual((await call("payments/[id]/reject", "POST", { headers: A.auth, params: { id: paid.id } })).status, 409, "a confirmed payment can't be rejected");
  });

  await runTest("a suspended shop's links stop resolving", async () => {
    const order = seedOrder(B.tenantId, "b1", 900);
    await call("payments/settings", "PUT", { headers: B.auth, body: { manual: { bkash_number: "01911000444" } } });
    const link = (await call("payments/links", "POST", { headers: B.auth, body: { order_id: order.id } })).body.data!.link;
    const token = link.path.split("/").pop()!;
    assert.strictEqual((await call("pay/[token]", "GET", { params: { token } })).status, 200);
    db.updateTenant(B.tenantId, { status: "SUSPENDED" });
    assert.strictEqual((await call("pay/[token]", "GET", { params: { token } })).status, 404);
    assert.strictEqual((await call("pay/[token]/manual", "POST", { params: { token }, body: { method: "BKASH", transaction_id: "FFFF666666" } })).status, 404);
    db.updateTenant(B.tenantId, { status: "ACTIVE" });
  });

  // =====================================================================================================================
  console.log(`\n${ANSI_BOLD}[3] SSLCommerz checkout (shop's own account)${ANSI_RESET}`);
  resetRateLimitsForTesting();

  const order2 = seedOrder(A.tenantId, "a2", 1800);
  const sslLink = (await call("payments/links", "POST", { headers: A.auth, body: { order_id: order2.id } })).body.data!.link;
  const sslToken = sslLink.path.split("/").pop()!;
  const attemptsFor = (linkId: string) => db.getGatewayPaymentAttempts(A.tenantId, { type: "PAYMENT_LINK", id: linkId });

  await runTest("checkout opens a session with the shop's credentials, our attempt id and the link's amount", async () => {
    const started = await call("pay/[token]/checkout", "POST", { params: { token: sslToken }, body: { provider: "SSLCOMMERZ" } });
    assert.strictEqual(started.status, 200, JSON.stringify(started.body));
    assert.ok(String(started.body.data!.redirect_url).startsWith("https://sandbox.sslcommerz.com/"));
    const sent = new URLSearchParams(gateway.requests.filter((r) => r.url.includes("gwprocess")).pop()!.body);
    const attempt = attemptsFor(sslLink.id)[0];
    assert.strictEqual(sent.get("store_id"), "shopstore001");
    assert.strictEqual(sent.get("total_amount"), "1800.00");
    assert.strictEqual(sent.get("tran_id"), attempt.id);
    assert.ok(attempt.id.length <= 30, "fits SSLCommerz's tran_id");
    assert.strictEqual(sent.get("success_url"), "https://shop.commerceos.test/api/v1/payments/gateway/sslcommerz/return");
    assert.strictEqual(sent.get("ipn_url"), "https://shop.commerceos.test/api/v1/payments/gateway/sslcommerz/ipn");
    assert.strictEqual(attempt.status, "INITIATED");
    assert.strictEqual(attempt.scope, "STORE");
    assert.ok(!JSON.stringify(started.body).includes("shop-pass@ssl"));
  });

  await runTest("a forged 'success' callback pays nothing: no val_id, an unknown val_id, or one for another amount", async () => {
    const attempt = attemptsFor(sslLink.id)[0];
    const noVal = await call("payments/gateway/sslcommerz/return", "POST", { form: { tran_id: attempt.id, status: "VALID", amount: "1800.00" } });
    assert.strictEqual(noVal.status, 303);
    const fake = await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: attempt.id, status: "VALID", val_id: "VALforged000001", amount: "1800.00" } });
    assert.strictEqual(fake.body && (fake.body as unknown as { status: string }).status, "FAILED");

    // A real, cheaper payment of the same shop presented for this attempt
    const cheap = sslPay((await call("pay/[token]/checkout", "POST", { params: { token: sslToken }, body: { provider: "SSLCOMMERZ" } })).body.data!.redirect_url, {
      amount: "10.00",
      currency_amount: "10.00",
    });
    const underpaid = await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: cheap.tran_id, status: "VALID", val_id: cheap.val_id } });
    assert.strictEqual((underpaid.body as unknown as { status: string }).status, "PENDING");
    const crossed = await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: attempt.id, status: "VALID", val_id: cheap.val_id } });
    assert.notStrictEqual((crossed.body as unknown as { status: string }).status, "PAID", "a val_id of another transaction");

    assert.strictEqual(db.getPayments(A.tenantId, order2.id).length, 0, "no payment recorded");
    assert.strictEqual(db.data.orders.find((o) => o.id === order2.id)!.payment_status, "UNPAID");
    assert.strictEqual(db.findPaymentLinkById(A.tenantId, sslLink.id)!.status, "ACTIVE");
    assert.strictEqual((await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: "gp" + "0".repeat(26), val_id: "x" } })).status, 404);
  });

  await runTest("a sandbox payment that SSLCommerz confirms is recorded as a test and pays nothing by default", async () => {
    const started = await call("pay/[token]/checkout", "POST", { params: { token: sslToken }, body: { provider: "SSLCOMMERZ" } });
    const paid = sslPay(started.body.data!.redirect_url);
    const back = await call("payments/gateway/sslcommerz/return", "POST", { form: { tran_id: paid.tran_id, status: "VALID", val_id: paid.val_id } });
    assert.strictEqual(back.status, 303);
    assert.ok(back.response.headers.get("location")!.endsWith(`${sslLink.path}?payment=test`), back.response.headers.get("location")!);
    const attempt = db.findGatewayPaymentAttempt(paid.tran_id)!;
    assert.strictEqual(attempt.status, "PAID");
    assert.strictEqual(attempt.test_only, true);
    assert.strictEqual(db.getPayments(A.tenantId, order2.id).length, 0, "test money pays for nothing");
    assert.strictEqual(db.data.orders.find((o) => o.id === order2.id)!.payment_status, "UNPAID");
  });

  await runTest("with PAYMENTS_SANDBOX_SETTLES=1 the confirmed payment settles once: payment PAID by GATEWAY, order and link paid", async () => {
    process.env.PAYMENTS_SANDBOX_SETTLES = "1";
    const started = await call("pay/[token]/checkout", "POST", { params: { token: sslToken }, body: { provider: "SSLCOMMERZ" } });
    const paid = sslPay(started.body.data!.redirect_url);
    // The gateway's server and the payer's browser arrive together
    const [ipn, back] = await Promise.all([
      call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: paid.tran_id, status: "VALID", val_id: paid.val_id } }),
      call("payments/gateway/sslcommerz/return", "POST", { form: { tran_id: paid.tran_id, status: "VALID", val_id: paid.val_id } }),
    ]);
    assert.strictEqual(ipn.status, 200);
    assert.ok(back.response.headers.get("location")!.endsWith(`${sslLink.path}?payment=paid`));
    const again = await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: paid.tran_id, status: "VALID", val_id: paid.val_id } });
    assert.strictEqual((again.body as unknown as { status: string }).status, "PAID");

    const payments = db.getPayments(A.tenantId, order2.id);
    assert.strictEqual(payments.length, 1, "settled exactly once");
    assert.strictEqual(payments[0].status, "PAID");
    assert.strictEqual(payments[0].amount, 1800);
    assert.strictEqual(payments[0].verification_method, "GATEWAY");
    assert.strictEqual(payments[0].verified_by, "gateway:SSLCOMMERZ");
    assert.strictEqual(payments[0].provider, "BKASH", "paid with bKash at SSLCommerz");
    assert.strictEqual(payments[0].test_mode, true);
    assert.strictEqual(db.data.orders.find((o) => o.id === order2.id)!.payment_status, "PAID");
    assert.strictEqual(db.findPaymentLinkById(A.tenantId, sslLink.id)!.status, "PAID");
    assert.strictEqual((await call("pay/[token]", "GET", { params: { token: sslToken } })).body.data!.link.status, "PAID");
    assert.strictEqual((await call("pay/[token]/checkout", "POST", { params: { token: sslToken }, body: { provider: "SSLCOMMERZ" } })).status, 409);
    const audit = db.getAuditLogsByTenant(A.tenantId, 50).logs.find((l) => l.action === "PAYMENT_VERIFIED" && l.metadata.gateway === "SSLCOMMERZ");
    assert.ok(audit, "audited");
  });

  await runTest("a high-risk payment is held, a cancelled one closes the attempt, and neither marks anything paid", async () => {
    const order = seedOrder(A.tenantId, "a3", 700);
    const link = (await call("payments/links", "POST", { headers: A.auth, body: { order_id: order.id } })).body.data!.link;
    const token = link.path.split("/").pop()!;
    const risky = sslPay((await call("pay/[token]/checkout", "POST", { params: { token }, body: { provider: "SSLCOMMERZ" } })).body.data!.redirect_url, { risk_level: "1" });
    const held = await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: risky.tran_id, status: "VALID", val_id: risky.val_id } });
    assert.strictEqual((held.body as unknown as { status: string }).status, "PENDING");
    const second = await call("pay/[token]/checkout", "POST", { params: { token }, body: { provider: "SSLCOMMERZ" } });
    const session = gateway.ssl.sessions.get(String(second.body.data!.redirect_url).split("/").pop()!)!;
    const cancelled = await call("payments/gateway/sslcommerz/return", "POST", { form: { tran_id: session.tran_id, status: "CANCELLED" } });
    assert.ok(cancelled.response.headers.get("location")!.endsWith(`${link.path}?payment=cancelled`));
    assert.strictEqual(db.findGatewayPaymentAttempt(session.tran_id)!.status, "CANCELLED");
    assert.strictEqual(db.getPayments(A.tenantId, order.id).length, 0);
    assert.strictEqual(db.data.orders.find((o) => o.id === order.id)!.payment_status, "UNPAID");
  });

  await runTest("a shop without the gateway (or with wrong credentials) gets no checkout and no fake success", async () => {
    const order = seedOrder(B.tenantId, "b2", 600);
    const link = (await call("payments/links", "POST", { headers: B.auth, body: { order_id: order.id } })).body.data!.link;
    const token = link.path.split("/").pop()!;
    const none = await call("pay/[token]/checkout", "POST", { params: { token }, body: { provider: "SSLCOMMERZ" } });
    assert.strictEqual(none.status, 424);
    assert.strictEqual(none.body.error!.code, "INTEGRATION_NOT_CONFIGURED");
    await call("payments/settings", "PUT", { headers: B.auth, body: { gateways: { SSLCOMMERZ: { enabled: true, mode: "SANDBOX", credentials: { store_id: "wrongstore", store_password: "wrong" } } } } });
    const refused = await call("pay/[token]/checkout", "POST", { params: { token }, body: { provider: "SSLCOMMERZ" } });
    assert.strictEqual(refused.status, 502);
    assert.strictEqual(refused.body.error!.code, "PAYMENT_GATEWAY_ERROR");
    assert.ok(!JSON.stringify(refused.body).includes("Store Credential Error"), "the gateway's own text is not passed on");
    const attempts = db.getGatewayPaymentAttempts(B.tenantId, { type: "PAYMENT_LINK", id: link.id });
    assert.deepStrictEqual(attempts.map((a) => a.status), ["FAILED"]);
    const live = await call("payments/settings", "PUT", { headers: B.auth, body: { gateways: { BKASH: { enabled: true, mode: "LIVE", credentials: { app_key: "k", app_secret: "s", username: "u", password: "p" } } } } });
    assert.strictEqual(live.status, 200);
    delete process.env.BKASH_LIVE_BASE_URL;
    const noLive = await call("pay/[token]/checkout", "POST", { params: { token }, body: { provider: "BKASH" } });
    assert.strictEqual(noLive.status, 424, "bKash live needs the production URL bKash issues");
  });

  // =====================================================================================================================
  console.log(`\n${ANSI_BOLD}[4] bKash checkout (shop's own account)${ANSI_RESET}`);
  resetRateLimitsForTesting();
  resetBkashTokensForTesting();
  gateway.bkash.grants = 0;

  const order4 = seedOrder(A.tenantId, "a4", 1350);
  const bkLink = (await call("payments/links", "POST", { headers: A.auth, body: { order_id: order4.id } })).body.data!.link;
  const bkToken = bkLink.path.split("/").pop()!;
  const startBkash = async () => {
    const started = await call("pay/[token]/checkout", "POST", { params: { token: bkToken }, body: { provider: "BKASH" } });
    assert.strictEqual(started.status, 200, JSON.stringify(started.body));
    const paymentId = new URL(started.body.data!.redirect_url).searchParams.get("paymentId")!;
    const attempt = attemptsFor(bkLink.id).find((a) => a.gateway_reference === paymentId)!;
    return { paymentId, attempt };
  };

  await runTest("create payment carries our attempt id and a path-only callback; the token is granted once", async () => {
    const { paymentId, attempt } = await startBkash();
    await startBkash();
    assert.strictEqual(gateway.bkash.grants, 1, "bKash allows two grant calls an hour: the token is reused");
    const create = gateway.requests.filter((r) => r.url.endsWith("/payment/create")).pop()!;
    const sent = JSON.parse(create.body) as Record<string, string>;
    assert.strictEqual(sent.amount, "1350.00");
    assert.strictEqual(sent.intent, "sale");
    assert.ok(sent.callbackURL.startsWith("https://shop.commerceos.test/pay/return/bkash/gp") && !sent.callbackURL.includes("?"));
    assert.strictEqual(create.headers["x-app-key"], "shop-app-key");
    assert.ok(paymentId && attempt.status === "INITIATED");
  });

  await runTest("a forged success for another payment id, and a cancel, pay nothing", async () => {
    const { attempt } = await startBkash();
    const other = await startBkash();
    const swapped = await call("payments/gateway/bkash/confirm", "POST", { body: { attempt_id: attempt.id, payment_id: other.paymentId, status: "success" } });
    assert.strictEqual(swapped.body.data!.status, "FAILED");
    const cancelled = await call("payments/gateway/bkash/confirm", "POST", { body: { attempt_id: other.attempt.id, payment_id: other.paymentId, status: "cancel" } });
    assert.strictEqual(cancelled.body.data!.status, "CANCELLED");
    assert.strictEqual((await call("payments/gateway/bkash/confirm", "POST", { body: { attempt_id: "gp" + "f".repeat(26), status: "success" } })).status, 404);
    assert.strictEqual((await call("payments/gateway/bkash/confirm", "POST", { body: { attempt_id: other.attempt.id, tenant_id: B.tenantId } })).status, 400);
    assert.strictEqual(db.getPayments(A.tenantId, order4.id).length, 0);
  });

  await runTest("Execute confirms the payment: recorded once, even when the callback is replayed", async () => {
    const { paymentId, attempt } = await startBkash();
    const done = await call("payments/gateway/bkash/confirm", "POST", { body: { attempt_id: attempt.id, payment_id: paymentId, status: "success" } });
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
    assert.strictEqual(done.body.data!.status, "PAID");
    assert.strictEqual(done.body.data!.redirect_path, `${bkLink.path}?payment=paid`);
    const replay = await call("payments/gateway/bkash/confirm", "POST", { body: { attempt_id: attempt.id, payment_id: paymentId, status: "success" } });
    assert.strictEqual(replay.body.data!.status, "PAID");
    const payments = db.getPayments(A.tenantId, order4.id);
    assert.strictEqual(payments.length, 1);
    assert.strictEqual(payments[0].provider, "BKASH");
    assert.strictEqual(payments[0].verification_method, "GATEWAY");
    assert.strictEqual(payments[0].transaction_id, gateway.bkash.payments.get(paymentId)!.trxId);
    assert.strictEqual(db.data.orders.find((o) => o.id === order4.id)!.payment_status, "PAID");
  });

  await runTest("when Execute gives no answer, Query Payment decides (never a second Execute)", async () => {
    const order = seedOrder(A.tenantId, "a5", 990);
    const link = (await call("payments/links", "POST", { headers: A.auth, body: { order_id: order.id } })).body.data!.link;
    const started = await call("pay/[token]/checkout", "POST", { params: { token: link.path.split("/").pop()! }, body: { provider: "BKASH" } });
    const paymentId = new URL(started.body.data!.redirect_url).searchParams.get("paymentId")!;
    const attempt = attemptsFor(link.id)[0];
    gateway.bkash.executeUnanswered = true;
    const executesBefore = gateway.requests.filter((r) => r.url.endsWith("/payment/execute")).length;
    const done = await call("payments/gateway/bkash/confirm", "POST", { body: { attempt_id: attempt.id, payment_id: paymentId, status: "success" } });
    gateway.bkash.executeUnanswered = false;
    assert.strictEqual(done.body.data!.status, "PAID", JSON.stringify(done.body));
    assert.strictEqual(gateway.requests.filter((r) => r.url.endsWith("/payment/execute")).length - executesBefore, 1);
    assert.strictEqual(db.getPayments(A.tenantId, order.id).length, 1);
  });

  // =====================================================================================================================
  console.log(`\n${ANSI_BOLD}[4b] bKash TrxID lookup for send-money payments (ADR-124)${ANSI_RESET}`);
  resetRateLimitsForTesting();
  delete process.env.PAYMENTS_SANDBOX_SETTLES;
  delete process.env.BKASH_TRX_AUTO_CONFIRM;
  const newLink = async (key: string, total: number) => {
    const order = seedOrder(A.tenantId, key, total);
    const link = (await call("payments/links", "POST", { headers: A.auth, body: { order_id: order.id } })).body.data!.link;
    return { order, link, token: link.path.split("/").pop()! as string };
  };
  // The stub's payer number ends in 0000
  const submitBkash = (token: string, trx: string, senderLast4?: string) =>
    call("pay/[token]/manual", "POST", { params: { token }, body: { method: "BKASH", transaction_id: trx, ...(senderLast4 ? { sender_last4: senderLast4 } : {}) } });
  const pendingOf = (orderId: string) => db.getPayments(A.tenantId, orderId)[0];
  const searches = () => gateway.requests.filter((r) => r.url.endsWith("/general/searchTransaction"));
  const autoOn = () => {
    process.env.BKASH_TRX_AUTO_CONFIRM = "1";
    process.env.PAYMENTS_SANDBOX_SETTLES = "1"; // the stub account is SANDBOX
  };
  const autoOff = () => {
    delete process.env.BKASH_TRX_AUTO_CONFIRM;
    delete process.env.PAYMENTS_SANDBOX_SETTLES;
  };

  await runTest("bKash's time format is read; the rules: found, completed, same amount, after the link, same sender", () => {
    assert.strictEqual(parseBkashTime("2024-01-27T10:57:45:476 GMT+0600"), "2024-01-27T04:57:45.476Z");
    assert.strictEqual(parseBkashTime("yesterday"), undefined);
    const linkAt = new Date(Date.now() - 60_000).toISOString();
    const base = {
      found: true,
      trxId: "TRX1234567",
      status: "Completed",
      amount: 500,
      currency: "BDT",
      completedAt: new Date().toISOString(),
      transactionType: "Payment",
      payerLast4: "4821",
    };
    const pay = { transaction_id: "trx1234567", amount: 500, payer_last4: "4821" };
    const full = evaluateLookup(base, pay, linkAt);
    assert.deepStrictEqual([full.result, full.autoConfirmable], ["MATCHED", true]);
    assert.strictEqual(evaluateLookup({ found: false }, pay, linkAt).result, "NOT_FOUND");
    assert.strictEqual(evaluateLookup({ ...base, trxId: "OTHER12345" }, pay, linkAt).result, "NOT_FOUND");
    assert.strictEqual(evaluateLookup({ ...base, status: "Initiated" }, pay, linkAt).result, "NOT_COMPLETED");
    assert.strictEqual(evaluateLookup({ ...base, amount: 499 }, pay, linkAt).result, "AMOUNT_MISMATCH");
    assert.strictEqual(evaluateLookup({ ...base, currency: "USD" }, pay, linkAt).result, "AMOUNT_MISMATCH");
    assert.strictEqual(evaluateLookup({ ...base, amount: undefined }, pay, linkAt).result, "AMOUNT_MISMATCH");
    assert.strictEqual(evaluateLookup({ ...base, completedAt: new Date(Date.now() - 3 * 3600_000).toISOString() }, pay, linkAt).result, "BEFORE_LINK");
    assert.strictEqual(evaluateLookup({ ...base, payerLast4: "9999" }, pay, linkAt).result, "SENDER_MISMATCH");
    // A match a person must still confirm
    const needsPerson: Array<[string, Parameters<typeof evaluateLookup>[0], Parameters<typeof evaluateLookup>[1]]> = [
      ["no time", { ...base, completedAt: undefined }, pay],
      ["no sender digits from the customer", base, { ...pay, payer_last4: undefined }],
      ["no payer from bKash", { ...base, payerLast4: undefined }, pay],
      ["a checkout payment", { ...base, transactionType: "bKash Tokenized Checkout via API" }, pay],
      ["a refund", { ...base, transactionType: "Refund Payment" }, pay],
      ["no type", { ...base, transactionType: undefined }, pay],
    ];
    for (const [label, lookup, payment] of needsPerson) {
      const outcome = evaluateLookup(lookup, payment, linkAt);
      assert.deepStrictEqual([outcome.result, outcome.autoConfirmable], ["MATCHED", false], label);
      assert.ok(outcome.message.includes("Confirm it yourself"), label);
    }
    assert.strictEqual(isIncomingPaymentType("Payment"), true);
    assert.strictEqual(isIncomingPaymentType("Merchant Payment"), true);
    for (const t of ["Disbursement", "B2C Payout", "Cash Out", "Send Money transfer", "Payment Reversal"]) {
      assert.strictEqual(isIncomingPaymentType(t), false, t);
    }
  });

  await runTest("auto-confirm is off unless the platform turns it on, and sandbox money needs PAYMENTS_SANDBOX_SETTLES", () => {
    const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
    assert.strictEqual(trxAutoConfirmEnabled("LIVE", env({})), false);
    assert.strictEqual(trxAutoConfirmEnabled("LIVE", env({ BKASH_TRX_AUTO_CONFIRM: "1" })), true);
    assert.strictEqual(trxAutoConfirmEnabled("SANDBOX", env({ BKASH_TRX_AUTO_CONFIRM: "1" })), false);
    assert.strictEqual(trxAutoConfirmEnabled("SANDBOX", env({ BKASH_TRX_AUTO_CONFIRM: "1", PAYMENTS_SANDBOX_SETTLES: "1" })), true);
  });

  await runTest("a submitted bKash ID that bKash confirms is marked MATCHED but stays PENDING by default", async () => {
    const { order, token } = await newLink("l1", 1270);
    bkashReceived("LKP1000001", 1270);
    const before = searches().length;
    const submitted = await submitBkash(token, "lkp1000001", "0000");
    assert.strictEqual(submitted.status, 201, JSON.stringify(submitted.body));
    assert.strictEqual(submitted.body.data!.status, "PENDING_VERIFICATION");
    assert.ok(!JSON.stringify(submitted.body).includes("MATCHED"), "the customer is not told what bKash said");
    assert.strictEqual(searches().length - before, 1);
    const sent = searches().pop()!;
    assert.deepStrictEqual(JSON.parse(sent.body), { trxID: "LKP1000001" });
    assert.strictEqual(sent.headers["x-app-key"], "shop-app-key");
    const payment = pendingOf(order.id);
    assert.strictEqual(payment.status, "PENDING");
    assert.strictEqual(payment.payer_last4, "0000");
    assert.strictEqual(payment.gateway_check?.result, "MATCHED");
    assert.strictEqual(payment.gateway_check?.auto_confirmable, true);
    assert.strictEqual(payment.gateway_check?.mode, "SANDBOX");
    assert.ok(payment.gateway_check?.message.startsWith("Sandbox (test money):"));
    assert.ok(!JSON.stringify(payment).includes("01770000000"), "the payer's full number is not stored");
    assert.strictEqual(db.data.orders.find((o) => o.id === order.id)!.payment_status, "UNPAID");
    const badDigits = await call("pay/[token]/manual", "POST", { params: { token }, body: { method: "BKASH", transaction_id: "LKP1000099", sender_last4: "12a4" } });
    assert.strictEqual(badDigits.status, 400);
  });

  await runTest("not found, a different amount or sender, and money from before the link are recorded as such, never paid", async () => {
    const unknown = await newLink("l2", 800);
    await submitBkash(unknown.token, "LKPNOPE0001", "0000");
    assert.strictEqual(pendingOf(unknown.order.id).gateway_check?.result, "NOT_FOUND");
    const less = await newLink("l3", 800);
    bkashReceived("LKP1000003", 80);
    await submitBkash(less.token, "LKP1000003", "0000");
    assert.strictEqual(pendingOf(less.order.id).gateway_check?.result, "AMOUNT_MISMATCH");
    const early = await newLink("l4", 600);
    bkashReceived("LKP1000004", 600, { completedTime: bkashTime(new Date(Date.now() - 5 * 3600_000)) });
    await submitBkash(early.token, "LKP1000004", "0000");
    assert.strictEqual(pendingOf(early.order.id).gateway_check?.result, "BEFORE_LINK");
    const other = await newLink("l4b", 600);
    bkashReceived("LKP1000014", 600);
    await submitBkash(other.token, "LKP1000014", "4821");
    assert.strictEqual(pendingOf(other.order.id).gateway_check?.result, "SENDER_MISMATCH");
    for (const o of [unknown, less, early, other]) assert.strictEqual(pendingOf(o.order.id).status, "PENDING");
  });

  await runTest("staff can check again (payments.verify only, own shop only); bKash being down is UNAVAILABLE", async () => {
    const { order, token } = await newLink("l5", 450);
    gateway.bkash.searchDown = true;
    const submitted = await submitBkash(token, "LKP1000005", "0000");
    gateway.bkash.searchDown = false;
    assert.strictEqual(submitted.status, 201, "bKash being down never blocks the customer");
    const payment = pendingOf(order.id);
    assert.strictEqual(payment.gateway_check?.result, "UNAVAILABLE");
    const checkedAt = payment.gateway_check!.checked_at;
    assert.strictEqual((await call("payments/[id]/check", "POST", { params: { id: payment.id } })).status, 401);
    assert.strictEqual((await call("payments/[id]/check", "POST", { headers: supportAuth, params: { id: payment.id } })).status, 403);
    assert.strictEqual((await call("payments/[id]/check", "POST", { headers: B.auth, params: { id: payment.id } })).status, 404);
    assert.strictEqual(pendingOf(order.id).gateway_check?.checked_at, checkedAt, "another shop's request changed nothing");
    bkashReceived("LKP1000005", 450);
    const again = await call("payments/[id]/check", "POST", { headers: A.auth, params: { id: payment.id } });
    assert.strictEqual(again.status, 200, JSON.stringify(again.body));
    assert.strictEqual(again.body.data!.payment.gateway_check.result, "MATCHED");
    assert.strictEqual(again.body.data!.auto_confirmed, false);
    assert.strictEqual(pendingOf(order.id).status, "PENDING");
    assert.ok(db.getAuditLogsByTenant(A.tenantId, 1000).logs.some((a) => a.action === "PAYMENT_TRX_CHECKED" && a.resource_id === payment.id));
    const nagad = await newLink("l6", 300);
    await call("pay/[token]/manual", "POST", { params: { token: nagad.token }, body: { method: "NAGAD", transaction_id: "NGD1000006" } });
    assert.strictEqual((await call("payments/[id]/check", "POST", { headers: A.auth, params: { id: pendingOf(nagad.order.id).id } })).status, 400);
  });

  await runTest("with auto-confirm on, a full match confirms once as 'gateway:BKASH_LOOKUP' (sandbox → TEST)", async () => {
    process.env.BKASH_TRX_AUTO_CONFIRM = "1";
    const sandboxOnly = await newLink("l7", 700);
    bkashReceived("LKP1000007", 700);
    assert.strictEqual((await submitBkash(sandboxOnly.token, "LKP1000007", "0000")).body.data!.status, "PENDING_VERIFICATION", "sandbox money needs PAYMENTS_SANDBOX_SETTLES");
    assert.strictEqual(pendingOf(sandboxOnly.order.id).status, "PENDING");

    autoOn();
    const { order, link, token } = await newLink("l8", 950);
    bkashReceived("LKP1000008", 950);
    const paid = await submitBkash(token, "LKP1000008", "0000");
    assert.strictEqual(paid.body.data!.status, "PAID", JSON.stringify(paid.body));
    const payment = pendingOf(order.id);
    assert.strictEqual(payment.status, "PAID");
    assert.strictEqual(payment.verification_method, "GATEWAY");
    assert.strictEqual(payment.verified_by, "gateway:BKASH_LOOKUP");
    assert.strictEqual(payment.test_mode, true);
    assert.strictEqual(db.findPaymentLinkById(A.tenantId, link.id)!.status, "PAID");
    assert.strictEqual(db.data.orders.find((o) => o.id === order.id)!.payment_status, "PAID");
    assert.ok(
      db.getAuditLogsByTenant(A.tenantId, 1000).logs.some((a) => a.action === "PAYMENT_VERIFIED" && a.resource_id === payment.id && a.actor_user_id === "gateway:BKASH_LOOKUP")
    );
    autoOff();
  });

  await runTest("auto-confirm on still leaves for a person: a short amount, no sender digits, no time, a checkout payment", async () => {
    autoOn();
    const short = await newLink("l9", 950);
    bkashReceived("LKP1000009", 95);
    assert.strictEqual((await submitBkash(short.token, "LKP1000009", "0000")).body.data!.status, "PENDING_VERIFICATION");
    const noDigits = await newLink("l9b", 950);
    bkashReceived("LKP1000019", 950);
    assert.strictEqual((await submitBkash(noDigits.token, "LKP1000019")).body.data!.status, "PENDING_VERIFICATION");
    const noTime = await newLink("l9c", 950);
    bkashReceived("LKP1000029", 950, { completedTime: undefined });
    assert.strictEqual((await submitBkash(noTime.token, "LKP1000029", "0000")).body.data!.status, "PENDING_VERIFICATION");
    const checkout = await newLink("l9d", 950);
    bkashReceived("LKP1000039", 950, { transactionType: "bKash Tokenized Checkout via API" });
    assert.strictEqual((await submitBkash(checkout.token, "LKP1000039", "0000")).body.data!.status, "PENDING_VERIFICATION");
    for (const o of [short, noDigits, noTime, checkout]) assert.strictEqual(pendingOf(o.order.id).status, "PENDING");
    autoOff();
  });

  await runTest("a TrxID a checkout already settled (even as a sandbox test) is never auto-confirmed on another link", async () => {
    const settled = db.data.gateway_payment_attempts.find((a) => a.provider === "BKASH" && a.status === "PAID")!;
    db.saveGatewayPaymentAttempt({ ...settled, id: `gp${crypto.randomBytes(13).toString("hex")}`, gateway_transaction_id: "LKP1000040", test_only: true });
    autoOn();
    const { order, token } = await newLink("l10a", 950);
    bkashReceived("LKP1000040", 950);
    assert.strictEqual((await submitBkash(token, "LKP1000040", "0000")).body.data!.status, "PENDING_VERIFICATION");
    assert.strictEqual(pendingOf(order.id).status, "PENDING");
    autoOff();
  });

  await runTest("a checkout whose bKash TrxID was already submitted by hand is refused: one transaction pays one thing", async () => {
    const manual = await newLink("l10b", 520);
    await submitBkash(manual.token, "LKP1000050", "0000");
    const viaCheckout = await newLink("l10c", 520);
    const started = await call("pay/[token]/checkout", "POST", { params: { token: viaCheckout.token }, body: { provider: "BKASH" } });
    assert.strictEqual(started.status, 200, JSON.stringify(started.body));
    const paymentId = new URL(started.body.data!.redirect_url).searchParams.get("paymentId")!;
    const attempt = attemptsFor(viaCheckout.link.id)[0];
    gateway.bkash.nextTrxId = "LKP1000050";
    const done = await call("payments/gateway/bkash/confirm", "POST", { body: { attempt_id: attempt.id, payment_id: paymentId, status: "success" } });
    assert.notStrictEqual(done.body.data!.status, "PAID", JSON.stringify(done.body));
    assert.strictEqual(db.getPayments(A.tenantId, viaCheckout.order.id).length, 0);
    assert.strictEqual(db.data.payments.filter((p) => p.transaction_id === "LKP1000050").length, 1);
  });

  await runTest("a staff re-check never confirms a payment whose link was cancelled", async () => {
    const { order, link, token } = await newLink("l10d", 610);
    bkashReceived("LKP1000060", 610);
    await submitBkash(token, "LKP1000060", "0000");
    assert.strictEqual((await call("payments/links/[id]/cancel", "POST", { headers: A.auth, params: { id: link.id } })).status, 200);
    autoOn();
    const again = await call("payments/[id]/check", "POST", { headers: A.auth, params: { id: pendingOf(order.id).id } });
    autoOff();
    assert.strictEqual(again.body.data!.auto_confirmed, false, JSON.stringify(again.body));
    assert.strictEqual(pendingOf(order.id).status, "PENDING");
    assert.strictEqual(db.findPaymentLinkById(A.tenantId, link.id)!.status, "CANCELLED");
  });

  await runTest("both routes that call bKash's search run outside the store lock (ADR-110, review H1)", () => {
    for (const route of ["src/app/api/v1/pay/[token]/manual/route.ts", "src/app/api/v1/payments/[id]/check/route.ts"]) {
      const source = fs.readFileSync(path.join(process.cwd(), route), "utf8");
      assert.ok(/withStore\("POST", handlePOST, \{ unit: false \}\)/.test(source), `${route}: bKash is called under the store lock`);
    }
  });

  await runTest("a link takes at most 5 transaction IDs in its life; refusals store nothing and never reach bKash", async () => {
    resetRateLimitsForTesting();
    const { order, token } = await newLink("l12", 333);
    const submitNagad = (trx: string) => call("pay/[token]/manual", "POST", { params: { token }, body: { method: "NAGAD", transaction_id: trx } });
    const view = async () => (await call("pay/[token]", "GET", { params: { token } })).body.data!.link;
    assert.strictEqual((await view()).can_submit_transaction_id, true);
    for (const trx of ["CAPA000001", "CAPA000002", "CAPA000003"]) assert.strictEqual((await submitNagad(trx)).status, 201);
    assert.strictEqual((await view()).can_submit_transaction_id, false, "3 waiting: the page hides the form");
    assert.strictEqual((await submitNagad("CAPA000004")).status, 409);
    // Staff reject the wrong ones; the link takes two more, then no more at all
    for (const p of db.getPayments(A.tenantId, order.id)) {
      assert.strictEqual((await call("payments/[id]/reject", "POST", { headers: A.auth, params: { id: p.id } })).status, 200);
    }
    resetRateLimitsForTesting();
    assert.strictEqual((await submitNagad("CAPA000005")).status, 201);
    assert.strictEqual((await submitNagad("CAPA000006")).status, 201);
    assert.strictEqual((await view()).can_submit_transaction_id, false, "5 in its life");
    const before = { rows: db.data.payments.length, bkash: searches().length };
    const full = await submitNagad("CAPA000007");
    assert.strictEqual(full.status, 409);
    assert.ok(/can't take more transaction IDs/.test(full.body.error?.message ?? ""), JSON.stringify(full.body));
    const fullBkash = await submitBkash(token, "CAPB000008", "0000");
    assert.strictEqual(fullBkash.status, 409);
    assert.strictEqual(db.data.payments.length, before.rows, "a refused submission writes nothing");
    assert.strictEqual(searches().length, before.bkash, "a refused submission never calls bKash");
  });

  await runTest("one link takes at most 5 submissions a minute; the 6th and later get 429", async () => {
    resetRateLimitsForTesting();
    const { token } = await newLink("l13", 210);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await call("pay/[token]/manual", "POST", { params: { token }, body: { method: "NAGAD", transaction_id: `RATE00000${i}` } })).status);
    }
    assert.deepStrictEqual(statuses.slice(5), [429, 429], JSON.stringify(statuses));
    resetRateLimitsForTesting();
  });

  await runTest("a shop without bKash merchant credentials gets no lookup", async () => {
    const C = await register("C");
    const order = seedOrder(C.tenantId, "l11", 400);
    await call("payments/settings", "PUT", { headers: C.auth, body: { manual: { bkash_number: "01911000555" } } });
    const link = (await call("payments/links", "POST", { headers: C.auth, body: { order_id: order.id } })).body.data!.link;
    const before = gateway.requests.length;
    const submitted = await submitBkash(link.path.split("/").pop()!, "LKPC000010", "0000");
    assert.strictEqual(submitted.status, 201, JSON.stringify(submitted.body));
    assert.strictEqual(gateway.requests.slice(before).filter((r) => r.url.includes("bka.sh")).length, 0);
    assert.strictEqual(db.getPayments(C.tenantId, order.id)[0].gateway_check, undefined);
  });

  // =====================================================================================================================
  console.log(`\n${ANSI_BOLD}[5] Subscription invoices (workspace → platform)${ANSI_RESET}`);
  resetRateLimitsForTesting();
  delete process.env.PAYMENTS_SANDBOX_SETTLES;

  const iso = new Date().toISOString();
  db.savePlan({ id: "PAYTEST", name: "Pay Test", description: "For the billing suite", is_active: true, visibility: "PUBLIC", created_at: iso, updated_at: iso });
  db.savePlanVersion({
    id: "pv_paytest_1", plan_id: "PAYTEST", version: 1, billing_period: "MONTHLY", price_bdt: 999, features: {}, is_published: true, status: "PUBLISHED",
    monthly_price_bdt: 999, annual_price_bdt: 9990, setup_fee_bdt: 500, created_at: iso,
  });
  db.savePlan({ id: "PAYHIDDEN", name: "Hidden deal", description: "", is_active: true, visibility: "HIDDEN", created_at: iso, updated_at: iso });
  db.savePlanVersion({ id: "pv_payhidden_1", plan_id: "PAYHIDDEN", version: 1, billing_period: "MONTHLY", price_bdt: 1, features: {}, is_published: true, status: "PUBLISHED", monthly_price_bdt: 1, created_at: iso });
  const planBefore = db.findSubscriptionByTenantId(A.tenantId)?.plan_id ?? null;

  let invoice1: { id: string; amount_bdt: number; status: string; invoice_number: string };

  await runTest("the billing page needs a session; buying needs settings.update; hidden plans can't be bought", async () => {
    assert.strictEqual((await call("billing", "GET")).status, 401);
    assert.strictEqual((await call("billing/invoices", "POST", { headers: supportAuth, body: { plan_id: "PAYTEST", billing_period: "MONTHLY" } })).status, 403);
    assert.strictEqual((await call("billing/invoices", "POST", { headers: A.auth, body: { plan_id: "PAYHIDDEN", billing_period: "MONTHLY" } })).status, 404);
    assert.strictEqual((await call("billing/invoices", "POST", { headers: A.auth, body: { plan_id: "PAYTEST", billing_period: "MONTHLY", amount_bdt: 1 } })).status, 400);
    const overview = await call("billing", "GET", { headers: A.auth });
    assert.strictEqual(overview.status, 200);
    const plans = overview.body.data!.plans as Array<{ id: string }>;
    assert.ok(plans.some((p) => p.id === "PAYTEST") && !plans.some((p) => p.id === "PAYHIDDEN"));
    assert.deepStrictEqual(overview.body.data!.payment_options.gateways, [], "no platform gateway configured: none offered");
    assert.strictEqual(overview.body.data!.payment_options.manual.bkash_number, null);
  });

  await runTest("the plans page shows each plan's enforced limits and this shop's use, nothing operator-only", async () => {
    db.savePlan({ id: "PAYLIMITS", name: "Limits", description: "", is_active: true, visibility: "PUBLIC", created_at: iso, updated_at: iso });
    db.savePlanVersion({
      id: "pv_paylimits_1", plan_id: "PAYLIMITS", version: 1, billing_period: "MONTHLY", price_bdt: 1500, is_published: true, status: "PUBLISHED",
      monthly_price_bdt: 1500, created_at: iso,
      features: { max_users: 3, max_products: null, ai_monthly_runs: 500, max_storage_gb: 50 },
    });
    const overview = await call("billing", "GET", { headers: A.auth });
    assert.strictEqual(overview.status, 200);
    const plan = (overview.body.data!.plans as Array<{ id: string; limits: Array<{ id: string; value: unknown }> }>).find((p) => p.id === "PAYLIMITS")!;
    const value = (id: string) => plan.limits.find((l) => l.id === id)?.value;
    assert.strictEqual(value("max_users"), 3);
    assert.strictEqual(value("max_products"), null, "null on a plan means unlimited");
    assert.strictEqual(value("ai_monthly_runs"), 500);
    assert.ok(!plan.limits.some((l) => l.id === "max_storage_gb"), "a limit nothing enforces is never shown as a promise");

    const usage = overview.body.data!.usage as Array<Record<string, unknown>>;
    const users = usage.find((u) => u.id === "max_users")!;
    assert.ok(typeof users.used === "number" && (users.used as number) >= 1, "the shop's own staff are counted");
    for (const row of usage) {
      for (const key of ["override", "source", "enforced_by", "granted_by", "ticket_ref"]) assert.ok(!(key in row), `usage leaks ${key}`);
    }
    assert.strictEqual((await call("billing", "GET", { headers: B.auth })).body.data!.usage.find((u: { id: string }) => u.id === "max_users").used >= 1, true);
  });

  await runTest("an invoice takes its price from the plan version (plus the one-time setup fee) and changes no plan", async () => {
    const created = await call("billing/invoices", "POST", { headers: A.auth, body: { plan_id: "PAYTEST", billing_period: "MONTHLY" } });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    invoice1 = created.body.data!.invoice;
    assert.strictEqual(invoice1.amount_bdt, 1499);
    assert.strictEqual(invoice1.status, "ISSUED");
    assert.strictEqual(db.findSubscriptionByTenantId(A.tenantId)?.plan_id ?? null, planBefore, "unpaid: the subscription is untouched");
    const replaced = await call("billing/invoices", "POST", { headers: A.auth, body: { plan_id: "PAYTEST", billing_period: "ANNUAL" } });
    assert.strictEqual(replaced.body.data!.invoice.amount_bdt, 10490);
    assert.strictEqual(db.findBillingInvoiceById(A.tenantId, invoice1.id)!.status, "VOID", "the older unpaid invoice is voided");
    invoice1 = replaced.body.data!.invoice;
  });

  await runTest("without a platform account neither online nor manual payment is offered (424 / 400), and nothing is paid", async () => {
    const online = await call("billing/invoices/[id]/checkout", "POST", { headers: A.auth, params: { id: invoice1.id }, body: { provider: "SSLCOMMERZ", phone: "01711000222" } });
    assert.strictEqual(online.status, 424);
    const manual = await call("billing/invoices/[id]/manual-payment", "POST", { headers: A.auth, params: { id: invoice1.id }, body: { method: "MANUAL_BKASH", transaction_id: "PLAT123456" } });
    assert.strictEqual(manual.status, 400);
    assert.strictEqual(db.findBillingInvoiceById(A.tenantId, invoice1.id)!.status, "ISSUED");
  });

  process.env.PLATFORM_BILLING_BKASH_NUMBER = "01300000001";
  process.env.PLATFORM_SSLCOMMERZ_STORE_ID = "platformstore";
  process.env.PLATFORM_SSLCOMMERZ_STORE_PASSWORD = "platform-pass@ssl";

  await runTest("another workspace can't pay, see or submit for this invoice", async () => {
    assert.strictEqual((await call("billing/invoices/[id]/manual-payment", "POST", { headers: B.auth, params: { id: invoice1.id }, body: { method: "MANUAL_BKASH", transaction_id: "PLAT123456" } })).status, 404);
    assert.strictEqual((await call("billing/invoices/[id]/checkout", "POST", { headers: B.auth, params: { id: invoice1.id }, body: { provider: "SSLCOMMERZ", phone: "01711000222" } })).status, 404);
    assert.strictEqual((await call("billing", "GET", { headers: B.auth })).body.data!.invoices.length, 0);
  });

  await runTest("a submitted transfer waits for an operator: the plan does not change, and workspace sessions can't verify it", async () => {
    const submitted = await call("billing/invoices/[id]/manual-payment", "POST", { headers: A.auth, params: { id: invoice1.id }, body: { method: "MANUAL_BKASH", transaction_id: "plat123456" } });
    assert.strictEqual(submitted.status, 200, JSON.stringify(submitted.body));
    assert.strictEqual(submitted.body.data!.invoice.status, "PENDING_VERIFICATION");
    assert.strictEqual(db.findSubscriptionByTenantId(A.tenantId)?.plan_id ?? null, planBefore);
    assert.strictEqual((await call("billing/invoices", "POST", { headers: A.auth, body: { plan_id: "PAYTEST", billing_period: "MONTHLY" } })).status, 409, "no second invoice while one is being checked");
    for (const route of ["platform/billing/invoices/[id]/verify", "platform/billing/invoices/[id]/reject"]) {
      const asOwner = await call(route, "POST", { headers: A.auth, params: { id: invoice1.id }, body: { reason: "I promise I paid this invoice" } });
      assert.ok(asOwner.status === 401 || asOwner.status === 403, `${route}: a workspace OWNER gets ${asOwner.status}`);
    }
    assert.ok([401, 403].includes((await call("platform/billing/invoices", "GET", { headers: A.auth })).status));
    assert.strictEqual(db.findBillingInvoiceById(A.tenantId, invoice1.id)!.status, "PENDING_VERIFICATION");
  });

  // A signed-in platform operator (finance) and one without billing.manage
  const operator = async (role: "PLATFORM_FINANCE" | "PLATFORM_SUPPORT") => {
    const id = `usr_pay_op_${crypto.randomUUID().slice(0, 8)}`;
    const opPassword = "Payments-Operator-Pass-3391!";
    db.createUser({ id, email: `${id}@operators.test`, name: `Op ${role}`, password_hash: await hashPassword(opPassword), status: "ACTIVE", created_at: iso, updated_at: iso });
    db.savePlatformMembership({ id: `pm_${id}`, user_id: id, role, mfa_enabled: false, is_active: true, created_at: iso, updated_at: iso });
    const login = await call("platform/auth/login", "POST", { body: { email: `${id}@operators.test`, password: opPassword } });
    assert.strictEqual(login.status, 200, JSON.stringify(login.body));
    const cookie = login.response.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${PLATFORM_AUTH_COOKIE_NAME}=`))!;
    return { id, headers: { cookie } };
  };
  const finance = await operator("PLATFORM_FINANCE");
  const support = await operator("PLATFORM_SUPPORT");

  await runTest("an operator without billing.manage can't verify; a reason is required; rejecting reopens the invoice", async () => {
    const denied = await call("platform/billing/invoices/[id]/verify", "POST", { headers: support.headers, params: { id: invoice1.id }, body: { reason: "Seen in the bKash statement" } });
    assert.strictEqual(denied.status, 403);
    const noReason = await call("platform/billing/invoices/[id]/verify", "POST", { headers: finance.headers, params: { id: invoice1.id }, body: { reason: "ok" } });
    assert.strictEqual(noReason.status, 400);
    const queue = await call("platform/billing/invoices", "GET", { headers: finance.headers, query: "?status=PENDING_VERIFICATION" });
    assert.strictEqual(queue.status, 200, JSON.stringify(queue.body));
    assert.ok((queue.body.data!.invoices as Array<{ id: string }>).some((i) => i.id === invoice1.id));
    const rejected = await call("platform/billing/invoices/[id]/reject", "POST", { headers: finance.headers, params: { id: invoice1.id }, body: { reason: "No such transfer in the bKash statement" } });
    assert.strictEqual(rejected.status, 200, JSON.stringify(rejected.body));
    const reopened = db.findBillingInvoiceById(A.tenantId, invoice1.id)!;
    assert.strictEqual(reopened.status, "ISSUED");
    assert.strictEqual(reopened.manual_transaction_id, undefined);
    assert.strictEqual(db.findSubscriptionByTenantId(A.tenantId)?.plan_id ?? null, planBefore);
  });

  await runTest("verifying a submitted transfer pays the invoice, applies the plan for one period and is audited", async () => {
    await call("billing/invoices/[id]/manual-payment", "POST", { headers: A.auth, params: { id: invoice1.id }, body: { method: "MANUAL_BKASH", transaction_id: "PLAT777888" } });
    const verified = await call("platform/billing/invoices/[id]/verify", "POST", { headers: finance.headers, params: { id: invoice1.id }, body: { reason: "Found ৳10,490 from this number in the bKash statement" } });
    assert.strictEqual(verified.status, 200, JSON.stringify(verified.body));
    const paid = db.findBillingInvoiceById(A.tenantId, invoice1.id)!;
    assert.strictEqual(paid.status, "PAID");
    assert.strictEqual(paid.verified_by, finance.id);
    const sub = db.findSubscriptionByTenantId(A.tenantId)!;
    assert.strictEqual(sub.plan_id, "PAYTEST");
    assert.strictEqual(sub.status, "ACTIVE");
    assert.strictEqual(sub.billing_period, "ANNUAL");
    assert.strictEqual(sub.trial_ends_at, undefined);
    const days = (Date.parse(sub.current_period_end) - Date.parse(sub.current_period_start)) / 86_400_000;
    assert.ok(days >= 365 && days <= 366, `one year, got ${days} days`);
    assert.strictEqual(db.findTenantById(A.tenantId)!.plan_id, "PAYTEST");
    assert.ok(db.getPlatformAuditLogs({ action: "billing.verify_payment" }).logs.some((l) => l.action === "billing.verify_payment" && l.resource_id === invoice1.id && l.actor_id === finance.id));
    const twice = await call("platform/billing/invoices/[id]/verify", "POST", { headers: finance.headers, params: { id: invoice1.id }, body: { reason: "Found it again in the statement" } });
    assert.strictEqual(twice.status, 409, "a paid invoice is not verified twice");
  });

  await runTest("one transfer pays one invoice: a used transaction id is refused for another workspace", async () => {
    const created = await call("billing/invoices", "POST", { headers: B.auth, body: { plan_id: "PAYTEST", billing_period: "MONTHLY" } });
    const reused = await call("billing/invoices/[id]/manual-payment", "POST", { headers: B.auth, params: { id: created.body.data!.invoice.id }, body: { method: "MANUAL_BKASH", transaction_id: "PLAT777888" } });
    assert.strictEqual(reused.status, 409);
  });

  await runTest("a renewal is charged without the setup fee and its period is added after the current one", async () => {
    const before = db.findSubscriptionByTenantId(A.tenantId)!;
    const renewal = (await call("billing/invoices", "POST", { headers: A.auth, body: { plan_id: "PAYTEST", billing_period: "MONTHLY" } })).body.data!.invoice;
    assert.strictEqual(renewal.kind, "RENEWAL");
    assert.strictEqual(renewal.amount_bdt, 999);

    // Paid online through the platform's own SSLCommerz account
    const started = await call("billing/invoices/[id]/checkout", "POST", { headers: A.auth, params: { id: renewal.id }, body: { provider: "SSLCOMMERZ", phone: "01711000222" } });
    assert.strictEqual(started.status, 200, JSON.stringify(started.body));
    const sent = new URLSearchParams(gateway.requests.filter((r) => r.url.includes("gwprocess")).pop()!.body);
    assert.strictEqual(sent.get("store_id"), "platformstore", "the platform's account, never the shop's");
    assert.strictEqual(sent.get("total_amount"), "999.00");
    const paid = sslPay(started.body.data!.redirect_url, { card_type: "VISA-Dutch Bangla" });

    const sandbox = await call("payments/gateway/sslcommerz/return", "POST", { form: { tran_id: paid.tran_id, status: "VALID", val_id: paid.val_id } });
    assert.ok(sandbox.response.headers.get("location")!.includes(`/settings/billing?invoice=${renewal.id}&payment=test`));
    assert.strictEqual(db.findBillingInvoiceById(A.tenantId, renewal.id)!.status, "ISSUED", "sandbox money renews nothing by default");

    process.env.PAYMENTS_SANDBOX_SETTLES = "1";
    const again = await call("billing/invoices/[id]/checkout", "POST", { headers: A.auth, params: { id: renewal.id }, body: { provider: "SSLCOMMERZ", phone: "01711000222" } });
    const paid2 = sslPay(again.body.data!.redirect_url);
    const settled = await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: paid2.tran_id, status: "VALID", val_id: paid2.val_id } });
    assert.strictEqual((settled.body as unknown as { status: string }).status, "PAID");
    const invoice = db.findBillingInvoiceById(A.tenantId, renewal.id)!;
    assert.strictEqual(invoice.status, "PAID");
    assert.strictEqual(invoice.verified_by, "gateway:SSLCOMMERZ");
    assert.strictEqual(invoice.test_mode, true);
    const after = db.findSubscriptionByTenantId(A.tenantId)!;
    assert.strictEqual(after.current_period_start, before.current_period_start);
    assert.strictEqual(invoice.period_start, before.current_period_end, "added after the period already paid for");
    assert.ok(Date.parse(after.current_period_end) > Date.parse(before.current_period_end));
    assert.strictEqual(db.getPayments(A.tenantId).filter((p) => p.idempotency_key === `gateway:${paid2.tran_id}`).length, 0, "a subscription payment is never a store payment");
  });

  // =====================================================================================================================
  console.log(`\n${ANSI_BOLD}[6] Hardening from the security review${ANSI_RESET}`);
  resetRateLimitsForTesting();
  delete process.env.PAYMENTS_SANDBOX_SETTLES;

  await runTest("parallel bKash checkouts make one token grant; a refused grant is not retried straight away", async () => {
    resetBkashTokensForTesting();
    gateway.bkash.grants = 0;
    const order = seedOrder(A.tenantId, "a6", 800);
    const link = (await call("payments/links", "POST", { headers: A.auth, body: { order_id: order.id } })).body.data!.link;
    const token = link.path.split("/").pop()!;
    const started = await Promise.all([1, 2, 3, 4].map(() => call("pay/[token]/checkout", "POST", { params: { token }, body: { provider: "BKASH" } })));
    assert.deepStrictEqual(started.map((r) => r.status), [200, 200, 200, 200]);
    assert.strictEqual(gateway.bkash.grants, 1, "one grant for four checkouts started together");
    const sent = JSON.parse(gateway.requests.filter((r) => r.url.endsWith("/payment/create")).pop()!.body) as Record<string, string>;
    assert.ok(/^gp[0-9a-f]{26}$/.test(sent.payerReference), "the customer's phone number is not sent to bKash's page");

    // Shop B's bKash credentials are wrong (and SANDBOX here): the first refusal is remembered
    resetBkashTokensForTesting();
    gateway.bkash.grants = 0;
    await call("payments/settings", "PUT", { headers: B.auth, body: { gateways: { BKASH: { enabled: true, mode: "SANDBOX", credentials: { app_key: "k", app_secret: "bad", username: "u", password: "p" } } } } });
    const orderB = seedOrder(B.tenantId, "b3", 500);
    const linkB = (await call("payments/links", "POST", { headers: B.auth, body: { order_id: orderB.id } })).body.data!.link;
    const tokenB = linkB.path.split("/").pop()!;
    assert.strictEqual((await call("pay/[token]/checkout", "POST", { params: { token: tokenB }, body: { provider: "BKASH" } })).status, 502);
    assert.strictEqual((await call("pay/[token]/checkout", "POST", { params: { token: tokenB }, body: { provider: "BKASH" } })).status, 502);
    assert.strictEqual(gateway.bkash.grants, 1, "the refused grant is not asked again");
  });

  await runTest("junk tokens and attempt ids are refused before anything else; a BKASH attempt is unknown to the SSLCommerz routes", async () => {
    assert.strictEqual((await call("pay/[token]/manual", "POST", { params: { token: "short" }, body: { method: "BKASH", transaction_id: "ABC12345" } })).status, 404);
    assert.strictEqual((await call("pay/[token]/checkout", "POST", { params: { token: "short" }, body: { provider: "BKASH" } })).status, 404);
    const junk = await call("payments/gateway/sslcommerz/return", "POST", { form: { tran_id: "not-an-attempt", status: "VALID", val_id: "x" } });
    assert.strictEqual(junk.status, 404);
    assert.strictEqual(junk.response.headers.get("location"), null, "no redirect for an unknown attempt");
    const bkashAttempt = db.data.gateway_payment_attempts.find((a) => a.provider === "BKASH")!;
    assert.strictEqual((await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: bkashAttempt.id, val_id: "x" } })).status, 404);
  });

  await runTest("a val_id of another store, another currency, or an already-used bank transaction pays nothing", async () => {
    const order = seedOrder(A.tenantId, "a7", 650);
    const link = (await call("payments/links", "POST", { headers: A.auth, body: { order_id: order.id } })).body.data!.link;
    const token = link.path.split("/").pop()!;
    process.env.PAYMENTS_SANDBOX_SETTLES = "1";
    const checkout = async () => (await call("pay/[token]/checkout", "POST", { params: { token }, body: { provider: "SSLCOMMERZ" } })).body.data!.redirect_url as string;
    const ipn = async (p: { tran_id: string; val_id: string }) =>
      ((await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: p.tran_id, status: "VALID", val_id: p.val_id } })).body as unknown as { status: string }).status;

    assert.strictEqual(await ipn(sslPay(await checkout(), { store_id: "someone-elses-store" })), "FAILED");
    assert.strictEqual(await ipn(sslPay(await checkout(), { currency_type: "USD", currency: "USD" })), "PENDING");
    const usedBankId = db.data.gateway_payment_attempts.find((a) => a.provider === "SSLCOMMERZ" && a.status === "PAID" && !a.test_only)!.gateway_transaction_id!;
    assert.strictEqual(await ipn(sslPay(await checkout(), { bank_tran_id: usedBankId })), "PENDING");
    assert.strictEqual(db.getPayments(A.tenantId, order.id).length, 0);
    assert.strictEqual(db.data.orders.find((o) => o.id === order.id)!.payment_status, "UNPAID");

    // An attempt older than the confirmation window is left alone: no gateway call at all
    const stale = sslPay(await checkout());
    db.saveGatewayPaymentAttempt({ ...db.findGatewayPaymentAttempt(stale.tran_id)!, created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    const before = gateway.requests.length;
    assert.strictEqual(await ipn(stale), "PENDING");
    assert.strictEqual(gateway.requests.length, before, "no validation call for a stale attempt");
    delete process.env.PAYMENTS_SANDBOX_SETTLES;
  });

  await runTest("a rejected payment can't be confirmed afterwards", async () => {
    const order = seedOrder(A.tenantId, "a8", 400);
    const link = (await call("payments/links", "POST", { headers: A.auth, body: { order_id: order.id } })).body.data!.link;
    const token = link.path.split("/").pop()!;
    await call("pay/[token]/manual", "POST", { params: { token }, body: { method: "BKASH", transaction_id: "RJ11223344" } });
    const payment = db.getPayments(A.tenantId, order.id)[0];
    assert.strictEqual((await call("payments/[id]/reject", "POST", { headers: A.auth, params: { id: payment.id } })).status, 200);
    const verify = await call("payments/verify", "POST", { headers: A.auth, body: { payment_id: payment.id, transaction_id: "RJ11223344" } });
    assert.strictEqual(verify.status, 409);
    assert.strictEqual(db.findPaymentById(A.tenantId, payment.id)!.status, "FAILED");
    assert.strictEqual(db.findPaymentLinkById(A.tenantId, link.id)!.status, "ACTIVE");
  });

  await runTest("an invoice past its due date can't be paid; sandbox money never buys a plan in production", async () => {
    const invoice = (await call("billing/invoices", "POST", { headers: B.auth, body: { plan_id: "PAYTEST", billing_period: "MONTHLY" } })).body.data!.invoice;
    process.env.PAYMENTS_SANDBOX_SETTLES = "1";
    const env = process.env as Record<string, string | undefined>;
    const nodeEnv = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const started = await call("billing/invoices/[id]/checkout", "POST", { headers: B.auth, params: { id: invoice.id }, body: { provider: "SSLCOMMERZ", phone: "01911000444" } });
      assert.strictEqual(started.status, 200, JSON.stringify(started.body));
      const paid = sslPay(started.body.data!.redirect_url);
      const settled = await call("payments/gateway/sslcommerz/ipn", "POST", { form: { tran_id: paid.tran_id, status: "VALID", val_id: paid.val_id } });
      assert.strictEqual((settled.body as unknown as { status: string }).status, "TEST");
      assert.strictEqual(db.findBillingInvoiceById(B.tenantId, invoice.id)!.status, "ISSUED");
    } finally {
      env.NODE_ENV = nodeEnv;
      delete process.env.PAYMENTS_SANDBOX_SETTLES;
    }
    db.saveBillingInvoice({ ...db.findBillingInvoiceById(B.tenantId, invoice.id)!, due_date: new Date(Date.now() - 1000).toISOString() });
    const late = await call("billing/invoices/[id]/manual-payment", "POST", { headers: B.auth, params: { id: invoice.id }, body: { method: "MANUAL_BKASH", transaction_id: "LATE123456" } });
    assert.strictEqual(late.status, 409);
    assert.strictEqual((await call("billing/invoices/[id]/checkout", "POST", { headers: B.auth, params: { id: invoice.id }, body: { provider: "SSLCOMMERZ", phone: "01911000444" } })).status, 409);
  });

  setOutboundTransportForTesting(null);
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Payments suite crashed:", err);
  process.exit(1);
});
