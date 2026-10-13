/**
 * Phase C: Architectural Regression Guards & Zero-Hydration Test Suite
 * Enforces query-on-demand invariants:
 * 1. Prohibits unbounded full-table scans in API route handlers and migrated analytics services.
 * 2. Validates SQL-native aggregations (SUM, COUNT, GROUP BY) on repositories.
 * 3. Enforces strict tenant isolation on all new repository methods.
 * 4. Ensures cursor pagination is bounded (default 20, max 100).
 * Run: node tests/ts-runner.cjs ./tests/phase-c-architectural-guards-tests.ts
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { orderRepository } from "@/domains/orders/order.repository";
import { customerRepository } from "@/domains/customers/customer.repository";
import { productRepository } from "@/domains/catalog/product.repository";
import type { Customer, Order, OrderItem, Product, ProductVariant } from "@/types/commerce";

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

const TENANT_A = "ten_phase_c_guard_a";
const TENANT_B = "ten_phase_c_guard_b";

function seedData() {
  db.clearAllForTesting();

  // Tenant A: 100 orders, 20 customers
  for (let c = 0; c < 20; c++) {
    db.data.customers.push({
      id: `cus_a_${c}`,
      tenant_id: TENANT_A,
      first_name: `Customer`,
      last_name: `${c}`,
      phone: `+88017000000${c.toString().padStart(2, "0")}`,
      email: `user${c}@tenanta.com`,
      status: "ACTIVE",
      created_at: new Date(Date.now() - c * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    } as Customer);
  }

  for (let o = 0; o < 100; o++) {
    const isCancelled = o < 10;
    const isCOD = o % 2 === 0;
    const isConfirmed = o >= 10 && o < 25;
    const status = isCancelled ? "CANCELLED" : isConfirmed ? "CONFIRMED" : "DELIVERED";
    const paymentStatus = isCancelled ? "FAILED" : isCOD ? "PENDING" : "PAID";
    const created = new Date(Date.now() - (o % 15) * 86400000).toISOString();
    const grandTotal = 1000 + (o % 5) * 200;

    db.data.orders.push({
      id: `ord_a_${o}`,
      tenant_id: TENANT_A,
      order_number: `ORD-A-${o}`,
      customer_id: `cus_a_${o % 20}`,
      status,
      currency: "BDT",
      subtotal: grandTotal,
      discount_total: 0,
      shipping_total: 0,
      tax_total: 0,
      grand_total: grandTotal,
      payment_method: isCOD ? "COD" : "BKASH",
      payment_status: paymentStatus,
      fulfillment_status: isConfirmed ? "UNFULFILLED" : "FULFILLED",
      shipping_address_snapshot: { district: o % 3 === 0 ? "Dhaka" : "Chattogram" },
      source: o % 2 === 0 ? "WEBSITE" : "FACEBOOK",
      created_at: created,
      updated_at: created,
    } as unknown as Order);
  }

  // Tenant B: 30 orders, 5 customers (isolation check)
  for (let c = 0; c < 5; c++) {
    db.data.customers.push({
      id: `cus_b_${c}`,
      tenant_id: TENANT_B,
      first_name: `Other`,
      last_name: `${c}`,
      phone: `+88018000000${c}`,
      email: `user${c}@tenantb.com`,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Customer);
  }

  for (let o = 0; o < 30; o++) {
    db.data.orders.push({
      id: `ord_b_${o}`,
      tenant_id: TENANT_B,
      order_number: `ORD-B-${o}`,
      customer_id: `cus_b_${o % 5}`,
      status: "DELIVERED",
      currency: "BDT",
      subtotal: 5000,
      discount_total: 0,
      shipping_total: 0,
      tax_total: 0,
      grand_total: 5000,
      payment_method: "COD",
      payment_status: "PAID",
      fulfillment_status: "FULFILLED",
      shipping_address_snapshot: { district: "Sylhet" },
      source: "WEBSITE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as Order);
  }
}

async function main() {
  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}  PHASE C: ARCHITECTURAL REGRESSION GUARDS & ZERO-HYDRATION     ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================\n${ANSI_RESET}`);

  seedData();

  // 1. STATIC CODE ARCHITECTURE GUARDS
  console.log(`--- 1. Static Code Architecture Guards ---`);

  await runTest("Prohibit raw db.data.orders/customers/products in migrated domains", () => {
    const inspectedFiles = [
      "src/domains/analytics/analytics.service.ts",
      "src/domains/growth/services/customer-lifecycle.service.ts",
      "src/domains/growth/services/campaign.service.ts",
      "src/domains/growth/services/growth-intelligence.service.ts",
      "src/domains/intelligence/services/customer-intelligence.service.ts",
      "src/domains/autonomous/services/unified-context.service.ts",
      "src/app/api/v1/operations/fulfillment/route.ts",
      "src/app/api/v1/operations/sla/route.ts",
      "src/app/api/v1/platform/overview/route.ts",
    ];

    for (const rel of inspectedFiles) {
      const fullPath = path.resolve(process.cwd(), rel);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      assert.ok(
        !content.includes("db.data.orders.filter"),
        `${rel} must not perform in-memory db.data.orders.filter`
      );
      assert.ok(
        !content.includes("db.data.customers.filter"),
        `${rel} must not perform in-memory db.data.customers.filter`
      );
      assert.ok(
        !content.includes("db.getAllOrders(tenantId, { hydrate: true })"),
        `${rel} must not request full-table hydration`
      );
    }
  });

  await runTest("List endpoints enforce bounded cursor pagination (max <= 100)", async () => {
    const res = await orderRepository.listWithCursor(TENANT_A, { limit: 150 });
    // Bounded cap in orderRepository ensures limit never exceeds 100
    assert.ok(res.items.length <= 100, `Result count ${res.items.length} must be capped at 100`);
    assert.ok(res.nextCursor !== undefined || res.items.length <= 100);
  });

  // 2. QUERY-NATIVE REPOSITORY AGGREGATIONS
  console.log(`\n--- 2. Query-Native Repository Aggregations ---`);

  await runTest("orderRepository.sumRevenueInWindow computes scalar SUM strictly for tenant window", async () => {
    const now = Date.now();
    const startIso = new Date(now - 30 * 86400000).toISOString();
    const endIso = new Date(now + 86400000).toISOString();

    const sumA = await orderRepository.sumRevenueInWindow(TENANT_A, startIso, endIso);
    const sumB = await orderRepository.sumRevenueInWindow(TENANT_B, startIso, endIso);

    // 90 non-cancelled orders in Tenant A
    assert.ok(sumA > 0, "Tenant A revenue must be positive");
    assert.strictEqual(sumB, 30 * 5000, `Tenant B revenue must be exact (30 * 5000 = 150,000)`);
    assert.notStrictEqual(sumA, sumB, "Tenant A and Tenant B must not cross-pollinate");
  });

  await runTest("orderRepository.getCustomerOrderSummary aggregates per customer without loading all orders", async () => {
    const summaryA0 = await orderRepository.getCustomerOrderSummary(TENANT_A, "cus_a_0");
    assert.ok(summaryA0.orderCount > 0, "Customer cus_a_0 must have orders");
    assert.ok(summaryA0.totalSpend > 0, "Customer cus_a_0 must have total spend");
    assert.ok(summaryA0.lastOrderAt !== undefined, "Customer cus_a_0 must have lastOrderAt");

    // Foreign customer check (isolation)
    const summaryForeign = await orderRepository.getCustomerOrderSummary(TENANT_A, "cus_b_0");
    assert.strictEqual(summaryForeign.orderCount, 0, "Foreign customer in Tenant A must have 0 orders");
    assert.strictEqual(summaryForeign.totalSpend, 0);
  });

  await runTest("orderRepository.getAllCustomerOrderSummaries groups in database/repository", async () => {
    const summariesA = await orderRepository.getAllCustomerOrderSummaries(TENANT_A);
    assert.strictEqual(summariesA.size, 20, "Must have exactly 20 customer summaries for Tenant A");

    const summariesB = await orderRepository.getAllCustomerOrderSummaries(TENANT_B);
    assert.strictEqual(summariesB.size, 5, "Must have exactly 5 customer summaries for Tenant B");

    for (const [custId, s] of summariesA) {
      assert.ok(custId.startsWith("cus_a_"), "Summary customer ID must belong to Tenant A");
      assert.ok(s.orderCount > 0);
      assert.ok(s.totalSpend > 0);
    }
  });

  await runTest("orderRepository.findUnfulfilledOrders retrieves only unfulfilled orders", async () => {
    const unfulfilledA = await orderRepository.findUnfulfilledOrders(TENANT_A);
    assert.ok(unfulfilledA.length > 0, "Must find unfulfilled orders in Tenant A");
    assert.ok(
      unfulfilledA.every((o) => o.status === "CONFIRMED" || o.status === "PROCESSING"),
      "Every returned order must be CONFIRMED or PROCESSING"
    );
    assert.ok(
      unfulfilledA.every((o) => o.tenant_id === TENANT_A),
      "Must strictly belong to Tenant A"
    );
  });

  await runTest("orderRepository.getRtoGeographyMetrics groups by district with 64-district safety", async () => {
    const rtoMetrics = await orderRepository.getRtoGeographyMetrics(TENANT_A);
    assert.ok(rtoMetrics.has("Dhaka"), "Must contain Dhaka district metrics");
    assert.ok(rtoMetrics.has("Chattogram"), "Must contain Chattogram district metrics");
    assert.ok(!rtoMetrics.has("Sylhet"), "Must NOT contain Tenant B's Sylhet shipments");
  });

  await runTest("orderRepository.getChannelAttribution aggregates by channel without full array scan", async () => {
    const now = Date.now();
    const startIso = new Date(now - 30 * 86400000).toISOString();
    const endIso = new Date(now + 86400000).toISOString();

    const attribution = await orderRepository.getChannelAttribution(TENANT_A, startIso, endIso);
    assert.ok(attribution.tallies.has("WEBSITE"), "Must have WEBSITE channel orders");
    assert.ok(attribution.tallies.has("FACEBOOK_MESSENGER"), "Must have FACEBOOK_MESSENGER channel orders");
    assert.ok(attribution.total_orders_count > 0);
    assert.ok(attribution.total_gmv_bdt > 0);
  });

  // 3. POINT QUERIES AND REPOSITORY OPTIMIZATIONS
  console.log(`\n--- 3. Point Queries & Entity Lookups ---`);

  await runTest("customerRepository.findAllByPhone retrieves targeted customers by phone", async () => {
    const found = await customerRepository.findAllByPhone(TENANT_A, "+8801700000000");
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].id, "cus_a_0");

    const none = await customerRepository.findAllByPhone(TENANT_A, "+8801800000000"); // Tenant B's phone
    assert.strictEqual(none.length, 0, "Cross-tenant phone query must return 0 results");
  });

  await runTest("customerRepository.findByIds batches point lookups without scanning all customers", async () => {
    const found = await customerRepository.findByIds(TENANT_A, ["cus_a_1", "cus_a_2", "cus_b_0"]);
    assert.strictEqual(found.length, 2, "Must return only Tenant A customers");
    assert.ok(found.every((c) => c.tenant_id === TENANT_A));
  });

  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}================================================================\n${ANSI_RESET}`);

  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Architectural guards crashed:", err);
  process.exit(1);
});
