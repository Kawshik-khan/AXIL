/**
 * Phase E: Secondary Entity Cutover, Transitional Loader Elimination & Offline Batch Decoupling Suite
 *
 * Validates:
 * 1. Zero-Hydration Invariants for Secondary Entities:
 *    - `coupons`, `warehouses`, `suppliers`, `supplier_products`, `purchase_orders` are NOT hydrated in RAM.
 *    - Direct raw access to store.data throws CollectionNotHydratedError.
 * 2. Transitional Loader Eradication:
 *    - Verifies getAllByTenant is permanently removed from orderRepository, customerRepository, productRepository.
 * 3. Coupon Repository Native SQL Operations & OCC:
 *    - findByCode, findById, listWithCursor, iterateByCursor, create, incrementUsage.
 *    - Version-based OCC conflicts throw StoreConflictError.
 *    - Strict tenant boundary isolation.
 * 4. Supplier & Purchase Order Repository Native SQL Operations & OCC:
 *    - findSupplierById, listSuppliers, getSupplierProducts, createSupplierProduct.
 *    - listPurchaseOrdersWithCursor, createPurchaseOrder, updatePurchaseOrder with OCC.
 *    - State machine status transitions via procurementService.
 * 5. Warehouse Lookups in Inventory Repository:
 *    - getWarehouses and findWarehouseById querying commerceos.warehouses via SQL.
 * 6. Decoupled Offline Batch & Intelligence Operations:
 *    - SQL aggregations via orderRepository.getDailyOrderMetrics & sumRevenueByTenant.
 *    - Anomaly detection, scenario simulation, and cohort analysis execute without memory hydration.
 *
 * Run: node tests/ts-runner.cjs ./tests/phase-e-secondary-entities-tests.ts
 */

import assert from "assert";
import { db, CommerceDatabase, CollectionNotHydratedError } from "@/infrastructure/db";
import { runMigrations } from "@/infrastructure/store/migrations";
import { createPgliteClient } from "@/infrastructure/store/pglite-client";
import { PgStorePersistence, StoreConflictError, ZERO_HYDRATION_CORE_TABLES, UNHYDRATED_DOCUMENT_COLLECTIONS } from "@/infrastructure/store/pg-store";
import type { SqlClient } from "@/infrastructure/store/sql-client";
import { couponRepository } from "@/domains/promotions/coupon.repository";
import { CouponService } from "@/domains/promotions/coupon.service";
import { supplierRepository } from "@/domains/operations/supplier.repository";
import { procurementService } from "@/domains/operations/services/procurement.service";
import { inventoryRepository } from "@/domains/inventory/inventory.repository";
import { orderRepository } from "@/domains/orders/order.repository";
import { customerRepository } from "@/domains/customers/customer.repository";
import { productRepository } from "@/domains/catalog/product.repository";
import { anomalyDetectorService } from "@/domains/intelligence/services/anomaly-detector.service";
import { simulationService } from "@/domains/intelligence/services/simulation.service";
import { cohortAnalysisService } from "@/domains/intelligence/services/cohort-analysis.service";
import type { Coupon, Warehouse } from "@/types/commerce";
import type { Supplier, SupplierProduct, PurchaseOrder } from "@/types/operations";

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
    console.error(`      ${err instanceof Error ? err.stack || err.message : String(err)}`);
    failedCount++;
  }
}

const TENANT_A = "ten_phase_e_tenant_a";
const TENANT_B = "ten_phase_e_tenant_b";

