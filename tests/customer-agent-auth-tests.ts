/**
 * Customer agent: principal, ownership, tools, quotes and the confirmation gate (AI fix plan Stage 1: FX-72, FX-73,
 * FX-74, FX-75; ADR-111; audit F02, F04, F05, F11, F23, F28). Ported from audit/evals/candidate-tools.test.ts and
 * context-and-concurrency.test.ts. No language model is involved: these are the deterministic guarantees.
 */
import assert from "assert";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { ProductService } from "@/domains/catalog/product.service";
import { OrderService } from "@/domains/orders/order.service";
import { ChannelService } from "@/domains/social/channels/channel.service";
import { ConversationService } from "@/domains/social/conversations/conversation.service";
import { CouponService } from "@/domains/promotions/coupon.service";
import { InventoryService } from "@/domains/inventory/inventory.service";
import { PERMISSIONS } from "@/lib/permissions";
import { BD_64_DISTRICTS, BANGLA_DISTRICT_NAMES, findDistrict } from "@/lib/bd-geography";
import { searchTokens } from "@/domains/catalog/search-synonyms";
import type { RequestContext } from "@/lib/context";
import type { ChannelType, Message } from "@/types/social";
import { principalFor, capabilityContext, canSeeOrder, type Capability, type CustomerAgentPrincipal } from "@/domains/ai/customer-agent/principal";
import { isAffirmative } from "@/domains/ai/customer-agent/confirmation";
import { CUSTOMER_TOOLS, CUSTOMER_TOOL_NAMES, runCustomerTool } from "@/domains/ai/customer-agent/tools";

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
    console.error(err);
    failed++;
  }
}

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- tool results are free-form JSON
const ctxFor = (tenant: { id: string; name: string; slug: string }, user: { id: string; email: string; name: string }): RequestContext => ({
  requestId: "req_cat",
  traceId: "tr_cat",
  user: { id: user.id, email: user.email, name: user.name, status: "ACTIVE" },
  tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
  role: "OWNER",
  permissions: Object.values(PERMISSIONS),
  timestamp: new Date().toISOString(),
});

