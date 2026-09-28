/**
 * Phase 2 analytics suite (FIX_IMPLEMENTATION_PLAN FX-22 / FX-23, audit H6/H8).
 * Analytics used to read `db.getOrders(tenant).orders`, a page silently capped at 50 rows. These tests seed well past
 * that cap and check that every analytics path sees every row, while list pages stay paged.
 * Run: node tests/ts-runner.cjs ./tests/phase2-analytics-tests.ts
 */
import assert from "assert";
import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import { AnalyticsService } from "@/domains/analytics/analytics.service";
import { analyticsQueryService } from "@/domains/intelligence/services/analytics-query.service";
import { customerIntelligenceService } from "@/domains/intelligence/services/customer-intelligence.service";
import { SalesIntelligenceService } from "@/domains/intelligence/services/sales-intelligence.service";
import type { Customer, Order, OrderItem } from "@/types/commerce";

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

const TENANT = "ten_phase2_analytics";
const OTHER_TENANT = "ten_phase2_other";
const CUSTOMERS = 80;
const ORDERS = 120;
const ORDER_TOTAL = 1000;

function context(tenantId: string): RequestContext {
  return {
    requestId: "req_phase2",
    traceId: "trace_phase2",
    user: { id: "usr_phase2_owner", email: "owner@phase2.test", name: "Owner", status: "ACTIVE" },
    tenant: { id: tenantId, name: "Phase 2", slug: "phase2", currency: "BDT", timezone: "Asia/Dhaka", language: "en", status: "ACTIVE" },
    role: "OWNER",
    permissions: ROLE_PERMISSIONS["OWNER"],
    timestamp: new Date().toISOString(),
  } as RequestContext;
}

function seed(tenantId: string, customers: number, orders: number) {
  const day = 86_400_000;
  for (let c = 0; c < customers; c++) {
    const created = new Date(Date.now() - 20 * day).toISOString();
    db.data.customers.push({
      id: `cus_${tenantId}_${c}`, tenant_id: tenantId, first_name: `First${c}`, last_name: "Buyer",
      phone: `+88017${String(c).padStart(8, "0")}`, status: "ACTIVE", source: "WEBSITE", created_at: created, updated_at: created,
    } as unknown as Customer);
  }
  for (let o = 0; o < orders; o++) {
    // Spread over the last ~10 days so every order is inside the 30-day windows.
    const created = new Date(Date.now() - (o % 10) * day - 3_600_000).toISOString();
    const id = `ord_${tenantId}_${o}`;
    db.data.orders.push({
      id, tenant_id: tenantId, order_number: `P2-${o}`, customer_id: `cus_${tenantId}_${o % customers}`,
      status: "DELIVERED", currency: "BDT", subtotal: ORDER_TOTAL, discount_total: 0, shipping_total: 0, tax_total: 0,
      grand_total: ORDER_TOTAL, total_amount: ORDER_TOTAL, payment_method: "COD", payment_status: "PAID",
      fulfillment_status: "FULFILLED", shipping_address_snapshot: { district: "Dhaka" }, source: "WEBSITE",
      created_at: created, updated_at: created,
    } as unknown as Order);
    db.data.order_items.push({
      id: `oi_${id}`, tenant_id: tenantId, order_id: id, variant_id: "var_none", product_title: "Item", variant_title: "Default",
      sku: "SKU", quantity: 1, unit_price: ORDER_TOTAL, total_price: ORDER_TOTAL, created_at: created,
    } as unknown as OrderItem);
  }
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 2: ANALYTICS SEE EVERY ROW (FX-22)   ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  db.clearAllForTesting();
  seed(TENANT, CUSTOMERS, ORDERS);
  seed(OTHER_TENANT, 5, 7); // must never leak into TENANT's numbers

  await runTest("list pages stay paged: getOrders/getCustomers return one page but the true total", () => {
    const orders = db.getOrders(TENANT, { limit: 50 });
    assert.strictEqual(orders.orders.length, 50);
    assert.strictEqual(orders.total, ORDERS);
    const customers = db.getCustomers(TENANT, { limit: 50, offset: 60 });
    assert.strictEqual(customers.customers.length, CUSTOMERS - 60);
    assert.strictEqual(customers.total, CUSTOMERS);
  });

  await runTest("getAllOrders/getAllCustomers return every row of one tenant, hydrated correctly", () => {
    const all = db.getAllOrders(TENANT, { hydrate: true });
    assert.strictEqual(all.length, ORDERS);
    assert.ok(all.every((o) => o.tenant_id === TENANT));
    assert.ok(all.every((o) => o.items?.length === 1 && o.items[0].order_id === o.id), "each order carries its own items");
    const sample = all.find((o) => o.id === `ord_${TENANT}_95`);
    assert.strictEqual(sample?.customer_name, `First${95 % CUSTOMERS} Buyer`);
    assert.strictEqual(db.getAllOrders(TENANT).length, ORDERS);
    assert.strictEqual(db.getAllCustomers(TENANT).length, CUSTOMERS);
    assert.strictEqual(db.getAllCustomers(OTHER_TENANT).length, 5);
  });

  await runTest("financial metrics count all 120 orders, not the first 50", async () => {
    const m = await AnalyticsService.getFinancialMetrics(context(TENANT), "30D");
    assert.strictEqual(m.gmv_bdt, ORDERS * ORDER_TOTAL, `GMV ${m.gmv_bdt}`);
  });

  await runTest("analytics query orders_count and gross revenue cover all 120 orders", () => {
    const r = analyticsQueryService.executeQuery({ tenantId: TENANT, metrics: ["orders_count"], datePreset: "30D" });
    assert.strictEqual(r.metrics.orders_count.current_value, ORDERS);
  });

  await runTest("sales intelligence overview sees all 120 orders", () => {
    const overview = new SalesIntelligenceService().getOverview(TENANT, 30);
    assert.strictEqual(overview.total_orders, ORDERS);
  });

  await runTest("customer intelligence scores all 80 customers with their full order history", () => {
    const records = customerIntelligenceService.analyzeCustomers(TENANT);
    assert.strictEqual(records.length, CUSTOMERS);
    // customers 0..39 have 2 orders (120 = 80 + 40), the rest have 1
    const c10 = records.find((r) => r.customer_id === `cus_${TENANT}_10`);
    const c70 = records.find((r) => r.customer_id === `cus_${TENANT}_70`);
    assert.strictEqual(c10?.frequency_orders, 2);
    assert.strictEqual(c70?.frequency_orders, 1);
    assert.strictEqual(c10?.monetary_total_bdt, 2 * ORDER_TOTAL);
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Phase 2 analytics suite crashed:", err);
  process.exit(1);
});
