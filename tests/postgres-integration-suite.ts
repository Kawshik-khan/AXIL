/**
 * PostgreSQL Full Integration Test Suite (Zero-Hydration & System of Record)
 *
 * Validates the complete end-to-end integration of CommerceOS with PostgreSQL (PGlite in-process / Neon in prod):
 * 1. Migration & Schema Integrity: 006 (domain schema), 007 (multi-writer), 008 (apply_changes).
 * 2. Zero-Hydration Invariants: Core & Secondary collections are NOT in RAM; throws CollectionNotHydratedError.
 * 3. Primary Repositories Direct SQL & OCC: Orders, Products, Customers, Inventory, Coupons.
 * 4. Secondary Document Repositories: Suppliers, Purchase Orders via `commerceos.documents`.
 * 5. Bounded Cursor Streaming: iterateByCursor & listWithCursor across 120+ records.
 * 6. Strict Multi-Tenant Boundary Isolation: No cross-tenant reads or updates.
 * 7. OCC Concurrency Control: Stale version updates throw StoreConflictError.
 * 8. Analytical SQL Aggregations: getDailyOrderMetrics & sumRevenueByTenant in zero-hydration mode.
 *
 * Run: node tests/ts-runner.cjs ./tests/postgres-integration-suite.ts
 */

import assert from "assert";
import { ZERO_HYDRATION_CORE_TABLES, UNHYDRATED_DOCUMENT_COLLECTIONS } from "@/infrastructure/store/pg-store";
import { db, CommerceDatabase, CollectionNotHydratedError } from "@/infrastructure/db";
import { runMigrations } from "@/infrastructure/store/migrations";
import { createPgliteClient } from "@/infrastructure/store/pglite-client";
import { PgStorePersistence, StoreConflictError } from "@/infrastructure/store/pg-store";
import type { SqlClient } from "@/infrastructure/store/sql-client";
import { orderRepository } from "@/domains/orders/order.repository";
import { customerRepository } from "@/domains/customers/customer.repository";
import { productRepository } from "@/domains/catalog/product.repository";
import { couponRepository } from "@/domains/promotions/coupon.repository";
import { CouponService } from "@/domains/promotions/coupon.service";
import { supplierRepository } from "@/domains/operations/supplier.repository";
import { procurementService } from "@/domains/operations/services/procurement.service";
import { inventoryRepository } from "@/domains/inventory/inventory.repository";
import type { Order, Customer, Product, Coupon, Warehouse, ProductVariant } from "@/types/commerce";
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

const TENANT_1 = "ten_pg_suite_alpha";
const TENANT_2 = "ten_pg_suite_beta";