async function main() {
  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}  PHASE E: SECONDARY ENTITY CUTOVER & BATCH DECOUPLING         ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================\n${ANSI_RESET}`);

  const client: SqlClient = createPgliteClient();
  await runMigrations(client);

  // Seed tenants
  await client.query(
    `INSERT INTO commerceos.tenants (id, tenant_id, data) VALUES 
     ($1, $1, $3::jsonb),
     ($2, $2, $4::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      TENANT_A,
      TENANT_B,
      JSON.stringify({ id: TENANT_A, name: "Phase E Workspace A", status: "ACTIVE" }),
      JSON.stringify({ id: TENANT_B, name: "Phase E Workspace B", status: "ACTIVE" }),
    ]
  );

  // 1. Seed 25 coupons in PostgreSQL (commerceos.coupons) for Tenant A, 1 for Tenant B
  for (let i = 0; i < 25; i++) {
    const createdAt = new Date(Date.now() - (25 - i) * 60000).toISOString();
    const coupon: Coupon = {
      id: `cpn_e_${i}`,
      tenant_id: TENANT_A,
      code: `SAVE${i + 1}`,
      type: "PERCENTAGE",
      value: 10 + (i % 20),
      minimum_order_value: 500,
      maximum_discount: 200,
      usage_limit: 100,
      usage_count: i,
      status: "ACTIVE",
      created_at: createdAt,
    };
    await client.query(
      `INSERT INTO commerceos.coupons (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
      [coupon.id, TENANT_A, createdAt, JSON.stringify(coupon)]
    );
  }

  // Tenant B coupon
  const cpnBTime = new Date().toISOString();
  await client.query(
    `INSERT INTO commerceos.coupons (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
    [
      "cpn_tb_1",
      TENANT_B,
      cpnBTime,
      JSON.stringify({
        id: "cpn_tb_1",
        tenant_id: TENANT_B,
        code: "TENANTB10",
        type: "PERCENTAGE",
        value: 10,
        status: "ACTIVE",
        created_at: cpnBTime,
      }),
    ]
  );

  // 2. Seed 2 warehouses in PostgreSQL (commerceos.warehouses) for Tenant A, 1 for Tenant B
  const wh1: Warehouse = {
    id: "wh_e_central",
    tenant_id: TENANT_A,
    name: "Central Dhaka Warehouse",
    code: "WH-DHK-01",
    address: "Tejgaon Industrial Area",
    city: "Dhaka",
    district: "Dhaka",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const wh2: Warehouse = {
    id: "wh_e_ctg",
    tenant_id: TENANT_A,
    name: "Chittagong Hub",
    code: "WH-CTG-01",
    address: "Agrabad Commercial Area",
    city: "Chittagong",
    district: "Chittagong",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const whB: Warehouse = {
    id: "wh_tb_main",
    tenant_id: TENANT_B,
    name: "Tenant B Main Depot",
    code: "WH-TB-01",
    address: "Sylhet Sadar",
    city: "Sylhet",
    district: "Sylhet",
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  for (const wh of [wh1, wh2, whB]) {
    await client.query(
      `INSERT INTO commerceos.warehouses (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
      [wh.id, wh.tenant_id, wh.created_at, JSON.stringify(wh)]
    );
  }

  // 3. Seed suppliers, supplier products, and purchase orders in commerceos.documents
  const sup1: Supplier = {
    id: "sup_e_textiles",
    tenant_id: TENANT_A,
    name: "Bengal Textiles Ltd",
    code: "SUP-BT-01",
    contact_person: "Abdur Rahman",
    email: "orders@bengaltextiles.com.bd",
    phone: "01711000001",
    address: "Savar EPZ",
    city: "Dhaka",
    lead_time_days: 4,
    payment_terms: "NET_30",
    rating: 4.7,
    is_allowlisted: true,
    min_order_value_bdt: 15000,
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const supB: Supplier = {
    id: "sup_tb_fabrics",
    tenant_id: TENANT_B,
    name: "Tenant B Fabrics",
    code: "SUP-TB-01",
    contact_person: "Karim Ullah",
    email: "karim@tbfabrics.com",
    phone: "01811000002",
    address: "Sylhet",
    city: "Sylhet",
    lead_time_days: 5,
    payment_terms: "NET_15",
    rating: 4.5,
    is_allowlisted: true,
    min_order_value_bdt: 10000,
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  for (const s of [sup1, supB]) {
    await client.query(
      `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data, version) VALUES ('suppliers', $1, $2, $3::timestamptz, $4::jsonb, 1)`,
      [s.id, s.tenant_id, s.created_at, JSON.stringify(s)]
    );
  }

  const sp1: SupplierProduct = {
    id: "sp_e_cotton_l",
    tenant_id: TENANT_A,
    supplier_id: sup1.id,
    product_variant_id: "var_e_cotton_l",
    supplier_sku: "BTL-COTTON-L",
    cost_price: 450,
    currency: "BDT",
    moq: 50,
    lead_time_days: 4,
    available_stock: 500,
    is_preferred: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await client.query(
    `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data, version) VALUES ('supplier_products', $1, $2, $3::timestamptz, $4::jsonb, 1)`,
    [sp1.id, TENANT_A, sp1.created_at, JSON.stringify(sp1)]
  );

  // Seed 15 purchase orders for Tenant A
  for (let i = 0; i < 15; i++) {
    const poTime = new Date(Date.now() - (15 - i) * 60000).toISOString();
    const po: PurchaseOrder = {
      id: `po_e_${i}`,
      tenant_id: TENANT_A,
      po_number: `PO-E-${1000 + i}`,
      supplier_id: sup1.id,
      supplier_name: sup1.name,
      status: i % 2 === 0 ? "DRAFT" : "SENT",
      items: [
        {
          id: `poi_e_${i}`,
          purchase_order_id: `po_e_${i}`,
          product_variant_id: "var_e_cotton_l",
          sku: "COTTON-L",
          product_name: "Premium Cotton T-Shirt L",
          quantity_ordered: 100,
          quantity_received: 0,
          unit_cost: 450,
          subtotal: 45000,
        },
      ],
      total_amount: 45000,
      currency: "BDT",
      created_at: poTime,
      updated_at: poTime,
    };
    await client.query(
      `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data, version) VALUES ('purchase_orders', $1, $2, $3::timestamptz, $4::jsonb, 1)`,
      [po.id, TENANT_A, poTime, JSON.stringify(po)]
    );
  }

  // 4. Seed 30 orders for Tenant A across different days to test SQL batch metric aggregations
  for (let i = 0; i < 30; i++) {
    const daysAgo = i % 5;
    const orderDate = new Date(Date.now() - daysAgo * 86400000).toISOString();
    await client.query(
      `INSERT INTO commerceos.orders (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
      [
        `ord_e_batch_${i}`,
        TENANT_A,
        orderDate,
        JSON.stringify({
          id: `ord_e_batch_${i}`,
          tenant_id: TENANT_A,
          order_number: `ORD-E-${i}`,
          status: "DELIVERED",
          grand_total: 1200 + i * 50,
          created_at: orderDate,
        }),
      ]
    );
  }

  // Initialize store in Zero-Hydration mode
  const store = new CommerceDatabase({
    backend: "pg",
    client,
    persist: true,
    zeroHydration: true,
  });
  await store.ready();
  if (!(db as any).pg || typeof (db as any).pg.computeChanges !== "function") {
    (db as any).pg = new PgStorePersistence(client);
  } else {
    (db as any).pg.client = client;
  }
  // The singleton now reads these tables from SQL, as it does with zero-hydration on in production
  (db as any).unhydratedCollections = new Set<string>([...ZERO_HYDRATION_CORE_TABLES, ...UNHYDRATED_DOCUMENT_COLLECTIONS]);

  console.log("--- 1. Zero-Hydration Invariants for Secondary Entities ---");

  await runTest("Secondary entities are NOT hydrated into RAM at cold boot", () => {
    assert.strictEqual(store.isCollectionHydrated("coupons"), false, "coupons must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("warehouses"), false, "warehouses must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("suppliers"), false, "suppliers must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("supplier_products"), false, "supplier_products must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("purchase_orders"), false, "purchase_orders must not be hydrated");
  });

  await runTest("Direct raw access to unhydrated secondary collections throws CollectionNotHydratedError", () => {
    assert.throws(() => { const _ = store.data.coupons; }, CollectionNotHydratedError);
    assert.throws(() => { const _ = store.data.warehouses; }, CollectionNotHydratedError);
    assert.throws(() => { const _ = store.data.suppliers; }, CollectionNotHydratedError);
    assert.throws(() => { const _ = store.data.supplier_products; }, CollectionNotHydratedError);
    assert.throws(() => { const _ = store.data.purchase_orders; }, CollectionNotHydratedError);
  });

  console.log("\n--- 2. Transitional Loader Eradication Verification ---");

  await runTest("getAllByTenant is eradicated from all repositories", () => {
    assert.strictEqual((orderRepository as any).getAllByTenant, undefined, "orderRepository.getAllByTenant must not exist");
    assert.strictEqual((customerRepository as any).getAllByTenant, undefined, "customerRepository.getAllByTenant must not exist");
    assert.strictEqual((productRepository as any).getAllByTenant, undefined, "productRepository.getAllByTenant must not exist");
  });

  console.log("\n--- 3. Coupon Repository Native SQL Operations & OCC ---");

  await runTest("couponRepository.findByCode performs case-insensitive point lookup via SQL", async () => {
    const coupon = await couponRepository.findByCode(TENANT_A, "  save1  ");
    assert.ok(coupon, "Coupon found");
    assert.strictEqual(coupon.code, "SAVE1");
    assert.strictEqual(coupon.value, 10);
  });

  await runTest("couponRepository.findByCode enforces strict multi-tenant boundary", async () => {
    const crossTenant = await couponRepository.findByCode(TENANT_B, "SAVE1");
    assert.strictEqual(crossTenant, null, "Tenant B cannot access Tenant A coupon");

    const tenantBCoupon = await couponRepository.findByCode(TENANT_B, "TENANTB10");
    assert.ok(tenantBCoupon, "Tenant B finds own coupon");
    assert.strictEqual(tenantBCoupon.code, "TENANTB10");
  });

  await runTest("couponRepository.listWithCursor paginates bounded batches with next_cursor", async () => {
    const page1 = await couponRepository.listWithCursor(TENANT_A, { limit: 10 });
    assert.strictEqual(page1.items.length, 10);
    assert.strictEqual(page1.pagination.has_more, true);
    assert.ok(page1.pagination.next_cursor);

    const page2 = await couponRepository.listWithCursor(TENANT_A, {
      limit: 10,
      cursor: page1.pagination.next_cursor,
    });
    assert.strictEqual(page2.items.length, 10);
    assert.strictEqual(page2.pagination.has_more, true);

    const page3 = await couponRepository.listWithCursor(TENANT_A, {
      limit: 10,
      cursor: page2.pagination.next_cursor,
    });
    assert.strictEqual(page3.items.length, 5);
    assert.strictEqual(page3.pagination.has_more, false);
    assert.strictEqual(page3.pagination.next_cursor, null);
  });

  await runTest("couponRepository.iterateByCursor streams all 25 coupons in bounded chunks", async () => {
    const streamed: Coupon[] = [];
    for await (const batch of couponRepository.iterateByCursor(TENANT_A, { batchSize: 7 })) {
      streamed.push(...batch);
    }
    assert.strictEqual(streamed.length, 25, "All 25 coupons streamed without in-memory scan");
  });

  await runTest("couponRepository.incrementUsage atomically updates usage in PostgreSQL", async () => {
    const before = await couponRepository.findByCode(TENANT_A, "SAVE5");
    assert.ok(before);
    const initialUsage = before.usage_count || 0;

    const updated = await couponRepository.incrementUsage(TENANT_A, "save5");
    assert.ok(updated);
    assert.strictEqual(updated.usage_count, initialUsage + 1);

    const recheck = await couponRepository.findByCode(TENANT_A, "SAVE5");
    assert.strictEqual(recheck?.usage_count, initialUsage + 1);
  });

  await runTest("couponRepository.update enforces Optimistic Concurrency Control (OCC)", async () => {
    // Current version in PostgreSQL is 1
    const res = await client.query<{ version: string }>(
      `SELECT version::text AS version FROM commerceos.coupons WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, "cpn_e_10"]
    );
    const currentVersion = Number(res.rows[0].version);

    // Writer 1 updates successfully with correct expectedVersion
    const updated = await couponRepository.update(
      TENANT_A,
      "cpn_e_10",
      { maximum_discount: 500 },
      { expectedVersion: currentVersion }
    );
    assert.strictEqual(updated.maximum_discount, 500);

    // Writer 2 attempts update with stale expectedVersion -> throws StoreConflictError
    await assert.rejects(async () => {
      await couponRepository.update(
        TENANT_A,
        "cpn_e_10",
        { maximum_discount: 999 },
        { expectedVersion: currentVersion }
      );
    }, (err: unknown) => {
      assert.ok(err instanceof StoreConflictError, "Must throw StoreConflictError");
      assert.strictEqual((err as any).rows[0].collection, "coupons");
      assert.strictEqual((err as any).rows[0].id, "cpn_e_10");
      return true;
    });
  });

  await runTest("CouponService.validateAndCalculateDiscount calculates discounts via repository", async () => {
    const result = await CouponService.validateAndCalculateDiscount(TENANT_A, "SAVE1", 2000);
    assert.strictEqual(result.coupon.code, "SAVE1");
    assert.ok(result.discount > 0);
  });

  console.log("\n--- 4. Supplier & Purchase Order Repository Native SQL Operations & OCC ---");

  await runTest("supplierRepository.findSupplierById and listSuppliers execute via commerceos.documents", async () => {
    const supplier = await supplierRepository.findSupplierById(TENANT_A, "sup_e_textiles");
    assert.ok(supplier, "Supplier retrieved");
    assert.strictEqual(supplier.name, "Bengal Textiles Ltd");

    const suppliers = await supplierRepository.listSuppliers(TENANT_A);
    assert.strictEqual(suppliers.length, 1);
    assert.strictEqual(suppliers[0].id, "sup_e_textiles");

    // Cross-tenant isolation
    const crossTenant = await supplierRepository.findSupplierById(TENANT_B, "sup_e_textiles");
    assert.strictEqual(crossTenant, null, "Cross-tenant access rejected");
  });

  await runTest("supplierRepository.getSupplierProducts queries documents collection", async () => {
    const products = await supplierRepository.getSupplierProducts(TENANT_A, "sup_e_textiles");
    assert.strictEqual(products.length, 1);
    assert.strictEqual(products[0].id, "sp_e_cotton_l");
    assert.strictEqual(products[0].cost_price, 450);
  });

  await runTest("supplierRepository.listPurchaseOrdersWithCursor paginates purchase orders", async () => {
    const page1 = await supplierRepository.listPurchaseOrdersWithCursor(TENANT_A, { limit: 10 });
    assert.strictEqual(page1.items.length, 10);
    assert.strictEqual(page1.pagination.has_more, true);
    assert.ok(page1.pagination.next_cursor);

    const page2 = await supplierRepository.listPurchaseOrdersWithCursor(TENANT_A, {
      limit: 10,
      cursor: page1.pagination.next_cursor,
    });
    assert.strictEqual(page2.items.length, 5);
    assert.strictEqual(page2.pagination.has_more, false);
  });

  await runTest("supplierRepository.updatePurchaseOrder enforces OCC conflicts", async () => {
    const res = await client.query<{ version: string }>(
      `SELECT version::text AS version FROM commerceos.documents WHERE collection = 'purchase_orders' AND tenant_id = $1 AND id = $2`,
      [TENANT_A, "po_e_0"]
    );
    const initialVersion = Number(res.rows[0].version);

    // Writer 1 updates successfully
    const updated = await supplierRepository.updatePurchaseOrder(
      TENANT_A,
      "po_e_0",
      { notes: "Writer 1 approved order" },
      { expectedVersion: initialVersion }
    );
    assert.strictEqual(updated.notes, "Writer 1 approved order");

    // Writer 2 fails with StoreConflictError
    await assert.rejects(async () => {
      await supplierRepository.updatePurchaseOrder(
        TENANT_A,
        "po_e_0",
        { notes: "Writer 2 stale update" },
        { expectedVersion: initialVersion }
      );
    }, (err: unknown) => {
      assert.ok(err instanceof StoreConflictError, "Must throw StoreConflictError");
      assert.strictEqual((err as any).rows[0].collection, "purchase_orders");
      assert.strictEqual((err as any).rows[0].id, "po_e_0");
      return true;
    });
  });

  await runTest("procurementService transitions purchase order status asynchronously", async () => {
    const transitioned = await procurementService.transitionPurchaseOrderStatusAsync(
      TENANT_A,
      "po_e_2",
      "APPROVED",
      "usr_procurement_lead"
    );
    assert.strictEqual(transitioned.status, "APPROVED");
    assert.strictEqual(transitioned.approved_by, "usr_procurement_lead");
    assert.ok(transitioned.approved_at);
  });

  console.log("\n--- 5. Warehouse Lookups in Inventory Repository ---");

  await runTest("inventoryRepository.getWarehouses queries commerceos.warehouses via SQL client", async () => {
    const warehouses = await inventoryRepository.getWarehouses(TENANT_A);
    assert.strictEqual(warehouses.length, 2);
    assert.strictEqual(warehouses[0].name, "Central Dhaka Warehouse");
    assert.strictEqual(warehouses[1].name, "Chittagong Hub");

    // Tenant B isolation
    const warehousesB = await inventoryRepository.getWarehouses(TENANT_B);
    assert.strictEqual(warehousesB.length, 1);
    assert.strictEqual(warehousesB[0].name, "Tenant B Main Depot");
  });

  await runTest("inventoryRepository.findWarehouseById retrieves warehouse without in-memory scan", async () => {
    const wh = await inventoryRepository.findWarehouseById(TENANT_A, "wh_e_central");
    assert.ok(wh);
    assert.strictEqual(wh.id, "wh_e_central");
    assert.strictEqual(wh.code, "WH-DHK-01");

    const crossWh = await inventoryRepository.findWarehouseById(TENANT_B, "wh_e_central");
    assert.strictEqual(crossWh, null, "Cross-tenant lookup returns null");
  });

  console.log("\n--- 6. Decoupled Offline Batch & Intelligence Operations ---");

  await runTest("orderRepository.getDailyOrderMetrics computes daily aggregates via SQL without full table scan", async () => {
    const metrics = await orderRepository.getDailyOrderMetrics(TENANT_A, 7);
    assert.ok(metrics.length > 0, "Metrics computed");
    for (const m of metrics) {
      assert.ok(m.day);
      assert.ok(m.count > 0);
      assert.ok(m.revenue > 0);
    }
  });

  await runTest("orderRepository.sumRevenueByTenant executes direct SQL aggregate in zero-hydration mode", async () => {
    const { revenue, totalOrders } = await orderRepository.sumRevenueByTenant(TENANT_A);
    assert.strictEqual(totalOrders, 30);
    assert.ok(revenue > 30000);
  });

  await runTest("anomalyDetectorService.computeAnomaliesAsync runs in zero-hydration mode without throwing", async () => {
    const anomalies = await anomalyDetectorService.computeAnomaliesAsync(TENANT_A);
    assert.ok(Array.isArray(anomalies));
  });

  await runTest("simulationService.simulateScenarioAsync runs in zero-hydration mode without throwing", async () => {
    const result = await simulationService.simulateScenarioAsync(TENANT_A, "Test Scenario", {
      price_change_pct: 10,
    });
    assert.ok(result);
    assert.strictEqual(result.scenario_type, "CUSTOM");
    assert.ok(result.simulated_metrics.revenue !== undefined);
  });

  await runTest("cohortAnalysisService.computeCohorts runs in zero-hydration mode without throwing", () => {
    const cohorts = cohortAnalysisService.computeCohorts(TENANT_A);
    assert.ok(Array.isArray(cohorts));
  });

  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
