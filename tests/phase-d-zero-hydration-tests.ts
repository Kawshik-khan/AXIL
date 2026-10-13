/**
 * Phase D: Zero-Hydration Cutover & Write-Path Decoupling Suite
 *
 * Validates:
 * 1. Zero-Hydration Startup: Large business tables (orders, customers, products, inventory)
 *    are NOT materialized in Node.js RAM at boot.
 * 2. fromParsed() Safety: Direct access to unhydrated collections throws CollectionNotHydratedError
 *    instead of returning fake empty collections [].
 * 3. Semantic Repository Mutations: Repositories execute direct parameterized SQL commands
 *    with version-based optimistic concurrency control (OCC).
 * 4. Optimistic Concurrency Control: Concurrent writes detect version conflicts and reject
 *    stale writers with StoreConflictError without silent lost updates.
 * 5. Bounded Cursor Processing: Large batch queries stream records via iterateByCursor in bounded chunks.
 * 6. Write-Diff Decoupling: computeChanges and diffCollection do not touch unhydrated tables.
 * 7. Tenant Isolation: Mutations enforce strict tenant scoping.
 *
 * Run: node tests/ts-runner.cjs ./tests/phase-d-zero-hydration-tests.ts
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
import type { Order, Customer, Product } from "@/types/commerce";

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

const TENANT_A = "ten_phase_d_cutover_a";
const TENANT_B = "ten_phase_d_cutover_b";

async function main() {
  console.log(`\n${ANSI_BOLD}================================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}  PHASE D: ZERO-HYDRATION CUTOVER & WRITE-PATH DECOUPLING       ${ANSI_RESET}`);
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
      JSON.stringify({ id: TENANT_A, name: "Workspace Cutover A", status: "ACTIVE" }),
      JSON.stringify({ id: TENANT_B, name: "Workspace Cutover B", status: "ACTIVE" }),
    ]
  );

  // Seed 250 orders, 150 customers, and 50 products in PostgreSQL
  for (let i = 0; i < 250; i++) {
    const createdAt = new Date(Date.now() - i * 60000).toISOString();
    await client.query(
      `INSERT INTO commerceos.orders (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
      [
        `ord_d_${i}`,
        TENANT_A,
        JSON.stringify({
          id: `ord_d_${i}`,
          tenant_id: TENANT_A,
          order_number: `ORD-D-${i}`,
          status: "CONFIRMED",
          grand_total: 1000 + i * 10,
          customer_id: `cust_d_${i % 150}`,
          created_at: createdAt,
        }),
        createdAt,
      ]
    );
  }

  for (let i = 0; i < 150; i++) {
    const createdAt = new Date(Date.now() - i * 60000).toISOString();
    await client.query(
      `INSERT INTO commerceos.customers (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
      [
        `cust_d_${i}`,
        TENANT_A,
        JSON.stringify({
          id: `cust_d_${i}`,
          tenant_id: TENANT_A,
          first_name: `Customer`,
          last_name: `${i}`,
          phone: `0171000${i.toString().padStart(4, "0")}`,
          created_at: createdAt,
        }),
        createdAt,
      ]
    );
  }

  for (let i = 0; i < 50; i++) {
    const createdAt = new Date(Date.now() - i * 60000).toISOString();
    await client.query(
      `INSERT INTO commerceos.products (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
      [
        `prod_d_${i}`,
        TENANT_A,
        JSON.stringify({
          id: `prod_d_${i}`,
          tenant_id: TENANT_A,
          title: `Product ${i}`,
          status: "ACTIVE",
          price: 500 + i * 20,
          created_at: createdAt,
        }),
        createdAt,
      ]
    );
  }

  // Also seed 1 order and 1 customer for Tenant B
  const tbTime = new Date().toISOString();
  await client.query(
    `INSERT INTO commerceos.orders (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
    [
      "ord_tb_1",
      TENANT_B,
      JSON.stringify({ id: "ord_tb_1", tenant_id: TENANT_B, order_number: "ORD-TB-1", status: "CONFIRMED", grand_total: 999, created_at: tbTime }),
      tbTime,
    ]
  );
  await client.query(
    `INSERT INTO commerceos.customers (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
    [
      "cust_tb_1",
      TENANT_B,
      JSON.stringify({ id: "cust_tb_1", tenant_id: TENANT_B, first_name: "TenantB", last_name: "Customer", phone: "01800000001", created_at: tbTime }),
      tbTime,
    ]
  );

  console.log("--- 1. Zero-Hydration Startup Invariants ---");

  // Initialize store in Zero-Hydration mode (zeroHydration: true)
  const store = new CommerceDatabase({
    backend: "pg",
    client,
    persist: true,
    zeroHydration: true,
  });
  await store.ready();

  // Wire singleton db to use this client
  (db as any).pg = { client };
  // The singleton now reads these tables from SQL, as it does with zero-hydration on in production
  (db as any).unhydratedCollections = new Set<string>([...ZERO_HYDRATION_CORE_TABLES, ...UNHYDRATED_DOCUMENT_COLLECTIONS]);

  await runTest("Large business tables are NOT hydrated into RAM at cold boot", () => {
    assert.strictEqual(store.isCollectionHydrated("orders"), false, "orders must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("customers"), false, "customers must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("products"), false, "products must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("inventory_items"), false, "inventory_items must not be hydrated");
    assert.strictEqual(store.isCollectionHydrated("audit_logs"), false, "audit_logs must not be hydrated");

    // Lightweight metadata collections ARE hydrated
    assert.strictEqual(store.isCollectionHydrated("tenants"), true, "tenants must be hydrated");
    assert.ok(store.data.tenants.length >= 2, "tenants collection available in memory");
  });

  console.log("\n--- 2. fromParsed() Safety & Guardrails ---");

  await runTest("Accessing unhydrated collections directly throws CollectionNotHydratedError (no fake empty arrays)", () => {
    assert.throws(() => {
      // Direct raw access to store.data.orders
      const _ = store.data.orders;
    }, CollectionNotHydratedError);

    assert.throws(() => {
      const _ = store.data.customers;
    }, CollectionNotHydratedError);

    assert.throws(() => {
      const _ = store.data.products;
    }, CollectionNotHydratedError);
  });

  console.log("\n--- 3. Semantic Repository-Native Mutations ---");

  await runTest("orderRepository.update executes direct SQL mutation with version bump", async () => {
    const updated = await orderRepository.update(TENANT_A, "ord_d_0", {
      notes: "Updated directly via order repository",
    });

    assert.ok(updated, "Update succeeded");
    assert.strictEqual(updated.notes, "Updated directly via order repository");

    // Verify row in PostgreSQL
    const res = await client.query<{ data: any; version: string }>(
      `SELECT data, version::text AS version FROM commerceos.orders WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, "ord_d_0"]
    );
    assert.strictEqual(res.rowCount, 1);
    assert.strictEqual(res.rows[0].version, "2", "Version incremented to 2");
    const parsedData = typeof res.rows[0].data === "string" ? JSON.parse(res.rows[0].data) : res.rows[0].data;
    assert.strictEqual(parsedData.notes, "Updated directly via order repository");
  });

  await runTest("customerRepository.update executes direct SQL mutation with version bump", async () => {
    const updated = await customerRepository.update(TENANT_A, "cust_d_0", {
      notes: "VIP Gold customer",
    });

    assert.ok(updated);
    assert.strictEqual(updated.notes, "VIP Gold customer");

    const res = await client.query<{ data: any; version: string }>(
      `SELECT data, version::text AS version FROM commerceos.customers WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, "cust_d_0"]
    );
    assert.strictEqual(res.rows[0].version, "2", "Customer version incremented");
    const parsed = typeof res.rows[0].data === "string" ? JSON.parse(res.rows[0].data) : res.rows[0].data;
    assert.strictEqual(parsed.notes, "VIP Gold customer");
  });

  await runTest("productRepository.update & archive execute direct SQL mutations", async () => {
    const updated = await productRepository.update(TENANT_A, "prod_d_0", {
      title: "Updated Product Title",
    });
    assert.ok(updated);
    assert.strictEqual(updated.title, "Updated Product Title");

    const archived = await productRepository.archive(TENANT_A, "prod_d_0");
    assert.strictEqual(archived, true);

    const res = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.products WHERE tenant_id = $1 AND id = $2`,
      [TENANT_A, "prod_d_0"]
    );
    const parsed = typeof res.rows[0].data === "string" ? JSON.parse(res.rows[0].data) : res.rows[0].data;
    assert.strictEqual(parsed.status, "ARCHIVED");
    assert.strictEqual(parsed.title, "Updated Product Title");
  });

  console.log("\n--- 4. Optimistic Concurrency Control (OCC) ---");

  await runTest("Concurrent writers on orders: first writer wins, second detects conflict", async () => {
    // Current version of ord_d_1 is 1
    const w1 = await orderRepository.update(
      TENANT_A,
      "ord_d_1",
      { notes: "Writer 1 change" },
      { expectedVersion: 1 }
    );
    assert.ok(w1, "Writer 1 succeeded");

    // Writer 2 attempts update with old version 1 -> throws StoreConflictError
    await assert.rejects(async () => {
      await orderRepository.update(
        TENANT_A,
        "ord_d_1",
        { notes: "Writer 2 stale change" },
        { expectedVersion: 1 }
      );
    }, StoreConflictError);
  });

  await runTest("Concurrent writers on products: first writer wins, second detects conflict", async () => {
    // Current version of prod_d_1 is 1
    const w1 = await productRepository.update(
      TENANT_A,
      "prod_d_1",
      { title: "Product 1 Writer A" },
      { expectedVersion: 1 }
    );
    assert.ok(w1);

    await assert.rejects(async () => {
      await productRepository.update(
        TENANT_A,
        "prod_d_1",
        { title: "Product 1 Writer B" },
        { expectedVersion: 1 }
      );
    }, StoreConflictError);
  });

  console.log("\n--- 5. Bounded Cursor Streaming ---");

  await runTest("orderRepository.iterateByCursor streams all 250 orders in bounded batches", async () => {
    let batchCount = 0;
    let totalStreamed = 0;

    for await (const batch of orderRepository.iterateByCursor(TENANT_A, { batchSize: 50 })) {
      batchCount++;
      assert.ok(batch.length <= 50, "Batch size must be <= 50");
      totalStreamed += batch.length;
    }

    assert.strictEqual(totalStreamed, 250, "All 250 orders streamed");
    assert.strictEqual(batchCount, 5, "Streamed in 5 distinct batches (250 / 50)");
  });

  await runTest("customerRepository.iterateByCursor streams all 150 customers in bounded batches", async () => {
    let batchCount = 0;
    let totalStreamed = 0;

    for await (const batch of customerRepository.iterateByCursor(TENANT_A, { batchSize: 50 })) {
      batchCount++;
      assert.ok(batch.length <= 50);
      totalStreamed += batch.length;
    }

    assert.strictEqual(totalStreamed, 150, "All 150 customers streamed");
    assert.strictEqual(batchCount, 3, "Streamed in 3 distinct batches (150 / 50)");
  });

  console.log("\n--- 6. Write-Diff Decoupling Invariants ---");

  await runTest("computeChanges does not diff unhydrated business collections", () => {
    const pg = new PgStorePersistence(client);
    // When unhydrated collections are registered, computeChanges skips them
    (pg as any).unhydratedCollections = store.getUnhydratedCollections();

    const changes = pg.computeChanges(store.data as any);
    const diffedCollections = changes.collections.map((c) => c.collection);

    assert.ok(!diffedCollections.includes("orders"), "orders collection not in diff");
    assert.ok(!diffedCollections.includes("customers"), "customers collection not in diff");
    assert.ok(!diffedCollections.includes("products"), "products collection not in diff");
    assert.ok(!diffedCollections.includes("inventory_items"), "inventory_items collection not in diff");
  });

  console.log("\n--- 7. Strict Multi-Tenant Isolation ---");

  await runTest("Tenant A mutations cannot modify Tenant B records", async () => {
    const updated = await orderRepository.update(TENANT_A, "ord_tb_1", {
      notes: "Cross tenant attack on order",
    });
    assert.strictEqual(updated, null, "Cross-tenant order update returns null");

    const custUpdated = await customerRepository.update(TENANT_A, "cust_tb_1", {
      notes: "Cross tenant attack on customer",
    });
    assert.strictEqual(custUpdated, null, "Cross-tenant customer update returns null");

    // Verify Tenant B order is untouched
    const tbRes = await client.query<{ data: any }>(
      `SELECT data FROM commerceos.orders WHERE id = 'ord_tb_1'`
    );
    const tbData = typeof tbRes.rows[0].data === "string" ? JSON.parse(tbRes.rows[0].data) : tbRes.rows[0].data;
    assert.strictEqual(tbData.notes, undefined, "Tenant B order untouched");
  });

  console.log(`\n================================================================`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`================================================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