async function main() {
  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS POSTGRESQL INTEGRATION TEST SUITE                 ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================\n${ANSI_RESET}`);

  // 1. Initialize PGlite client and run migrations
  const client: SqlClient = createPgliteClient();
  await runMigrations(client);

  console.log(`${ANSI_BOLD}[1] Schema & Migration Validation${ANSI_RESET}`);

  await runTest("Schema commerceos exists with all required core tables and stored functions", async () => {
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'commerceos'`
    );
    const tableNames = new Set(tablesRes.rows.map((r) => r.table_name));

    const required = [
      "tenants", "orders", "order_items", "products", "product_variants",
      "inventory_items", "customers", "warehouses", "coupons", "documents",
      "changes", "store_state", "rate_limits", "store_writer",
    ];
    for (const t of required) {
      assert.ok(tableNames.has(t), `Missing table: commerceos.${t}`);
    }

    // Check stored procedure apply_changes from migration 008
    const funcRes = await client.query<{ routine_name: string }>(
      `SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'commerceos' AND routine_name = 'apply_changes'`
    );
    assert.strictEqual(funcRes.rows.length, 1, "Stored procedure commerceos.apply_changes must exist");
  });

  // Seed test workspaces
  await client.query(
    `INSERT INTO commerceos.tenants (id, tenant_id, data) VALUES 
     ($1, $1, $3::jsonb),
     ($2, $2, $4::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      TENANT_1,
      TENANT_2,
      JSON.stringify({ id: TENANT_1, name: "Workspace Alpha", status: "ACTIVE" }),
      JSON.stringify({ id: TENANT_2, name: "Workspace Beta", status: "ACTIVE" }),
    ]
  );

  console.log(`\n${ANSI_BOLD}[2] Zero-Hydration Boot & Memory Invariants${ANSI_RESET}`);

  const store = new CommerceDatabase({
    backend: "pg",
    client,
    persist: true,
    zeroHydration: true,
  });
  await store.ready();

  // Wire singleton db to use this client
  (db as any).pg = new PgStorePersistence(client);
  (db as any).backend = "pg";
  // The singleton now reads these tables from SQL, as it does with zero-hydration on in production
  (db as any).unhydratedCollections = new Set<string>([...ZERO_HYDRATION_CORE_TABLES, ...UNHYDRATED_DOCUMENT_COLLECTIONS]);

  await runTest("Core business entities & secondary documents are NEVER loaded into Node.js RAM at boot", () => {
    assert.strictEqual(store.isCollectionHydrated("orders"), false, "orders must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("customers"), false, "customers must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("products"), false, "products must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("inventory_items"), false, "inventory_items must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("coupons"), false, "coupons must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("warehouses"), false, "warehouses must not be hydrated");

    // Accessing unhydrated collections must throw CollectionNotHydratedError
    assert.throws(() => { const _ = store.data.orders; }, CollectionNotHydratedError);
    assert.throws(() => { const _ = store.data.customers; }, CollectionNotHydratedError);
    assert.throws(() => { const _ = store.data.products; }, CollectionNotHydratedError);
    assert.throws(() => { const _ = store.data.coupons; }, CollectionNotHydratedError);

    // Lightweight metadata collection IS hydrated in RAM
    assert.strictEqual(store.isCollectionHydrated("tenants"), true, "tenants must be hydrated");
    assert.ok(store.data.tenants.length >= 2, "tenants collection available in memory");
  });

  console.log(`\n${ANSI_BOLD}[3] Primary Entity Repositories Direct SQL & OCC${ANSI_RESET}`);

  // Seed order, customer, product in PostgreSQL
  const orderId = `ord_int_${Date.now()}`;
  const createdAt = new Date().toISOString();
  await client.query(
    `INSERT INTO commerceos.orders (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
    [
      orderId,
      TENANT_1,
      JSON.stringify({
        id: orderId,
        tenant_id: TENANT_1,
        order_number: "ORD-INT-001",
        status: "PENDING",
        grand_total: 1500,
        customer_id: "cus_int_1",
        created_at: createdAt,
      }),
      createdAt,
    ]
  );

  await runTest("orderRepository: direct SQL findById and update with OCC version increment", async () => {
    const fetched = await orderRepository.findById(TENANT_1, orderId);
    assert.ok(fetched, "Order must be retrievable from PostgreSQL");
    assert.strictEqual(fetched?.status, "PENDING");
    assert.strictEqual(fetched?.grand_total, 1500);

    // Update with version bump (1 -> 2)
    const updated = await orderRepository.update(TENANT_1, orderId, {
      status: "CONFIRMED",
      notes: "Verified via PG test suite",
    });
    assert.strictEqual(updated.status, "CONFIRMED");
    assert.strictEqual(updated.notes, "Verified via PG test suite");

    // Check version in PostgreSQL
    const res = await client.query<{ version: string }>(
      `SELECT version::text AS version FROM commerceos.orders WHERE tenant_id = $1 AND id = $2`,
      [TENANT_1, orderId]
    );
    assert.strictEqual(res.rows[0].version, "2", "Order version must be incremented to 2");
  });

  // Seed product in PostgreSQL
  const prodId = `prod_int_${Date.now()}`;
  await client.query(
    `INSERT INTO commerceos.products (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
    [
      prodId,
      TENANT_1,
      JSON.stringify({
        id: prodId,
        tenant_id: TENANT_1,
        name: "Smart Watch V2",
        status: "ACTIVE",
        base_price: 3500,
        created_at: createdAt,
      }),
      createdAt,
    ]
  );

  await runTest("productRepository: direct SQL update with OCC version increment", async () => {
    const updatedProd = await productRepository.update(TENANT_1, prodId, {
      name: "Smart Watch V2 Pro",
    });
    assert.strictEqual(updatedProd.name, "Smart Watch V2 Pro");

    const res = await client.query<{ version: string }>(
      `SELECT version::text AS version FROM commerceos.products WHERE tenant_id = $1 AND id = $2`,
      [TENANT_1, prodId]
    );
    assert.strictEqual(res.rows[0].version, "2", "Product version must be incremented to 2");
  });

  // Seed customer in PostgreSQL
  const custId = `cus_int_${Date.now()}`;
  await client.query(
    `INSERT INTO commerceos.customers (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
    [
      custId,
      TENANT_1,
      JSON.stringify({
        id: custId,
        tenant_id: TENANT_1,
        first_name: "Rahim",
        last_name: "Chowdhury",
        phone: "+8801711223344",
        status: "ACTIVE",
        created_at: createdAt,
      }),
      createdAt,
    ]
  );

  await runTest("customerRepository: direct SQL update with OCC version increment", async () => {
    const updatedCust = await customerRepository.update(TENANT_1, custId, {
      last_name: "Ahmed",
    });
    assert.strictEqual(updatedCust.last_name, "Ahmed");

    const res = await client.query<{ version: string }>(
      `SELECT version::text AS version FROM commerceos.customers WHERE tenant_id = $1 AND id = $2`,
      [TENANT_1, custId]
    );
    assert.strictEqual(res.rows[0].version, "2", "Customer version must be incremented to 2");
  });

  console.log(`\n${ANSI_BOLD}[4] Coupon Repository Native SQL & OCC${ANSI_RESET}`);

  const couponId = `cpn_int_${Date.now()}`;
  const coupon: Coupon = {
    id: couponId,
    tenant_id: TENANT_1,
    code: "EID2026",
    type: "PERCENTAGE",
    value: 15,
    maximum_discount: 500,
    minimum_order_value: 1000,
    usage_limit: 100,
    usage_count: 0,
    status: "ACTIVE",
    created_at: createdAt,
  };
  await client.query(
    `INSERT INTO commerceos.coupons (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
    [couponId, TENANT_1, createdAt, JSON.stringify(coupon)]
  );

  await runTest("couponRepository: case-insensitive code search & atomic usage increment", async () => {
    const found = await couponRepository.findByCode(TENANT_1, "  eid2026  ");
    assert.ok(found, "Coupon must be found case-insensitively");
    assert.strictEqual(found?.code, "EID2026");

    const updated = await couponRepository.incrementUsage(TENANT_1, "eid2026");
    assert.ok(updated);
    assert.strictEqual(updated.usage_count, 1);

    const recheck = await couponRepository.findByCode(TENANT_1, "EID2026");
    assert.strictEqual(recheck?.usage_count, 1);
  });

  await runTest("couponRepository: OCC conflict detection on concurrent write", async () => {
    // Current version is 1 (or 2 if incrementUsage bumped)
    const res = await client.query<{ version: string }>(
      `SELECT version::text AS version FROM commerceos.coupons WHERE tenant_id = $1 AND id = $2`,
      [TENANT_1, couponId]
    );
    const ver = Number(res.rows[0].version);

    // Update with correct version
    const ok = await couponRepository.update(
      TENANT_1,
      couponId,
      { maximum_discount: 600 },
      { expectedVersion: ver }
    );
    assert.strictEqual(ok.maximum_discount, 600);

    // Attempt update with stale expectedVersion -> throws StoreConflictError
    await assert.rejects(
      async () => {
        await couponRepository.update(
          TENANT_1,
          couponId,
          { maximum_discount: 999 },
          { expectedVersion: ver } // stale
        );
      },
      StoreConflictError,
      "Stale expectedVersion must throw StoreConflictError"
    );
  });

  await runTest("CouponService: validates and calculates discount via repository", async () => {
    const calc = await CouponService.validateAndCalculateDiscount(TENANT_1, "EID2026", 2000);
    assert.strictEqual(calc.coupon.code, "EID2026");
    assert.strictEqual(calc.discount, 300); // 15% of 2000 = 300 <= 600
  });

  console.log(`\n${ANSI_BOLD}[5] Secondary Entities & Documents (commerceos.documents)${ANSI_RESET}`);

  const suppId = `sup_int_${Date.now()}`;
  const supplier: Supplier = {
    id: suppId,
    tenant_id: TENANT_1,
    name: "Bengal Textiles Ltd",
    code: "SUP-BT-01",
    contact_person: "Mr. Faruk",
    email: "faruk@bengaltextiles.com.bd",
    phone: "01711000001",
    address: "Mirpur 10, Dhaka",
    city: "Dhaka",
    lead_time_days: 4,
    payment_terms: "NET_30",
    rating: 4.8,
    is_allowlisted: true,
    min_order_value_bdt: 15000,
    status: "ACTIVE",
    created_at: createdAt,
    updated_at: createdAt,
  };
  await client.query(
    `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data, version) VALUES ('suppliers', $1, $2, $3::timestamptz, $4::jsonb, 1)`,
    [suppId, TENANT_1, createdAt, JSON.stringify(supplier)]
  );

  await runTest("supplierRepository: findSupplierById and listSuppliers via commerceos.documents", async () => {
    const found = await supplierRepository.findSupplierById(TENANT_1, suppId);
    assert.ok(found, "Supplier retrieved from documents table");
    assert.strictEqual(found?.name, "Bengal Textiles Ltd");

    const all = await supplierRepository.listSuppliers(TENANT_1);
    assert.ok(all.length >= 1, "listSuppliers returns suppliers list");
  });

  // Seed Purchase Order
  const poId = `po_int_${Date.now()}`;
  const po: PurchaseOrder = {
    id: poId,
    tenant_id: TENANT_1,
    po_number: `PO-INT-1001`,
    supplier_id: suppId,
    supplier_name: supplier.name,
    status: "DRAFT",
    items: [
      {
        id: `poi_int_1`,
        purchase_order_id: poId,
        product_variant_id: "var_int_1",
        sku: "BT-COTTON-L",
        product_name: "Cotton Fabric",
        quantity_ordered: 100,
        quantity_received: 0,
        unit_cost: 450,
        subtotal: 45000,
      },
    ],
    total_amount: 45000,
    currency: "BDT",
    created_at: createdAt,
    updated_at: createdAt,
  };
  await client.query(
    `INSERT INTO commerceos.documents (collection, id, tenant_id, created_at, data, version) VALUES ('purchase_orders', $1, $2, $3::timestamptz, $4::jsonb, 1)`,
    [poId, TENANT_1, createdAt, JSON.stringify(po)]
  );

  await runTest("supplierRepository & procurementService: purchase order lifecycle", async () => {
    const list = await supplierRepository.listPurchaseOrdersWithCursor(TENANT_1, { limit: 10 });
    assert.ok(list.items.length >= 1, "Purchase orders returned via cursor pagination");

    const transitioned = await procurementService.transitionPurchaseOrderStatusAsync(
      TENANT_1,
      poId,
      "APPROVED",
      "usr_procurement_lead"
    );
    assert.strictEqual(transitioned.status, "APPROVED");
    assert.strictEqual(transitioned.approved_by, "usr_procurement_lead");
  });

  console.log(`\n${ANSI_BOLD}[6] Warehouse Lookups in Inventory Repository${ANSI_RESET}`);

  const whId = `wh_int_${Date.now()}`;
  const warehouse: Warehouse = {
    id: whId,
    tenant_id: TENANT_1,
    name: "Central Dhaka Warehouse",
    code: "WH-DHK-01",
    address: "Tejgaon Industrial Area",
    city: "Dhaka",
    district: "Dhaka",
    status: "ACTIVE",
    created_at: createdAt,
    updated_at: createdAt,
  };
  await client.query(
    `INSERT INTO commerceos.warehouses (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
    [whId, TENANT_1, createdAt, JSON.stringify(warehouse)]
  );

  await runTest("inventoryRepository: getWarehouses and findWarehouseById query SQL directly", async () => {
    const warehouses = await inventoryRepository.getWarehouses(TENANT_1);
    assert.ok(warehouses.some((w) => w.id === whId), "Warehouse must be listed");

    const wh = await inventoryRepository.findWarehouseById(TENANT_1, whId);
    assert.ok(wh, "Warehouse point lookup succeeded");
    assert.strictEqual(wh?.code, "WH-DHK-01");

    const crossWh = await inventoryRepository.findWarehouseById(TENANT_2, whId);
    assert.strictEqual(crossWh, null, "Cross-tenant warehouse lookup returns null");
  });

  console.log(`\n${ANSI_BOLD}[7] Bounded Cursor Streaming & Pagination${ANSI_RESET}`);

  await runTest("orderRepository.iterateByCursor streams 120 seeded orders in bounded batches", async () => {
    // Seed 120 orders in PostgreSQL
    for (let i = 0; i < 120; i++) {
      const oid = `ord_stream_${i}_${Date.now()}`;
      const d = new Date(Date.now() - i * 1000).toISOString();
      await client.query(
        `INSERT INTO commerceos.orders (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
        [
          oid,
          TENANT_1,
          d,
          JSON.stringify({
            id: oid,
            tenant_id: TENANT_1,
            order_number: `ORD-STR-${i}`,
            grand_total: 1000 + i,
            status: "DELIVERED",
            created_at: d,
          }),
        ]
      );
    }

    let streamCount = 0;
    for await (const batch of orderRepository.iterateByCursor(TENANT_1, 25)) {
      for (const ord of batch) {
        assert.strictEqual(ord.tenant_id, TENANT_1);
        streamCount++;
      }
    }
    assert.ok(streamCount >= 120, `Must stream 120+ orders, streamed ${streamCount}`);
  });

  console.log(`\n${ANSI_BOLD}[8] Multi-Tenant Boundary Isolation${ANSI_RESET}`);

  await runTest("Tenant 1 cannot read or modify Tenant 2 records", async () => {
    const orderBetaId = `ord_beta_${Date.now()}`;
    await client.query(
      `INSERT INTO commerceos.orders (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
      [
        orderBetaId,
        TENANT_2,
        createdAt,
        JSON.stringify({
          id: orderBetaId,
          tenant_id: TENANT_2,
          order_number: "ORD-BETA-001",
          grand_total: 800,
          status: "PENDING",
        }),
      ]
    );

    // Cross-tenant read must return null
    const crossRead = await orderRepository.findById(TENANT_1, orderBetaId);
    assert.strictEqual(crossRead, null, "Tenant 1 must NOT be able to view Tenant 2 order");

    // Cross-tenant update must return null (zero rows modified)
    const crossUpdate = await orderRepository.update(TENANT_1, orderBetaId, { status: "CONFIRMED" });
    assert.strictEqual(crossUpdate, null, "Cross-tenant update must return null");

    // Verify Tenant 2 order remained PENDING in PostgreSQL
    const res = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.orders WHERE id = $1`,
      [orderBetaId]
    );
    const parsed = typeof res.rows[0].data === "string" ? JSON.parse(res.rows[0].data) : res.rows[0].data;
    assert.strictEqual(parsed.status, "PENDING", "Tenant 2 order must remain PENDING");
  });

  console.log(`\n${ANSI_BOLD}[9] SQL Aggregations & Offline Intelligence${ANSI_RESET}`);

  await runTest("orderRepository: getDailyOrderMetrics and sumRevenueByTenant execute via direct SQL", async () => {
    const dailyMetrics = await orderRepository.getDailyOrderMetrics(TENANT_1, 7);
    assert.ok(Array.isArray(dailyMetrics), "Daily metrics must return an array");

    const { revenue, totalOrders } = await orderRepository.sumRevenueByTenant(TENANT_1);
    assert.ok(typeof totalOrders === "number", "totalOrders must be a number");
    assert.ok(totalOrders >= 120, "totalOrders must count all seeded orders");
    assert.ok(revenue > 100000, "Revenue sum must reflect seeded orders");
  });

  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}  TEST RESULTS: ${passedCount} PASSED | ${failedCount} FAILED   ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}================================================================\n${ANSI_RESET}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL SUITE CRASH:", err);
  process.exit(1);
});
