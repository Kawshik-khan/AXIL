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
  // PLAN_LIMIT_OVERRIDE: this suite adds many members directly; plan limits apply since FX-34
  db.saveTenantEntitlement({ tenant_id: tenantId, entitlement_id: "max_users", value: 1000, is_override: true, updated_at: new Date().toISOString() });
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
    assert.strictEqual(db.getCampaignById(tenantId, id)?.status, "DRAFT");
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
    const stored = db.getCampaignById(tenantId, id);
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

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-13] Tenant-scoped lookups (H13)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const otherToken = (await AuthService.login(other.user.email, "Phase1-Other-Pass-5582!", other.tenant.id)).token;
  const getRoute = async (route: string, id: string, token: string, query = ""): Promise<Response> => {
    type Handler = (r: Request, ctx: { params: { id: string } }) => Promise<Response>;
    const mod = (await import(`@/app/api/v1/${route}/route`)) as { GET: Handler };
    return mod.GET(
      new Request(`${BASE}/${route.replace("[id]", id)}${query}`, { headers: { authorization: `Bearer ${token}` } }),
      { params: { id } }
    );
  };

  await runTest("another workspace cannot approve this workspace's AI approval request → 404", async () => {
    const approvalId = uid("apr_p1");
    db.insertApprovalRequest({
      id: approvalId, tenant_id: tenantId, workflow_id: "wf_none", task_id: "task_none", requested_by_agent: "SALES_AGENT",
      action: "APPLY_DISCOUNT", risk_level: "HIGH", target_entity_type: "ORDER", target_entity_id: "ord_none",
      entity_state_snapshot: {}, payload: {}, reason: "test", status: "PENDING",
      expires_at: new Date(Date.now() + 3600_000).toISOString(), created_at: nowIso(),
    } as never);
    const mod = (await import("@/app/api/v1/ai/approvals/[id]/route")) as {
      POST: (r: Request, ctx: { params: { id: string } }) => Promise<Response>;
    };
    const res = await mod.POST(new Request(`${BASE}/ai/approvals/${approvalId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${otherToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "APPROVE" }),
    }), { params: { id: approvalId } });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(db.getApprovalRequestById(tenantId, approvalId)?.status, "PENDING");
  });

  await runTest("another workspace cannot read this workspace's executive digest → 404", async () => {
    const digestId = uid("dig_p1");
    db.insertExecutiveDigest({ id: digestId, tenant_id: tenantId, period_type: "DAILY", title: "Private digest" } as never);
    assert.strictEqual((await getRoute("analytics/digests/[id]", digestId, otherToken)).status, 404);
    assert.strictEqual((await getRoute("analytics/digests/[id]", digestId, ownerToken)).status, 200);
  });

  await runTest("store accessors return nothing for another tenant's id", () => {
    const campaignId = uid("camp_p1");
    db.insertCampaign({
      id: campaignId, tenant_id: tenantId, name: "Mine", objective: "ENGAGEMENT", status: "DRAFT", audience_id: "aud_x",
      channel: "WHATSAPP", variants: [], action_risk_level: "LOW", required_approval: false, risk_class: "LOW",
      created_by: shop.user.id, created_at: nowIso(), updated_at: nowIso(),
    } as never);
    assert.strictEqual(db.getCampaignById(other.tenant.id, campaignId), undefined);
    assert.throws(() => db.updateCampaign(other.tenant.id, campaignId, { name: "Stolen" }));
    assert.strictEqual(db.getCampaignById(tenantId, campaignId)?.name, "Mine");
  });

  await runTest("enterprise: a workspace can't use another workspace's organization → 404", async () => {
    const mod = (await import("@/app/api/v1/enterprise/organizations/route")) as { POST: (r: Request) => Promise<Response> };
    const created = await mod.POST(new Request(`${BASE}/enterprise/organizations`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Phase One Group" }),
    }));
    assert.strictEqual(created.status, 201);
    const orgId = ((await created.json()) as { data: { id: string } }).data.id;
    assert.strictEqual(db.findOrganizationById(orgId)?.tenant_id, tenantId, "the new organization is owned by its creator");

    const overview = (token: string, query: string) =>
      import("@/app/api/v1/enterprise/overview/route").then((m: { GET: (r: Request) => Promise<Response> }) =>
        m.GET(new Request(`${BASE}/enterprise/overview${query}`, { headers: { authorization: `Bearer ${token}` } })));
    assert.strictEqual((await overview(otherToken, `?organization_id=${orgId}`)).status, 404, "foreign org id");
    assert.strictEqual((await overview(otherToken, "?organization_id=org_default")).status, 404, "the shared demo org");
    assert.strictEqual((await overview(otherToken, "")).status, 404, "no organization of its own");
    assert.notStrictEqual((await overview(ownerToken, "")).status, 404, "the owner resolves its own organization");
  });

  await runTest("enterprise: the organization list shows only this workspace's organizations", async () => {
    const mod = (await import("@/app/api/v1/enterprise/organizations/route")) as { GET: (r: Request) => Promise<Response> };
    const res = await mod.GET(new Request(`${BASE}/enterprise/organizations`, { headers: { authorization: `Bearer ${otherToken}` } }));
    const body = (await res.json()) as { data: { organizations: Array<{ tenant_id?: string }> } };
    assert.ok(body.data.organizations.every((o) => o.tenant_id === other.tenant.id));
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-14] Rate limiting (M13)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const { checkRateLimit } = await import("@/lib/rate-limit");
  const loginRoute = (await import("@/app/api/v1/auth/login/route")) as { POST: (r: Request) => Promise<Response> };
  const tryLogin = (email: string, password: string) =>
    loginRoute.POST(new Request(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }));

  await runTest("the 11th login attempt for one account within 15 minutes → 429 with Retry-After", async () => {
    const victim = await AuthService.registerTenantWithOwner({
      email: `${uid("brute")}@phase1.test`, password: "Brute-Target-Pass-9012!", name: "Target", workspaceName: `Target ${Date.now()}`,
    });
    for (let i = 0; i < 10; i++) {
      assert.strictEqual((await tryLogin(victim.user.email, `wrong-guess-${i}`)).status, 401);
    }
    const blocked = await tryLogin(victim.user.email, "Brute-Target-Pass-9012!");
    assert.strictEqual(blocked.status, 429, "even the right password is refused while limited");
    assert.ok(Number(blocked.headers.get("retry-after")) > 0, "Retry-After is set");
  });

  await runTest("the limit is per account: another account still signs in", async () => {
    assert.strictEqual((await tryLogin(shop.user.email, "Phase1-Owner-Pass-4471!")).status, 200);
  });

  await runTest("platform login is limited per account too", async () => {
    const route = (await import("@/app/api/v1/platform/auth/login/route")) as { POST: (r: Request) => Promise<Response> };
    const email = `${uid("op")}@operators.test`;
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await route.POST(new Request(`${BASE}/platform/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: `guess-${i}` }),
      }))).status;
    }
    assert.strictEqual(last, 429);
  });

  await runTest("a widget visitor sending more than 30 messages a minute → 429", async () => {
    const now = Date.now();
    const key = `widget:visitor:test:${uid("anon")}`;
    for (let i = 0; i < 30; i++) assert.strictEqual(checkRateLimit(key, 30, 60_000, now).allowed, true);
    const blocked = checkRateLimit(key, 30, 60_000, now);
    assert.strictEqual(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec > 0);
    assert.strictEqual(checkRateLimit(key, 30, 60_000, now + 61_000).allowed, true, "the window slides");
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-15] Session hygiene and real MFA (H10, M9, M10)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const { generateTotp } = await import("@/lib/totp");
  const { hashPassword, PLATFORM_AUTH_COOKIE_NAME } = await import("@/lib/security");
  type Route = { POST: (r: Request) => Promise<Response> };
  const platformRoute = async (path: string) => (await import(`@/app/api/v1/platform/auth/${path}/route`)) as Route;
  const postPlatform = async (path: string, body: unknown, cookie?: string) =>
    (await platformRoute(path)).POST(new Request(`${BASE}/platform/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }));
  const cookieFrom = (res: Response) => {
    const c = res.headers.getSetCookie().find((v) => v.startsWith(`${PLATFORM_AUTH_COOKIE_NAME}=`));
    return c ? c.split(";")[0] : undefined;
  };
  const newOperator = async (password: string) => {
    const id = uid("usr_op");
    const email = `${id}@operators.test`;
    db.createUser({ id, email, name: "Operator", password_hash: await hashPassword(password), status: "ACTIVE", created_at: nowIso(), updated_at: nowIso() });
    db.savePlatformMembership({ id: `pm_${id}`, user_id: id, role: "SUPER_ADMIN", mfa_enabled: false, is_active: true, created_at: nowIso(), updated_at: nowIso() });
    return { id, email };
  };

  await runTest("TOTP matches the RFC 6238 test vectors", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    assert.strictEqual(generateTotp(secret, 59_000), "287082");
    assert.strictEqual(generateTotp(secret, 1111111109_000), "081804");
    assert.strictEqual(generateTotp(secret, 2000000000_000), "279037");
  });

  await runTest("step-up needs an enrolled authenticator; enroll → confirm → step-up works; a code can't be replayed", async () => {
    const op = await newOperator("Operator-Enroll-Pass-3321!");
    const login = await postPlatform("login", { email: op.email, password: "Operator-Enroll-Pass-3321!" });
    assert.strictEqual(login.status, 200);
    const cookie = cookieFrom(login);
    assert.ok(cookie, "operator without MFA gets a (non-MFA) session");

    const notEnrolled = await postPlatform("step-up", { code: "123456" }, cookie);
    assert.strictEqual(notEnrolled.status, 409);

    const enroll = await postPlatform("mfa/enroll", { password: "Operator-Enroll-Pass-3321!" }, cookie);
    assert.strictEqual(enroll.status, 200);
    const { secret } = ((await enroll.json()) as { data: { secret: string } }).data;
    assert.strictEqual(db.findPlatformMembershipByUserId(op.id)?.mfa_enabled, false, "not enabled before confirmation");
    assert.strictEqual((await postPlatform("mfa/confirm", { code: "000000" }, cookie)).status, 400, "wrong code refused");
    assert.strictEqual((await postPlatform("mfa/confirm", { code: generateTotp(secret) }, cookie)).status, 200);
    assert.strictEqual(db.findPlatformMembershipByUserId(op.id)?.mfa_enabled, true);
    assert.ok(!JSON.stringify(db.findPlatformMembershipByUserId(op.id)).includes(secret), "the secret is stored encrypted");

    const nextCode = generateTotp(secret, Date.now() + 30_000);
    const stepUp = await postPlatform("step-up", { code: nextCode }, cookie);
    assert.strictEqual(stepUp.status, 200);
    assert.ok(((await stepUp.json()) as { data: { stepUpToken?: string } }).data.stepUpToken);
    assert.strictEqual((await postPlatform("step-up", { code: nextCode }, cookie)).status, 400, "replayed code refused");
  });

  await runTest("an operator with MFA needs a TOTP code to sign in; only then is the session MFA-verified", async () => {
    const op = await newOperator("Operator-Login-Pass-4432!");
    const first = await postPlatform("login", { email: op.email, password: "Operator-Login-Pass-4432!" });
    const cookie = cookieFrom(first);
    const enroll = await postPlatform("mfa/enroll", { password: "Operator-Login-Pass-4432!" }, cookie);
    const { secret } = ((await enroll.json()) as { data: { secret: string } }).data;
    assert.strictEqual((await postPlatform("mfa/confirm", { code: generateTotp(secret) }, cookie)).status, 200);

    const login = await postPlatform("login", { email: op.email, password: "Operator-Login-Pass-4432!" });
    assert.strictEqual(login.status, 200);
    assert.strictEqual(cookieFrom(login), undefined, "no session after the password alone");
    const { mfa_token } = ((await login.json()) as { data: { mfa_required: boolean; mfa_token: string } }).data;
    assert.strictEqual((await postPlatform("mfa/verify", { mfa_token, code: "000000" })).status, 401);
    const verified = await postPlatform("mfa/verify", { mfa_token, code: generateTotp(secret, Date.now() + 30_000) });
    assert.strictEqual(verified.status, 200);
    const session = cookieFrom(verified);
    assert.ok(session);
    const ctx = await (await import("@/lib/api-response")).extractPlatformContext(
      new Request(`${BASE}/platform/overview`, { headers: { cookie: session } })
    );
    assert.strictEqual(ctx.mfaVerified, true);
  });

  await runTest("'sign out everywhere' revokes existing sessions", async () => {
    const { token } = await AuthService.login(shop.user.email, "Phase1-Owner-Pass-4471!");
    await AuthService.resolveRequestContext(token); // valid now
    const route = (await import("@/app/api/v1/auth/sessions/revoke-all/route")) as Route;
    const res = await route.POST(new Request(`${BASE}/auth/sessions/revoke-all`, { method: "POST", headers: { authorization: `Bearer ${token}` } }));
    assert.strictEqual(res.status, 200);
    await assert.rejects(() => AuthService.resolveRequestContext(token), /signed out/i);
    const fresh = await AuthService.login(shop.user.email, "Phase1-Owner-Pass-4471!");
    await AuthService.resolveRequestContext(fresh.token); // a new sign-in works
  });

  await runTest("changing an account's status revokes its sessions", async () => {
    const user = await member(tenantId, "SALES");
    await AuthService.resolveRequestContext(user.token);
    db.updateUser(user.id, { status: "SUSPENDED" });
    db.updateUser(user.id, { status: "ACTIVE" });
    await assert.rejects(() => AuthService.resolveRequestContext(user.token), /signed out/i);
  });

  await runTest("platform operators get no implicit OWNER role in workspaces they don't belong to (M10)", async () => {
    const op = await newOperator("Operator-NoTenant-Pass-5543!");
    await assert.rejects(() => AuthService.login(op.email, "Operator-NoTenant-Pass-5543!"), /no active workspaces/i);
    const forged = await signSessionToken({ userId: op.id, tenantId, role: "OWNER", email: op.email, name: "Operator" });
    await assert.rejects(() => AuthService.resolveRequestContext(forged), /no longer a member/i);
  });

  await runTest("logout clears both the workspace and the platform session cookies", async () => {
    const route = (await import("@/app/api/v1/auth/logout/route")) as { POST: () => Promise<Response> };
    const cleared = (await route.POST()).headers.getSetCookie();
    assert.ok(cleared.some((c) => c.startsWith("commerceos_session=;") && /max-age=0/i.test(c)));
    assert.ok(cleared.some((c) => c.startsWith(`${PLATFORM_AUTH_COOKIE_NAME}=;`) && /max-age=0/i.test(c)));
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-16] Cryptographic tokens and IDs (M4)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("newId and randomSuffix are unique and well-formed", async () => {
    const { newId, randomSuffix } = await import("@/lib/ids");
    const ids = new Set(Array.from({ length: 2000 }, () => newId("x")));
    assert.strictEqual(ids.size, 2000);
    assert.ok(/^x_[0-9a-f]{32}$/.test(newId("x")));
    assert.ok(/^[a-z0-9]{12}$/.test(randomSuffix()));
  });

  await runTest("invitation tokens come from a CSPRNG (48 base64url characters, 288 bits)", async () => {
    const { InvitationService } = await import("@/domains/invitations/service");
    const inv = InvitationService.createInvitation(tenantId, `${uid("inv")}@phase1.test`, "SALES", shop.user.id);
    assert.ok(/^[A-Za-z0-9_-]{48}$/.test(inv.token), inv.token);
  });

  await runTest("no server code builds IDs from Math.random().toString(36) any more", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes("Math.random().toString(36)") && !/^\s*["']use client["']/.test(text)) offenders.push(full);
        }
      }
    };
    walk(path.resolve(__dirname, "..", "src"));
    assert.deepStrictEqual(offenders, []);
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-17] Error hygiene and security headers (L1, L2, L8)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("unexpected errors return a generic 500 with a request id, never the internal message", async () => {
    const { apiError } = await import("@/lib/api-response");
    const res = apiError(new Error("JWT_SECRET is missing and db path C:/internal/secret"));
    assert.strictEqual(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes("JWT_SECRET") && !text.includes("C:/internal"), text);
    assert.ok(/"request_id":"req_/.test(text));
  });

  await runTest("a Zod validation error from .parse() is a 400, not a generic 500", async () => {
    const { apiError } = await import("@/lib/api-response");
    const { z } = await import("zod");
    const parsed = z.object({ name: z.string() }).strict().safeParse({ name: 1, extra: true });
    assert.ok(!parsed.success);
    const res = apiError(parsed.error);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.text()).includes("VALIDATION_ERROR"));
  });

  await runTest("a missing record is a 404, not a 500", async () => {
    const fresh = (await AuthService.login(shop.user.email, "Phase1-Owner-Pass-4471!")).token; // earlier test revoked sessions
    const res = await sendJson(`growth/campaigns/[id]`, "camp_does_not_exist", "PUT", fresh, { name: "x" });
    assert.strictEqual(res.status, 404);
  });

  await runTest("security headers are configured for every path", async () => {
    const config = (await import("../next.config.js")) as { default?: { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string }> }>> }; headers?: () => Promise<Array<{ source: string; headers: Array<{ key: string }> }>> };
    const headersFn = config.headers ?? config.default?.headers;
    assert.ok(headersFn, "next.config.js exports headers()");
    const rules = await headersFn();
    const keys = rules.find((r) => r.source === "/:path*")?.headers.map((h) => h.key) ?? [];
    for (const key of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy", "Content-Security-Policy-Report-Only"]) {
      assert.ok(keys.includes(key), `missing ${key}`);
    }
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-18] Service tokens for automations; webhook duplicates (N2)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const ownerNow = (await AuthService.login(shop.user.email, "Phase1-Owner-Pass-4471!")).token;
  const tokensRoute = (await import("@/app/api/v1/service-tokens/route")) as {
    GET: (r: Request) => Promise<Response>;
    POST: (r: Request) => Promise<Response>;
  };
  const createToken = (token: string, body: unknown) =>
    tokensRoute.POST(new Request(`${BASE}/service-tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  const notify = async (bearer: string) => {
    const route = (await import("@/app/api/v1/automation/actions/notifications/send/route")) as Route;
    return route.POST(new Request(`${BASE}/automation/actions/notifications/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", "idempotency-key": uid("idem") },
      body: JSON.stringify({ channel: "SMS", recipient: "+8801811000001", message: "Your order shipped" }),
    }));
  };
  let serviceToken = "";

  await runTest("an OWNER creates a service token; it is shown once and never listed", async () => {
    const res = await createToken(ownerNow, { name: "n8n", scopes: ["notifications.send"], expires_in_days: 30 });
    assert.strictEqual(res.status, 201);
    serviceToken = ((await res.json()) as { data: { token: string } }).data.token;
    assert.ok(serviceToken.startsWith("cos_svc_"));
    const list = await tokensRoute.GET(new Request(`${BASE}/service-tokens`, { headers: { authorization: `Bearer ${ownerNow}` } }));
    const text = await list.text();
    assert.ok(!text.includes(serviceToken) && !text.includes("key_hash"), "neither the token nor its hash is listed");
  });

  await runTest("the token works for its scope and nothing else", async () => {
    assert.strictEqual((await notify(serviceToken)).status, 200);
    const inventory = (await import("@/app/api/v1/automation/actions/inventory/adjust/route")) as Route;
    const res = await inventory.POST(new Request(`${BASE}/automation/actions/inventory/adjust`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json", "idempotency-key": uid("idem") },
      body: JSON.stringify({ warehouse_id: "wh_x", product_variant_id: "var_x", quantity_delta: 5 }),
    }));
    assert.strictEqual(res.status, 403);
  });

  await runTest("tokens can't carry disallowed scopes or scopes the creator lacks", async () => {
    assert.strictEqual((await createToken(ownerNow, { name: "too much", scopes: ["user.invite"] })).status, 400);
    const analyst2 = await member(tenantId, "ANALYST");
    assert.strictEqual((await createToken(analyst2.token, { name: "nope", scopes: ["orders.read"] })).status, 403);
  });

  await runTest("revoked and expired tokens are refused (401)", async () => {
    const created = await createToken(ownerNow, { name: "short", scopes: ["notifications.send"] });
    const { token, service_token } = ((await created.json()) as { data: { token: string; service_token: { id: string } } }).data;
    const del = (await import("@/app/api/v1/service-tokens/[id]/route")) as {
      DELETE: (r: Request, ctx: { params: { id: string } }) => Promise<Response>;
    };
    assert.strictEqual((await del.DELETE(new Request(`${BASE}/service-tokens/${service_token.id}`, {
      method: "DELETE", headers: { authorization: `Bearer ${ownerNow}` },
    }), { params: { id: service_token.id } })).status, 200);
    assert.strictEqual((await notify(token)).status, 401);

    const expiring = await createToken(ownerNow, { name: "expiring", scopes: ["notifications.send"], expires_in_days: 1 });
    const exp = ((await expiring.json()) as { data: { token: string; service_token: { id: string } } }).data;
    db.updateServiceToken(tenantId, exp.service_token.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    assert.strictEqual((await notify(exp.token)).status, 401);
  });

  await runTest("notification actions now need notifications.send (SUPPORT gets 403)", async () => {
    const support = await member(tenantId, "SUPPORT");
    assert.strictEqual((await notify(support.token)).status, 403);
  });

  await runTest("N2: an identical signed courier webhook is applied once; the repeat is acknowledged as a duplicate", async () => {
    const secret = crypto.randomBytes(24).toString("hex");
    process.env.P1_TEST_STEADFAST_SECRET = secret;
    const whId = uid("wh_p1");
    db.createAutomationWebhook({
      id: whId, tenant_id: tenantId, provider: "STEADFAST", endpoint_path: "/api/v1/automation/webhooks/steadfast",
      secret_reference: "P1_TEST_STEADFAST_SECRET", signature_algorithm: "HMAC_SHA256", is_active: true, created_at: nowIso(), updated_at: nowIso(),
    });
    const route = (await import("@/app/api/v1/automation/webhooks/[provider]/route")) as {
      POST: (r: Request, ctx: { params: { provider: string } }) => Promise<Response>;
    };
    const body = JSON.stringify({ tracking_number: "TRK-P1-NOT-REAL", status: "in_transit" });
    const ts = Date.now().toString();
    const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const send = () => route.POST(new Request(`${BASE}/automation/webhooks/steadfast?wh=${whId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-timestamp": ts, "x-webhook-signature": sig, "x-request-id": uid("rq") },
      body,
    }), { params: { provider: "steadfast" } });
    const first = (await (await send()).json()) as { duplicate?: boolean; verified?: boolean };
    assert.strictEqual(first.verified, true);
    assert.notStrictEqual(first.duplicate, true);
    const second = (await (await send()).json()) as { duplicate?: boolean };
    assert.strictEqual(second.duplicate, true, "a changed x-request-id does not bypass duplicate detection");
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-19] AI workflows act with their creator's permissions (M12)${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const { taskExecutor } = await import("@/domains/ai/orchestration/engine/task-executor");
  type ExecutionContext = { role: string; permissions: string[]; user: { id: string } };
  const contextOf = (task: unknown) =>
    (taskExecutor as unknown as { executionContextFor(t: unknown): ExecutionContext }).executionContextFor(task);
  const workflowWithTask = (createdBy: string, createdByType: "USER" | "SYSTEM") => {
    const wfId = uid("wf_p1");
    db.insertWorkflow({ id: wfId, tenant_id: tenantId, name: "P1", objective: "test", status: "RUNNING", created_by: createdBy, created_by_type: createdByType, created_at: nowIso(), updated_at: nowIso() } as never);
    const task = {
      id: uid("task_p1"), tenant_id: tenantId, workflow_id: wfId, agent_id: "agent_x", agent_type: "INVENTORY", task_type: "CHECK", objective: "check",
      status: "PENDING", priority: "NORMAL", risk_level: "LOW", input: { variant_id: "var_none" }, dependencies: [], assigned_tools: [],
      attempt_count: 1, max_attempts: 1, timeout_ms: 5000, idempotency_key: uid("idem"), created_at: nowIso(), updated_at: nowIso(),
    };
    db.insertTask(task as never);
    return task;
  };

  await runTest("a user-created workflow acts with its creator's current role, not OWNER", () => {
    const creator = db.findMembership(tenantId, analyst.id);
    assert.ok(creator);
    const ctx = contextOf(workflowWithTask(analyst.id, "USER"));
    assert.strictEqual(ctx.role, "ANALYST");
    assert.strictEqual(ctx.user.id, analyst.id);
    assert.ok(!ctx.permissions.includes("orders.update"));
  });

  await runTest("if the creator lost access, the workflow's task fails instead of running", async () => {
    const creator = await member(tenantId, "MANAGER");
    const task = workflowWithTask(creator.id, "USER");
    db.updateMembershipStatus(tenantId, creator.id, "SUSPENDED");
    await taskExecutor.executeTask(task as never);
    const stored = db.getTaskById(tenantId, task.id);
    assert.strictEqual(stored?.status, "FAILED");
    assert.ok(/no longer has access/i.test(stored?.error || ""), stored?.error);
  });

  await runTest("system workflows get read-only access, not OWNER", () => {
    const ctx = contextOf(workflowWithTask("system", "SYSTEM"));
    assert.strictEqual(ctx.role, "SERVICE");
    for (const write of ["orders.update", "payments.verify", "inventory.adjust", "user.invite"]) {
      assert.ok(!ctx.permissions.includes(write), `system workflow must not hold ${write}`);
    }
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[Phase 1 review fixes]${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const ownerTok = (await AuthService.login(shop.user.email, "Phase1-Owner-Pass-4471!")).token;
  const post = async (route: string, token: string | null, body: unknown, params?: Record<string, string>) => {
    type H = (r: Request, ctx?: { params: Record<string, string> }) => Promise<Response>;
    const mod = (await import(`@/app/api/v1/${route}/route`)) as { POST: H };
    const path = params ? Object.entries(params).reduce((p, [k, v]) => p.replace(`[${k}]`, v), route) : route;
    return mod.POST(new Request(`${BASE}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }), params ? { params } : undefined);
  };

  await runTest("an ADMIN can't invite an OWNER; invalid roles are rejected; an OWNER can invite an OWNER", async () => {
    const admin = await member(tenantId, "ADMIN");
    assert.strictEqual((await post("users", admin.token, { email: `${uid("x")}@p1.test`, role: "OWNER" })).status, 403);
    assert.strictEqual((await post("users", admin.token, { email: `${uid("x")}@p1.test`, role: "SERVICE" })).status, 400);
    assert.strictEqual((await post("users", admin.token, { email: `${uid("x")}@p1.test`, role: "WIZARD" })).status, 400);
    assert.strictEqual((await post("users", ownerTok, { email: `${uid("x")}@p1.test`, role: "OWNER" })).status, 201);
  });

  await runTest("UPDATE_POLICY can't write another workspace's autonomy policy or clear its emergency stop", async () => {
    const { autonomyPolicyService } = await import("@/domains/ai/orchestration/autonomy/autonomy-policy.service");
    autonomyPolicyService.triggerEmergencyStop(other.tenant.id, "SALES", "test");
    const res = await post("ai/agents", ownerTok, {
      action: "UPDATE_POLICY", agent_type: "SALES", autonomy_level: "LEVEL_4_HIGH",
      policy_updates: { tenant_id: other.tenant.id, is_emergency_stopped: false },
    });
    assert.strictEqual(res.status, 400, "unknown or forbidden keys are rejected");
    assert.strictEqual(db.getAutonomyPolicy(other.tenant.id, "SALES")?.is_emergency_stopped, true);
    const ok = await post("ai/agents", ownerTok, { action: "UPDATE_POLICY", agent_type: "SALES", autonomy_level: "LEVEL_2_ASSISTED", policy_updates: { max_actions_per_day: 10 } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(db.getAutonomyPolicy(tenantId, "SALES")?.max_actions_per_day, 10);
    assert.strictEqual(db.getAutonomyPolicy(other.tenant.id, "SALES")?.is_emergency_stopped, true);
  });

  await runTest("assigning a platform role keeps the operator's enrolled MFA", async () => {
    const { PlatformUserService } = await import("@/domains/platform/services/platform-user.service");
    const { encryptCredential } = await import("@/lib/security");
    const { PLATFORM_ROLE_PERMISSIONS } = await import("@/lib/permissions");
    const op = await newOperator("Operator-Role-Pass-6654!");
    const m = db.findPlatformMembershipByUserId(op.id)!;
    db.savePlatformMembership({ ...m, mfa_enabled: true, mfa_secret_encrypted: encryptCredential({ secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }), mfa_last_step: 5 });
    const ctx = {
      requestId: "req_t", traceId: "trc_t", scope: "PLATFORM", platformRole: "SUPER_ADMIN",
      platformUser: { id: "usr_admin_t", email: "a@t", name: "A", status: "ACTIVE" },
      permissions: PLATFORM_ROLE_PERMISSIONS.SUPER_ADMIN, mfaVerified: true, stepUpVerified: true, timestamp: nowIso(),
    };
    PlatformUserService.assignPlatformRole({ userId: op.id, role: "PLATFORM_ANALYST", reason: "test" }, ctx as never);
    const after = db.findPlatformMembershipByUserId(op.id)!;
    assert.strictEqual(after.role, "PLATFORM_ANALYST");
    assert.ok(after.mfa_enabled && after.mfa_secret_encrypted && after.mfa_last_step === 5, "MFA state kept");
  });

  await runTest("a webhook replay with an upper-cased signature is still a duplicate", async () => {
    const secret = crypto.randomBytes(24).toString("hex");
    process.env.P1_TEST_PATHAO_SECRET = secret;
    const whId = uid("wh_p1");
    db.createAutomationWebhook({
      id: whId, tenant_id: tenantId, provider: "PATHAO", endpoint_path: "/api/v1/automation/webhooks/pathao",
      secret_reference: "P1_TEST_PATHAO_SECRET", signature_algorithm: "HMAC_SHA256", is_active: true, created_at: nowIso(), updated_at: nowIso(),
    });
    const route = (await import("@/app/api/v1/automation/webhooks/[provider]/route")) as {
      POST: (r: Request, ctx: { params: { provider: string } }) => Promise<Response>;
    };
    const body = JSON.stringify({ tracking_number: "TRK-P1-CASE", status: "in_transit" });
    const ts = Date.now().toString();
    const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const send = (s: string) => route.POST(new Request(`${BASE}/automation/webhooks/pathao?wh=${whId}`, {
      method: "POST", headers: { "content-type": "application/json", "x-webhook-timestamp": ts, "x-webhook-signature": s }, body,
    }), { params: { provider: "pathao" } });
    assert.notStrictEqual(((await (await send(sig)).json()) as { duplicate?: boolean }).duplicate, true);
    assert.strictEqual(((await (await send(sig.toUpperCase())).json()) as { duplicate?: boolean }).duplicate, true);
  });

  await runTest("behind a proxy the client address is the proxy-appended entry, not a spoofed leftmost one", async () => {
    const { clientKey } = await import("@/lib/rate-limit");
    process.env.TRUST_PROXY = "1";
    try {
      const req = new Request(`${BASE}/x`, { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } });
      assert.strictEqual(clientKey(req), "203.0.113.9");
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });

  await runTest("invitation acceptance can't be used to guess a password (429 after 10 tries)", async () => {
    const { InvitationService } = await import("@/domains/invitations/service");
    const victim = await AuthService.registerTenantWithOwner({ email: `${uid("victim")}@p1.test`, password: "Victim-Own-Pass-1234!", name: "Victim", workspaceName: `V ${Date.now()}` });
    const inv = InvitationService.createInvitation(tenantId, victim.user.email, "SALES", shop.user.id);
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post("invitations/[token]", null, { password: `guess-${i}` }, { token: inv.token })).status;
    assert.strictEqual(last, 429);
  });

  await runTest("a service token stops working when its creator is suspended", async () => {
    const creator = await member(tenantId, "ADMIN");
    const created = await createToken(creator.token, { name: "creator-bound", scopes: ["notifications.send"] });
    const { token } = ((await created.json()) as { data: { token: string } }).data;
    assert.strictEqual((await notify(token)).status, 200);
    db.updateMembershipStatus(tenantId, creator.id, "SUSPENDED");
    assert.strictEqual((await notify(token)).status, 401);
  });

  await runTest("the payment AI tool needs payments.verify and confirmation", async () => {
    const tools = await import("@/domains/ai/tools/implementations/operations-tools");
    const tool = new (tools as unknown as { VerifyPaymentTransactionTool: new () => { requiredPermission: string; requiresConfirmation: boolean; riskLevel: string } }).VerifyPaymentTransactionTool();
    assert.strictEqual(tool.requiredPermission, "payments.verify");
    assert.strictEqual(tool.requiresConfirmation, true);
    assert.strictEqual(tool.riskLevel, "HIGH_RISK");
  });

  await runTest("enterprise integration test is org-scoped and reports SIMULATED, never fake success", async () => {
    const { integrationHubService } = await import("@/domains/enterprise/services/integration-hub.service");
    const instId = uid("inst");
    db.createIntegrationInstallation({ id: instId, organization_id: "org_owned_by_a", provider_id: "prov_x", provider_name: "SAP", category: "ERP", status: "HEALTHY", credentials_encrypted: "", config: {}, sync_frequency_minutes: 60, created_at: nowIso(), updated_at: nowIso() } as never);
    assert.throws(() => integrationHubService.testConnection("org_someone_else", instId), /not found/i);
    const own = integrationHubService.testConnection("org_owned_by_a", instId);
    assert.strictEqual(own.success, false);
    assert.strictEqual(own.status, "SIMULATED");
  });

  await runTest("a workspace can't lose its last owner (demote or suspend → 409)", async () => {
    const solo = await AuthService.registerTenantWithOwner({ email: `${uid("solo")}@p1.test`, password: "Solo-Owner-Pass-7788!", name: "Solo", workspaceName: `Solo ${Date.now()}` });
    const coOwner = await member(solo.tenant.id, "OWNER");
    // With two owners, one may step down; then the remaining single owner can't be demoted or suspended.
    assert.strictEqual((await sendJson(`users/[id]`, solo.user.id, "PATCH", coOwner.token, { role: "ADMIN" })).status, 200);
    assert.strictEqual((await sendJson(`users/[id]`, coOwner.id, "PATCH", coOwner.token, { role: "ADMIN" })).status, 409);
    const admin = await member(solo.tenant.id, "ADMIN");
    assert.strictEqual((await sendJson(`users/[id]`, coOwner.id, "PATCH", admin.token, { status: "SUSPENDED" })).status, 403, "non-owners can't touch owners");
  });

  await runTest("a rejected reconciliation answers 409, not 200", async () => {
    const o = order(tenantId, 800);
    payment(tenantId, o.id, 800);
    const res = await post("operations/payments", finance.token, { order_id: o.id, transaction_id: "MISMATCH01", amount: 5 });
    assert.strictEqual(res.status, 409);
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