async function main() {
  console.log(`\n${BOLD}CUSTOMER AGENT: PRINCIPAL, TOOLS, QUOTES (Stage 1)${RESET}\n`);
  db.clearAllForTesting();
  const stamp = Date.now();

  // ---- fixture: one shop, a second shop, two customers with orders
  const owner = await AuthService.registerTenantWithOwner({ workspaceName: "Dhaka Fashion House", name: "Owner", email: `cat-${stamp}@example.com`, password: "Stage1-Test-Pass-2026!", currency: "BDT" });
  db.ensureDefaultSeed(owner.tenant.id);
  const ownerCtx = ctxFor(owner.tenant, owner.user);
  const tenantId = owner.tenant.id;

  const other = await AuthService.registerTenantWithOwner({ workspaceName: "Apex Footwear", name: "Apex", email: `apex-${stamp}@example.com`, password: "Stage1-Test-Pass-2026!", currency: "BDT" });
  db.ensureDefaultSeed(other.tenant.id);
  await ProductService.createProduct(ctxFor(other.tenant, other.user), { name: "Apex Runner Sneaker", sku: "APX-RUN", base_price: 5555, initial_stock: 9 });

  const variantIds: Record<string, string> = {};
  const catalog: Array<{ name: string; sku: string; price: number; compare?: number; sizes: Array<[string, number]> }> = [
    { name: "Black Cotton T-Shirt", sku: "TS-BLK", price: 650, sizes: [["M", 20], ["L", 15], ["XL", 8], ["XXL", 0]] },
    { name: "White Cotton T-Shirt", sku: "TS-WHT", price: 650, sizes: [["M", 10], ["L", 10], ["XL", 10]] },
    { name: "Premium Cotton Panjabi", sku: "PJ-PRM", price: 2450, compare: 2950, sizes: [["M", 5], ["L", 2], ["XL", 0]] },
    { name: "Leather Wallet", sku: "WL-LTH", price: 890, sizes: [["Free", 12]] },
    { name: "Jamdani Saree", sku: "SR-JMD", price: 8500, sizes: [["Free", 3]] },
  ];
  for (const p of catalog) {
    const product = await ProductService.createProduct(ownerCtx, {
      name: p.name, sku: p.sku, base_price: p.price, compare_at_price: p.compare, status: "ACTIVE",
      variants: p.sizes.map(([size, stock]) => ({ title: size, sku: `${p.sku}-${size}`, price: p.price, initial_stock: stock, attributes: { size } })),
    } as never);
    for (const v of db.getProductVariants(tenantId, product.id)) variantIds[v.sku] = v.id;
  }
  await CouponService.createCoupon(ownerCtx, { code: "EID10", type: "PERCENTAGE", value: 10, maximum_discount: 500 } as never);

  const order = (first: string, phone: string, district: string, sku: string) =>
    OrderService.createOrder(ownerCtx, { customer: { first_name: first, last_name: "Test", phone }, delivery_address: { district, address_line_1: "House 1, Road 1" }, items: [{ variant_id: variantIds[sku], quantity: 1 }], payment_method: "COD" });
  const a1 = await order("Rahim", "01711000001", "Dhaka", "TS-BLK-L");
  const b1 = await order("Karim", "01822000002", "Sylhet", "SR-JMD-FREE");
  const customerA = a1.customer_id;

  const channel = async (type: ChannelType) =>
    (await ChannelService.connectChannel(ownerCtx, { type, name: `${type} ${stamp}`, provider_account_id: `acct_${type}_${stamp}`, credentials: { pageId: `acct_${type}_${stamp}`, accessToken: "placeholder" } } as never)).id;
  const messenger = await channel("FACEBOOK_MESSENGER");
  const website = await channel("WEBSITE_CHAT");

  let seq = 0;
  const conversation = async (channelId: string, type: ChannelType, customerId?: string) => {
    seq++;
    const { conversation: c } = await ConversationService.findOrCreateConversation(tenantId, channelId, type, `ext_user_${seq}`, `ext_thread_${seq}`);
    db.updateConversation(tenantId, c.id, { mode: "BOT", automation_paused: false, ...(customerId ? { customer_id: customerId } : {}) } as never);
    return principalFor(tenantId, c.id)!;
  };
  let msgSeq = 0;
  const say = (pr: CustomerAgentPrincipal, from: "customer" | "agent", text: string) => {
    msgSeq++;
    const t = new Date(Date.now() + msgSeq).toISOString();
    db.createMessage({
      id: `msg_cat_${stamp}_${msgSeq}`, tenant_id: tenantId, conversation_id: pr.conversationId,
      direction: from === "customer" ? "INBOUND" : "OUTBOUND", sender_type: from === "customer" ? "CUSTOMER" : "AGENT",
      message_type: "TEXT", text, status: "DELIVERED", retry_count: 0, metadata: {}, created_at: t, updated_at: t,
    } as Message);
  };
  const run = async (pr: CustomerAgentPrincipal, name: string, args: unknown): Promise<R> => {
    const out = await runCustomerTool(pr, name, args);
    return out.result as R;
  };
  const variant = async (pr: CustomerAgentPrincipal, query: string, size: string) =>
    ((await run(pr, "search_products", { query })).results[0].variants as R[]).find((v) => v.size === size)!;
  const details = { customer_name: "Rahim Uddin", phone: "01711000001", address_line: "House 12, Road 5, Mirpur 10", payment_method: "COD" };

  const prA = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);

  // ------------------------------------------------------------------ FX-72
  console.log(`${BOLD}[FX-72] Principal and ownership${RESET}`);

  await runTest("the principal comes from the stored conversation: workspace, channel and assurance", () => {
    assert.strictEqual(prA.tenantId, tenantId);
    assert.strictEqual(prA.channelType, "FACEBOOK_MESSENGER");
    assert.strictEqual(prA.assurance, "CHANNEL");
    assert.strictEqual(principalFor(other.tenant.id, prA.conversationId), undefined, "another workspace can't load this chat");
  });

  await runTest("another customer's order number gets exactly the not-found answer (no existence oracle, F02)", async () => {
    const someoneElse = await run(prA, "get_order_status", { order_number: b1.order_number });
    const missing = await run(prA, "get_order_status", { order_number: "ORD-2026-999999" });
    assert.deepStrictEqual(Object.keys(someoneElse).sort(), Object.keys(missing).sort());
    assert.strictEqual(someoneElse.found, false);
    assert.strictEqual((await run(prA, "get_order_status", { order_number: a1.order_number })).found, true);
  });

  await runTest("get_my_orders shows only this chat's customer's orders", async () => {
    const r = await run(prA, "get_my_orders", {});
    const numbers = (r.orders as R[]).map((o) => o.order_number);
    assert.ok(numbers.includes(a1.order_number));
    assert.ok(!numbers.includes(b1.order_number));
  });

  await runTest("an anonymous website chat sees no customer orders, even when linked to that customer", async () => {
    const anon = await conversation(website, "WEBSITE_CHAT", customerA);
    assert.strictEqual(anon.assurance, "ANONYMOUS");
    assert.strictEqual(((await run(anon, "get_my_orders", {})).orders as R[]).length, 0);
    assert.strictEqual((await run(anon, "get_order_status", { order_number: a1.order_number })).found, false);
  });

  await runTest("smuggled customer_id / tenant_id arguments are refused by the strict schemas", async () => {
    const r1 = await runCustomerTool(prA, "get_my_orders", { customer_id: b1.customer_id });
    assert.strictEqual(r1.refused, "INVALID_ARGS");
    const r2 = await runCustomerTool(prA, "search_products", { query: "tshirt", tenant_id: other.tenant.id });
    assert.strictEqual(r2.refused, "INVALID_ARGS");
    assert.strictEqual((await runCustomerTool(prA, "execute_price_change", {})).refused, "UNKNOWN_TOOL");
    assert.strictEqual((await runCustomerTool(prA, "__proto__", {})).refused, "UNKNOWN_TOOL");
  });

  await runTest("capability contexts hold no money, price, settings or staff-wide permissions", () => {
    const forbidden = [PERMISSIONS.PAYMENTS_VERIFY, PERMISSIONS.PRICING_MANAGE, PERMISSIONS.OPERATIONS_EXECUTE, PERMISSIONS.MARKETING_WRITE, PERMISSIONS.SETTINGS_WRITE, PERMISSIONS.USER_INVITE];
    for (const cap of ["catalog", "orders_read", "orders_create", "knowledge", "handoff"] as Capability[]) {
      const ctx = capabilityContext(prA, cap);
      assert.strictEqual(ctx.role, "SERVICE");
      assert.ok(ctx.user.id.startsWith("svc_customer_agent:"));
      for (const p of forbidden) assert.ok(!ctx.permissions.includes(p), `${cap} holds ${p}`);
    }
  });

  await runTest("a typed phone of customer B + a COD order doesn't make B's orders visible in this chat", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER"); // a fresh chat with its own customer
    say(pr, "customer", "1 ta wallet chai, Sylhet");
    const w = await variant(pr, "wallet", "Free");
    const q = await run(pr, "quote_order", { items: [{ variant_id: w.variant_id, quantity: 1 }], district: "Sylhet" });
    say(pr, "customer", "yes confirm");
    const placed = await run(pr, "place_order", { ...details, quote_id: q.quote_id, phone: "01822000002", customer_name: "Karim Test" });
    assert.strictEqual(placed.status, "PLACED", JSON.stringify(placed));
    const mine = ((await run(pr, "get_my_orders", {})).orders as R[]).map((o) => o.order_number);
    assert.deepStrictEqual(mine, [placed.order_number], "only the order placed in this chat");
    assert.strictEqual((await run(pr, "get_order_status", { order_number: b1.order_number })).found, false);
    const created = db.getAllOrders(tenantId).find((o) => o.order_number === placed.order_number)!;
    assert.strictEqual(created.source_conversation_id, pr.conversationId);
    assert.strictEqual(principalFor(tenantId, pr.conversationId)!.customerId, pr.customerId, "the chat was not relinked to B");
  });

  await runTest("ownership never crosses workspaces", () => {
    assert.strictEqual(canSeeOrder(prA, { ...a1, tenant_id: other.tenant.id }), false);
  });

  await runTest("a chat linked to a customer by a phone the sender supplied (not WhatsApp) is treated as anonymous (review M3)", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    const ts = new Date().toISOString();
    db.createCustomerIdentity({
      id: `cid_claimed_${stamp}`, tenant_id: tenantId, customer_id: customerA, channel_id: messenger, channel_type: "FACEBOOK_MESSENGER",
      external_user_id: `claimed_${stamp}`, metadata: { resolution_strategy: "PHONE_MATCH" }, first_seen_at: ts, last_seen_at: ts,
    });
    const after = principalFor(tenantId, pr.conversationId)!;
    assert.strictEqual(after.assurance, "ANONYMOUS");
    assert.strictEqual(((await run(after, "get_my_orders", {})).orders as R[]).length, 0);
    db.data.customer_identities = db.data.customer_identities.filter((i) => i.id !== `cid_claimed_${stamp}`);
  });

  await runTest("no principal for a suspended workspace or a disconnected channel; no order while the platform pauses the shop (review M2)", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    db.updateTenant(tenantId, { status: "SUSPENDED" } as never);
    assert.strictEqual(principalFor(tenantId, pr.conversationId), undefined);
    db.updateTenant(tenantId, { status: "ACTIVE" } as never);
    say(pr, "customer", "1 ta wallet Dhaka");
    const w = await variant(pr, "wallet", "Free");
    const q = await run(pr, "quote_order", { items: [{ variant_id: w.variant_id, quantity: 1 }], district: "Dhaka" });
    say(pr, "customer", "yes");
    const ts = new Date().toISOString();
    db.savePlatformKillSwitch({ id: `ks_s1_${stamp}`, scope: "TENANT", target_id: tenantId, is_active: true, reason: "test", activated_by: "test", created_at: ts, updated_at: ts } as never);
    const before = db.getAllOrders(tenantId).length;
    assert.strictEqual((await run(pr, "place_order", { ...details, quote_id: q.quote_id })).error, "SHOP_PAUSED");
    assert.strictEqual(db.getAllOrders(tenantId).length, before);
    db.savePlatformKillSwitch({ id: `ks_s1_${stamp}`, scope: "TENANT", target_id: tenantId, is_active: false, reason: "test", activated_by: "test", created_at: ts, updated_at: ts } as never);
  });

  await runTest("a draft product and duplicate lines past the per-item limit can't be quoted (review L5, L6)", async () => {
    const draft = await ProductService.createProduct(ownerCtx, { name: "Hidden Draft Kurti", sku: "DR-KRT", base_price: 999, status: "DRAFT", initial_stock: 5 } as never);
    const draftVariant = db.getProductVariants(tenantId, draft.id)[0];
    assert.strictEqual((await run(prA, "quote_order", { items: [{ variant_id: draftVariant.id, quantity: 1 }], district: "Dhaka" })).error, "UNKNOWN_VARIANT");
    const w = await variant(prA, "wallet", "Free");
    const dup = await runCustomerTool(prA, "quote_order", { items: [{ variant_id: w.variant_id, quantity: 10 }, { variant_id: w.variant_id, quantity: 10 }], district: "Dhaka" });
    assert.strictEqual(dup.refused, "INVALID_ARGS");
  });

  // ------------------------------------------------------------------ FX-74
  console.log(`\n${BOLD}[FX-74] Customer tool set${RESET}`);

  await runTest("exactly nine tools, all with strict schemas", () => {
    assert.deepStrictEqual(CUSTOMER_TOOL_NAMES.sort(), ["get_delivery_charge", "get_my_orders", "get_order_status", "get_product", "handoff_to_human", "place_order", "quote_order", "search_policy", "search_products"]);
    for (const [name, tool] of Object.entries(CUSTOMER_TOOLS)) {
      assert.strictEqual(tool.schema.safeParse({ __unexpected: 1 }).success, false, `${name} accepts an unknown field`);
    }
  });

  await runTest("search finds multi-word, Banglish and Bangla queries, with per-variant stock", async () => {
    for (const q of ["black t-shirt", "kalo genji", "Black Cotton T-Shirt", "টি-শার্ট কালো", "কালো গেঞ্জি"]) {
      const r = await run(prA, "search_products", { query: q });
      assert.ok((r.results as R[]).some((p) => p.name === "Black Cotton T-Shirt"), q);
    }
    assert.strictEqual((await variant(prA, "black t-shirt", "XXL")).stock_status, "out_of_stock");
  });

  await runTest("search never returns another workspace's catalog, and an unknown product returns nothing", async () => {
    assert.strictEqual(((await run(prA, "search_products", { query: "Apex Runner Sneaker" })).results as R[]).length, 0);
    assert.strictEqual(((await run(prA, "search_products", { query: "iphone" })).results as R[]).length, 0);
  });

  await runTest("the saving is computed by the tool (you_save_bdt)", async () => {
    const pj = (await run(prA, "search_products", { query: "panjabi" })).results[0];
    assert.strictEqual(pj.you_save_bdt, 500);
  });

  await runTest("delivery charge is decided by district on the server, in English or Bangla", async () => {
    assert.strictEqual((await run(prA, "get_delivery_charge", { district: "Dhaka" })).delivery_charge_bdt, 60);
    assert.strictEqual((await run(prA, "get_delivery_charge", { district: "Gazipur" })).delivery_charge_bdt, 120);
    assert.strictEqual((await run(prA, "get_delivery_charge", { district: "সিলেট" })).district, "Sylhet");
    assert.strictEqual((await run(prA, "get_delivery_charge", { district: "Mirpur" })).error, "UNKNOWN_DISTRICT");
  });

  await runTest("quote refuses quantities outside 1-10 and sizes that are out of stock", async () => {
    assert.strictEqual((await runCustomerTool(prA, "quote_order", { items: [{ variant_id: "x", quantity: 11 }], district: "Dhaka" })).refused, "INVALID_ARGS");
    assert.strictEqual((await runCustomerTool(prA, "quote_order", { items: [{ variant_id: "x", quantity: -5 }], district: "Dhaka" })).refused, "INVALID_ARGS");
    const xxl = await variant(prA, "black t-shirt", "XXL");
    assert.strictEqual((await run(prA, "quote_order", { items: [{ variant_id: xxl.variant_id, quantity: 1 }], district: "Dhaka" })).error, "INSUFFICIENT_STOCK");
  });

  await runTest("place_order is cash on delivery only for now", async () => {
    assert.strictEqual((await runCustomerTool(prA, "place_order", { ...details, quote_id: "q_x", payment_method: "BKASH" })).refused, "INVALID_ARGS");
  });

  // ------------------------------------------------------------------ FX-73
  console.log(`\n${BOLD}[FX-73] Quotes and the confirmation gate${RESET}`);

  const orderCount = () => db.getAllOrders(tenantId).length;

  await runTest("same turn → CONFIRMATION_REQUIRED; 'no' → still required; a later yes → PLACED once (idempotent)", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    say(pr, "customer", "1 ta black tshirt L Dhaka te");
    const l = await variant(pr, "black t-shirt", "L");
    const q = await run(pr, "quote_order", { items: [{ variant_id: l.variant_id, quantity: 1 }], district: "Dhaka" });
    assert.strictEqual(q.grand_total_bdt, 710);
    const before = orderCount();
    const args = { ...details, quote_id: q.quote_id };
    const first = await run(pr, "place_order", args);
    assert.strictEqual(first.status, "CONFIRMATION_REQUIRED");
    assert.deepStrictEqual([first.summary.items[0].quantity, first.summary.items[0].unit_price_bdt, first.summary.delivery_charge_bdt, first.summary.grand_total_bdt], [1, 650, 60, 710]);
    say(pr, "customer", "na, pore nibo");
    assert.strictEqual((await run(pr, "place_order", args)).status, "CONFIRMATION_REQUIRED");
    say(pr, "customer", "ha confirm");
    const placed = await run(pr, "place_order", args);
    assert.strictEqual(placed.status, "PLACED");
    assert.strictEqual((await run(pr, "place_order", args)).order_number, placed.order_number);
    assert.strictEqual(orderCount(), before + 1);
  });

  await runTest("two simultaneous place_order calls for one confirmed quote create one order", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    say(pr, "customer", "2 ta white tshirt M Dhaka");
    const m = await variant(pr, "white t-shirt", "M");
    const q = await run(pr, "quote_order", { items: [{ variant_id: m.variant_id, quantity: 2 }], district: "Dhaka" });
    say(pr, "customer", "ji order koren");
    const before = orderCount();
    const results = await Promise.all([1, 2, 3].map(() => run(pr, "place_order", { ...details, quote_id: q.quote_id })));
    assert.strictEqual(orderCount(), before + 1, JSON.stringify(results));
    assert.strictEqual(results.filter((r) => r.status === "PLACED").length >= 1, true);
  });

  await runTest("a price edited after the quote → PRICE_CHANGED, no order", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    say(pr, "customer", "1 ta panjabi M Dhaka");
    const pm = await variant(pr, "panjabi", "M");
    const q = await run(pr, "quote_order", { items: [{ variant_id: pm.variant_id, quantity: 1 }], district: "Dhaka" });
    db.updateProductVariant(tenantId, pm.variant_id, { price: 2600 });
    say(pr, "customer", "yes");
    const before = orderCount();
    const r = await run(pr, "place_order", { ...details, quote_id: q.quote_id });
    assert.strictEqual(r.error, "PRICE_CHANGED", JSON.stringify(r));
    assert.strictEqual(orderCount(), before);
    assert.strictEqual(db.findQuote(tenantId, pr.conversationId, q.quote_id)?.status, "STALE");
    db.updateProductVariant(tenantId, pm.variant_id, { price: 2450 });
  });

  await runTest("stock sold between quote and yes → OUT_OF_STOCK_NOW, no order, no exception", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    say(pr, "customer", "2 ta panjabi L Dhaka");
    const pl = await variant(pr, "panjabi", "L");
    const q = await run(pr, "quote_order", { items: [{ variant_id: pl.variant_id, quantity: 2 }], district: "Dhaka" });
    const warehouse = db.getWarehouses(tenantId)[0];
    await InventoryService.reserveStock(ownerCtx, { order_id: "ord_other_buyer", warehouse_id: warehouse.id, product_variant_id: pl.variant_id, quantity: 2 });
    say(pr, "customer", "yes");
    const before = orderCount();
    const r = await run(pr, "place_order", { ...details, quote_id: q.quote_id });
    assert.strictEqual(r.error, "OUT_OF_STOCK_NOW", JSON.stringify(r));
    assert.strictEqual(orderCount(), before);
    assert.strictEqual(db.findQuote(tenantId, pr.conversationId, q.quote_id)?.status, "QUOTED", "the claim is released");
  });

  await runTest("re-quoting the identical order in the confirmation turn still lets 'yes + details' place it", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    say(pr, "customer", "1 ta white tshirt L Dhaka");
    const w = await variant(pr, "white t-shirt", "L");
    await run(pr, "quote_order", { items: [{ variant_id: w.variant_id, quantity: 1 }], district: "Dhaka" });
    say(pr, "customer", "yes, confirm. Rahim Uddin 01711000001 House 12 Road 5 Mirpur 10, COD");
    const q2 = await run(pr, "quote_order", { items: [{ variant_id: w.variant_id, quantity: 1 }], district: "Dhaka" });
    const r = await run(pr, "place_order", { ...details, quote_id: q2.quote_id });
    assert.strictEqual(r.status, "PLACED", JSON.stringify(r));
  });

  await runTest("a changed re-quote (different total) needs a new yes", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    say(pr, "customer", "1 ta white tshirt XL Dhaka");
    const w = await variant(pr, "white t-shirt", "XL");
    await run(pr, "quote_order", { items: [{ variant_id: w.variant_id, quantity: 1 }], district: "Dhaka" });
    say(pr, "customer", "yes, but make it 2");
    const q2 = await run(pr, "quote_order", { items: [{ variant_id: w.variant_id, quantity: 2 }], district: "Dhaka" });
    assert.strictEqual((await run(pr, "place_order", { ...details, quote_id: q2.quote_id })).status, "CONFIRMATION_REQUIRED");
  });

  await runTest("a quote from another chat can't be placed here", async () => {
    const owner1 = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    say(owner1, "customer", "1 ta wallet Dhaka");
    const w = await variant(owner1, "wallet", "Free");
    const q = await run(owner1, "quote_order", { items: [{ variant_id: w.variant_id, quantity: 1 }], district: "Dhaka" });
    const intruder = await conversation(messenger, "FACEBOOK_MESSENGER");
    say(intruder, "customer", "yes");
    assert.strictEqual((await run(intruder, "place_order", { ...details, quote_id: q.quote_id })).error, "UNKNOWN_QUOTE");
  });

  await runTest("the yes / no matcher reads Bangla, Banglish and English, and a no wins", () => {
    for (const t of ["yes", "ha confirm", "ji order koren", "হ্যাঁ", "ঠিক আছে", "ok", "জি, অর্ডার দিন", "হ্যাঁ, আমার নাম রহিম", "yes, Rahim 01711000001 House 12 Mirpur"]) {
      assert.ok(isAffirmative(t), t);
    }
    for (const t of ["no", "na, pore nibo", "cancel", "না", "ok wait", "পরে দিব"]) assert.ok(!isAffirmative(t), t);
  });

  await runTest("questions, refusals, conditions and look-alike words are never a yes (security review M1)", () => {
    for (const t of [
      "not sure", "I am not okay with this", "don't confirm", "is the delivery charge ok?", "Ok so how much for 2?",
      "change the size, ok?", "জিন্স টা কত?", "জিনিসটা কেমন?", "yes but make it 2", "price ta beshi, ok", "okay? kal dibo", "",
    ]) {
      assert.ok(!isAffirmative(t), JSON.stringify(t));
    }
  });

  await runTest("details changed after the summary need a new yes; placement uses the confirmed details", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    say(pr, "customer", "1 ta wallet Dhaka");
    const w = await variant(pr, "wallet", "Free");
    const q = await run(pr, "quote_order", { items: [{ variant_id: w.variant_id, quantity: 1 }], district: "Dhaka" });
    assert.strictEqual((await run(pr, "place_order", { ...details, quote_id: q.quote_id })).status, "CONFIRMATION_REQUIRED");
    say(pr, "customer", "yes");
    const swapped = await run(pr, "place_order", { ...details, quote_id: q.quote_id, address_line: "Somewhere else entirely, Gulshan" });
    assert.strictEqual(swapped.status, "CONFIRMATION_REQUIRED", "a different address after the summary isn't confirmed");
    assert.strictEqual(swapped.summary.address, "Somewhere else entirely, Gulshan");
    say(pr, "customer", "yes");
    const placed = await run(pr, "place_order", { ...details, quote_id: q.quote_id, address_line: "Somewhere else entirely, Gulshan" });
    assert.strictEqual(placed.status, "PLACED", JSON.stringify(placed));
    const order = db.getAllOrders(tenantId).find((o) => o.order_number === placed.order_number)!;
    assert.strictEqual(order.shipping_address_snapshot.address_line_1, "Somewhere else entirely, Gulshan");
  });

  await runTest("a claim abandoned by a crash (PLACING for over 2 minutes) can be placed again; a fresh one can't", async () => {
    const pr = await conversation(messenger, "FACEBOOK_MESSENGER", customerA);
    say(pr, "customer", "1 ta white tshirt M Dhaka");
    const m = await variant(pr, "white t-shirt", "M");
    const q = await run(pr, "quote_order", { items: [{ variant_id: m.variant_id, quantity: 1 }], district: "Dhaka" });
    say(pr, "customer", "yes");
    const quote = db.findQuote(tenantId, pr.conversationId, q.quote_id)!;
    quote.status = "PLACING";
    quote.updated_at = new Date().toISOString();
    assert.strictEqual((await run(pr, "place_order", { ...details, quote_id: q.quote_id })).status, "IN_PROGRESS");
    quote.updated_at = new Date(Date.now() - 3 * 60_000).toISOString();
    assert.strictEqual((await run(pr, "place_order", { ...details, quote_id: q.quote_id })).status, "PLACED");
  });

  // ------------------------------------------------------------------ FX-75
  console.log(`\n${BOLD}[FX-75] Bangla district names${RESET}`);

  await runTest("every one of the 64 districts has a Bangla name that resolves to it, with the right zone", () => {
    assert.strictEqual(Object.keys(BANGLA_DISTRICT_NAMES).length, 64);
    for (const spec of BD_64_DISTRICTS) {
      const names = BANGLA_DISTRICT_NAMES[spec.district];
      assert.ok(names && names.length, `no Bangla name for ${spec.district}`);
      for (const n of names) {
        const found = findDistrict(n);
        assert.strictEqual(found?.district, spec.district, n);
        assert.strictEqual(found?.zone, spec.zone);
      }
    }
  });

  await runTest("Bangla input is normalised: 'জেলা', punctuation and both encodings of ড়", () => {
    assert.strictEqual(findDistrict("চট্টগ্রাম জেলা")?.district, "Chattogram");
    assert.strictEqual(findDistrict("সিলেট।")?.district, "Sylhet");
    assert.strictEqual(findDistrict("বগুড়া".normalize("NFD"))?.district, "Bogura");
    assert.strictEqual(findDistrict("Chittagong")?.district, "Chattogram");
    assert.strictEqual(findDistrict("Mirpur"), undefined);
  });

  await runTest("search words keep Bangla vowel signs (কালো stays কালো)", () => {
    assert.ok(searchTokens("কালো গেঞ্জি").includes("black"));
    assert.ok(searchTokens("কালো গেঞ্জি").includes("tshirt"));
  });

  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal customer agent test error:", err);
  process.exit(1);
});
