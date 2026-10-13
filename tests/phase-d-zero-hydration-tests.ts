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
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { ZERO_HYDRATION_CORE_TABLES, UNHYDRATED_DOCUMENT_COLLECTIONS } from "@/infrastructure/store/pg-store";
import { coreTableFor, qualified } from "@/infrastructure/store/store-schema";
import { AuthService } from "@/domains/auth/service";
import { userRepository } from "@/domains/auth/user.repository";
import { hashPassword, PLATFORM_AUTH_COOKIE_NAME, signSessionToken } from "@/lib/security";
import { loadTenantRows, readTenantRows } from "@/infrastructure/db/tenant-rows";
import { resetRateLimitsForTesting } from "@/lib/rate-limit";
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

  await runTest("an audit log written while audit_logs is unhydrated is inserted with the request (sign-in regression)", async () => {
    const audit = (id: string) => ({
      id,
      tenant_id: TENANT_A,
      actor_user_id: "usr_phase_d",
      action: "USER_LOGIN",
      resource_type: "session",
      resource_id: "usr_phase_d",
      metadata: {},
      created_at: new Date().toISOString(),
    });
    const stored = async (id: string) =>
      (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM commerceos.audit_logs WHERE id = $1`, [id])).rows[0].n;

    // A successful request: the audit row is committed with it (it used to throw CollectionNotHydratedError → 500)
    await store.unit(async () => store.createAuditLog(audit("aud_phase_d_ok")), () => true);
    assert.strictEqual(await stored("aud_phase_d_ok"), "1", "the audit log reached Postgres");

    // A failed request saves nothing...
    await store.unit(async () => store.createAuditLog(audit("aud_phase_d_failed")), () => false);
    assert.strictEqual(await stored("aud_phase_d_failed"), "0", "a failed request's audit log is dropped");

    // ...except a row it marks to keep (a denied attempt's audit)
    await store.unit(async () => {
      store.createAuditLog(audit("aud_phase_d_kept"));
      store.keepEvenIfRequestFails("audit_logs", "aud_phase_d_kept");
    }, () => false);
    assert.strictEqual(await stored("aud_phase_d_kept"), "1", "a kept audit log is saved even though the request failed");
    assert.throws(() => store.data.audit_logs, CollectionNotHydratedError, "audit_logs stays out of memory");
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

  console.log("\n--- 8. Store writes to unhydrated rows commit with the request ---");
  await queuedWriteTests(store, client);

  console.log("\n--- 9. Sign-in and the pages after it, on a zero-hydrated store ---");
  await zeroHydratedRouteTests(client);

  console.log(`\n================================================================`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`================================================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

const parse = <T,>(raw: unknown): T => (typeof raw === "string" ? JSON.parse(raw) : raw) as T;

async function storedRow(client: SqlClient, table: string, tenantId: string, id: string): Promise<{ data: any; version: number } | null> {
  const res = await client.query<{ data: unknown; version: string }>(
    `SELECT data, version::text AS version FROM commerceos.${table} WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return res.rows[0] ? { data: parse(res.rows[0].data), version: Number(res.rows[0].version) } : null;
}

/**
 * The store's synchronous methods change rows of collections left out of memory through the request's working set
 * (tenant-rows.ts); the change is written with the unit's commit, checked against the version the row was loaded with.
 */
async function queuedWriteTests(store: CommerceDatabase, client: SqlClient) {
  /** Loads rows the way loadTenantRowsWhere does, into `store`'s current scope. */
  const load = async (collection: string, tenantId: string, ids: string[]) => {
    const res = await client.query<{ data: unknown; version: string }>(
      `SELECT data, version::text AS version FROM commerceos.${collection} WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      [tenantId, ids]
    );
    store.putTenantReadRows(collection, tenantId, res.rows.map((r) => ({ row: parse(r.data), version: Number(r.version) })), false);
  };
  const loadOrder = async (id: string) => {
    await load("orders", TENANT_A, [id]);
    await load("order_items", TENANT_A, []);
    await load("customers", TENANT_A, []);
    await load("customer_addresses", TENANT_A, []);
  };

  await runTest("an order status change through the store is saved with the request, as a version-checked update", async () => {
    const before = await storedRow(client, "orders", TENANT_A, "ord_d_5");
    await store.withTenantReads(() =>
      store.unit(async () => {
        await loadOrder("ord_d_5");
        const updated = store.updateOrderStatus(TENANT_A, "ord_d_5", "PROCESSING");
        assert.strictEqual(updated?.status, "PROCESSING", "the request reads its own change back");
        return true;
      }, () => true)
    );
    const after = await storedRow(client, "orders", TENANT_A, "ord_d_5");
    assert.strictEqual(after?.data.status, "PROCESSING");
    assert.strictEqual(after?.version, (before?.version ?? 0) + 1, "one update, one version");
    assert.throws(() => store.data.orders, CollectionNotHydratedError, "orders stays out of memory");
  });

  await runTest("a row changed elsewhere after it was loaded is a 409 conflict, and nothing is saved", async () => {
    await assert.rejects(
      store.withTenantReads(() =>
        store.unit(async () => {
          await loadOrder("ord_d_6");
          // Another server changes the row meanwhile
          await client.query(`UPDATE commerceos.orders SET version = version + 1 WHERE tenant_id = $1 AND id = $2`, [TENANT_A, "ord_d_6"]);
          store.updateOrderStatus(TENANT_A, "ord_d_6", "CANCELLED");
          return true;
        }, () => true)
      ),
      (err: unknown) => (err as { statusCode?: number; code?: string }).statusCode === 409
    );
    assert.strictEqual((await storedRow(client, "orders", TENANT_A, "ord_d_6"))?.data.status, "CONFIRMED", "the stale change was refused");
  });

  await runTest("new customer rows are inserted with a successful request and dropped with a failed one", async () => {
    const customer = (id: string) => ({
      id, tenant_id: TENANT_A, first_name: "Queued", last_name: id, phone: `+88017${id.slice(-8).padStart(8, "0")}`,
      status: "ACTIVE", source: "MANUAL", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }) as unknown as Customer;
    await store.withTenantReads(() => store.unit(async () => store.createCustomer(customer("cust_q_00000001")), () => true));
    assert.ok(await storedRow(client, "customers", TENANT_A, "cust_q_00000001"), "inserted with the request");
    await store.withTenantReads(() => store.unit(async () => store.createCustomer(customer("cust_q_00000002")), () => false));
    assert.strictEqual(await storedRow(client, "customers", TENANT_A, "cust_q_00000002"), null, "a failed request inserts nothing");
  });

  await runTest("the reservation sweep releases a lapsed hold of a pending order from Postgres", async () => {
    const at = new Date().toISOString();
    const insert = (table: string, row: Record<string, unknown>) =>
      client.query(`INSERT INTO commerceos.${table} (id, tenant_id, created_at, data, version) VALUES ($1, $2, now(), $3::jsonb, 1)`, [row.id, TENANT_A, JSON.stringify(row)]);
    await insert("warehouses", { id: "wh_sweep", tenant_id: TENANT_A, name: "Sweep", code: "SW", status: "ACTIVE", created_at: at, updated_at: at });
    await insert("products", { id: "prod_sweep", tenant_id: TENANT_A, name: "Sweep", sku: "SWEEP-P", slug: "sweep", status: "ACTIVE", created_at: at, updated_at: at });
    await insert("product_variants", { id: "var_sweep", tenant_id: TENANT_A, product_id: "prod_sweep", sku: "SWEEP-V", title: "Default", price: 10, created_at: at, updated_at: at });
    await insert("inventory_items", { id: "inv_sweep", tenant_id: TENANT_A, warehouse_id: "wh_sweep", product_variant_id: "var_sweep", quantity_on_hand: 5, quantity_reserved: 2, quantity_available: 3, reorder_point: 1, updated_at: at });
    await insert("orders", { id: "ord_sweep", tenant_id: TENANT_A, order_number: "ORD-SWEEP-1", status: "PENDING", grand_total: 20, created_at: at });
    await insert("inventory_reservations", { id: "res_sweep", tenant_id: TENANT_A, order_id: "ord_sweep", product_variant_id: "var_sweep", warehouse_id: "wh_sweep", quantity: 2, status: "ACTIVE", expires_at: new Date(Date.now() - 60_000).toISOString(), created_at: at });

    const released = await store.withTenantReads(() =>
      store.unit(async () => {
        await (store as any).loadLapsedHolds(Date.now());
        return store.releaseExpiredReservations();
      }, () => true)
    );
    assert.strictEqual(released, 1);
    assert.strictEqual((await storedRow(client, "inventory_reservations", TENANT_A, "res_sweep"))?.data.status, "EXPIRED");
    const stock = await storedRow(client, "inventory_items", TENANT_A, "inv_sweep");
    assert.strictEqual(stock?.data.quantity_reserved, 0);
    assert.strictEqual(stock?.data.quantity_available, 5);
  });

  await runTest("one scope, two units saving the same row: the second is checked against the version the first wrote", async () => {
    await store.withTenantReads(async () => {
      await store.unit(async () => (await loadOrder("ord_d_7"), store.updateOrderStatus(TENANT_A, "ord_d_7", "PROCESSING"), true), () => true);
      await store.unit(async () => (store.updateOrderStatus(TENANT_A, "ord_d_7", "READY_TO_SHIP"), true), () => true);
    });
    const row = await storedRow(client, "orders", TENANT_A, "ord_d_7");
    assert.strictEqual(row?.data.status, "READY_TO_SHIP");
    assert.strictEqual(row?.version, 3);
  });

  await runTest("one scope, a failed unit then a successful one: the undone change is never saved later", async () => {
    await store.withTenantReads(async () => {
      await store.unit(async () => (await loadOrder("ord_d_8"), store.updateOrderStatus(TENANT_A, "ord_d_8", "CANCELLED"), false), (ok) => ok);
      // The failed unit's row left the scope: a later save loads it again from Postgres
      await store.unit(async () => {
        await loadOrder("ord_d_8");
        assert.strictEqual(store.findOrderById(TENANT_A, "ord_d_8")?.status, "CONFIRMED", "not the undone CANCELLED");
        store.updateOrderPaymentStatus(TENANT_A, "ord_d_8", "PAID");
        return true;
      }, () => true);
    });
    const row = await storedRow(client, "orders", TENANT_A, "ord_d_8");
    assert.strictEqual(row?.data.status, "CONFIRMED");
    assert.strictEqual(row?.data.payment_status, "PAID");
  });

  await runTest("platform-scope reads are refused for tenant collections", async () => {
    await store.withTenantReads(async () => {
      await assert.rejects(readTenantRows("orders", ""));
      await assert.rejects(loadTenantRows("", ["orders"]));
    });
  });

  await runTest("a change to a row the request never loaded is refused at commit, never a blind overwrite", async () => {
    await assert.rejects(
      store.withTenantReads(() =>
        store.unit(async () => {
          // A stale in-memory copy saved without loading: treated as new, and Postgres already has the id
          store.createCustomer({ ...(await storedRow(client, "customers", TENANT_A, "cust_d_3"))!.data, first_name: "Overwrite" });
          return true;
        }, () => true)
      ),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 409
    );
    assert.strictEqual((await storedRow(client, "customers", TENANT_A, "cust_d_3"))?.data.first_name, "Customer");
  });
}

const API_ROOT = path.resolve(__dirname, "../src/app/api/v1");
const BASE = "http://localhost:3000/api/v1";
type Handler = (r: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

function routesWith(method: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${method}\\b`);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts" && pattern.test(fs.readFileSync(full, "utf-8"))) {
        found.push(path.relative(API_ROOT, dir).split(path.sep).join("/"));
      }
    }
  };
  walk(API_ROOT);
  return found.sort();
}

async function call(
  method: string,
  route: string,
  url: string,
  headers: Record<string, string>,
  params: Record<string, string> = {},
  body?: unknown
): Promise<{ status: number; json: any }> {
  const mod = (await import(`@/app/api/v1/${route}/route`)) as Record<string, Handler>;
  const init: Record<string, unknown> = { method, headers: { ...headers, "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await mod[method](new NextRequest(`${BASE}/${url}`, init as never), { params: Promise.resolve(params) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/**
 * The process-wide store as production runs it (DATA_BACKEND=pg, NODE_ENV=production): the business collections are
 * only in Postgres, and reading `db.data.<collection>` throws. Before this, sign-in was the only thing fixed: the
 * dashboard, orders, products and customers pages (and most write paths) answered 500 COLLECTION_NOT_HYDRATED.
 */
async function zeroHydratedRouteTests(client: SqlClient) {
  resetRateLimitsForTesting();
  // Hydrated while the shops are set up (sections 1-7 only marked the collections as unhydrated)
  (db as any).unhydratedCollections = new Set<string>();
  const password = "Phase-D-Owner-Pass-6621!";
  const shop = await AuthService.registerTenantWithOwner({
    email: `owner_${crypto.randomUUID().slice(0, 8)}@phase-d.test`, password, name: "Phase D Owner", workspaceName: "Phase D Shop",
  });
  const T = shop.tenant.id;
  const other = await AuthService.registerTenantWithOwner({
    email: `other_${crypto.randomUUID().slice(0, 8)}@phase-d.test`, password, name: "Other Owner", workspaceName: "Other Shop",
  });
  const O = other.tenant.id;

  // The shop's catalog, customers and orders, as the store holds them (in memory for now)
  const iso = new Date().toISOString();
  const d = db.data as any;
  d.warehouses.push({ id: "wh_zh", tenant_id: T, name: "Zero Hydration", code: "ZH", address: "", city: "Dhaka", district: "Dhaka", status: "ACTIVE", created_at: iso, updated_at: iso });
  for (let v = 0; v < 3; v++) {
    d.products.push({ id: `prod_zh_${v}`, tenant_id: T, name: `ZH Product ${v}`, slug: `zh-${v}`, description: "", sku: `ZH-P${v}`, base_price: 1500, cost_price: 800, currency: "BDT", status: "ACTIVE", images: [], created_at: iso, updated_at: iso });
    d.product_variants.push({ id: `var_zh_${v}`, tenant_id: T, product_id: `prod_zh_${v}`, sku: `ZH-V${v}`, title: "Default", price: 1500, cost_price: 800, attributes: {}, status: "ACTIVE", created_at: iso, updated_at: iso });
    d.inventory_items.push({ id: `inv_zh_${v}`, tenant_id: T, warehouse_id: "wh_zh", product_variant_id: `var_zh_${v}`, quantity_on_hand: v === 2 ? 500 : 1, quantity_reserved: 0, quantity_available: v === 2 ? 500 : 1, reorder_point: 10, created_at: iso, updated_at: iso });
  }
  for (let i = 0; i < 12; i++) {
    const at = new Date(Date.now() - (i % 6) * 86_400_000).toISOString();
    d.customers.push({ id: `cus_zh_${i}`, tenant_id: T, first_name: `Zh${i}`, last_name: "Buyer", phone: `+8801911000${String(i).padStart(3, "0")}`, status: "ACTIVE", source: "WEBSITE", created_at: at, updated_at: at });
    d.customer_addresses.push({ id: `addr_zh_${i}`, tenant_id: T, customer_id: `cus_zh_${i}`, type: "SHIPPING", is_default: true, country: "Bangladesh", division: "Dhaka", district: "Dhaka", address_line_1: "Road 1", created_at: at });
    d.orders.push({
      id: `ord_zh_${i}`, tenant_id: T, order_number: `ORD-2026-${String(i + 1).padStart(6, "0")}`, customer_id: `cus_zh_${i % 6}`,
      status: i % 5 === 0 ? "CANCELLED" : i % 2 ? "CONFIRMED" : "DELIVERED", currency: "BDT", subtotal: 1500, discount_total: 0, shipping_total: 60,
      tax_total: 0, grand_total: 1560, payment_method: "COD", payment_status: i % 2 ? "PENDING" : "PAID", fulfillment_status: "UNFULFILLED",
      shipping_address_snapshot: { district: "Dhaka", division: "Dhaka", address_line_1: "Road 1" }, source: "WEBSITE", created_at: at, updated_at: at,
    });
    d.order_items.push({ id: `oi_zh_${i}`, tenant_id: T, order_id: `ord_zh_${i}`, product_id: `prod_zh_${i % 2}`, variant_id: `var_zh_${i % 2}`, product_name_snapshot: `ZH Product ${i % 2}`, sku_snapshot: `ZH-V${i % 2}`, quantity: 1, unit_price: 1500, line_total: 1500, created_at: at });
  }
  d.orders.push({ id: "ord_zh_other", tenant_id: O, order_number: "ORD-2026-000001", customer_id: "", status: "PENDING", currency: "BDT", subtotal: 10, discount_total: 0, shipping_total: 0, tax_total: 0, grand_total: 10, payment_method: "COD", payment_status: "PENDING", fulfillment_status: "UNFULFILLED", source: "MANUAL", created_at: iso, updated_at: iso });

  // Into Postgres; then the business collections leave memory, as at a production cold boot
  const unhydrated = new Set<string>([...ZERO_HYDRATION_CORE_TABLES, ...UNHYDRATED_DOCUMENT_COLLECTIONS]);
  for (const collection of ["warehouses", "products", "product_variants", "inventory_items", "customers", "customer_addresses", "orders", "order_items"]) {
    for (const row of (d[collection] as Array<Record<string, unknown>>).filter((r) => r.tenant_id === T || r.tenant_id === O)) {
      await client.query(
        `INSERT INTO ${qualified(coreTableFor(collection)!.table)} (id, tenant_id, created_at, data, version) VALUES ($1, $2, $3::timestamptz, $4::jsonb, 1)`,
        [row.id, row.tenant_id, row.created_at ?? null, JSON.stringify(row)]
      );
    }
  }
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(db.data as unknown as Record<string, unknown>)) if (!unhydrated.has(key)) kept[key] = value;
  (db as any)._data = CommerceDatabase.fromParsed(kept as never, unhydrated);
  (db as any).unhydratedCollections = unhydrated;
  (db as any).pg = { client };

  await runTest("the business collections are only in Postgres (reading them from memory throws)", () => {
    for (const c of ["orders", "products", "customers", "inventory_items", "warehouses", "audit_logs"]) {
      assert.throws(() => (db.data as any)[c], CollectionNotHydratedError, c);
    }
  });

  const signIn = await call("POST", "auth/login", "auth/login", {}, {}, { email: shop.user.email, password, tenantId: T });
  await runTest("sign-in works", () => assert.strictEqual(signIn.status, 200, JSON.stringify(signIn.json)));
  const token = (await AuthService.login(shop.user.email, password, T)).token;
  const auth = { authorization: `Bearer ${token}` };

  await runTest("a new workspace can sign up (its default warehouse goes to Postgres) and see its empty dashboard", async () => {
    const reg = await call("POST", "auth/register", "auth/register", {}, {}, {
      name: "New Owner", workspaceName: "Brand New Shop", email: `new_${crypto.randomUUID().slice(0, 8)}@phase-d.test`, password,
    });
    assert.strictEqual(reg.status, 201, JSON.stringify(reg.json));
    const newToken = (await AuthService.login(reg.json.data.user.email, password, reg.json.data.tenant.id)).token;
    const dash = await call("GET", "reports/dashboard", "reports/dashboard", { authorization: `Bearer ${newToken}` });
    assert.strictEqual(dash.status, 200, JSON.stringify(dash.json));
    assert.strictEqual(dash.json.data.metrics.totalOrders, 0);
  });

  await runTest("dashboard home: the shop's numbers, computed from its rows in Postgres", async () => {
    const r = await call("GET", "reports/dashboard", "reports/dashboard", auth);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const m = r.json.data.metrics;
    assert.strictEqual(m.totalOrders, 12, "the other workspace's order isn't counted");
    assert.strictEqual(m.totalProducts, 3);
    assert.strictEqual(m.activeCustomers, 12);
    assert.strictEqual(m.warehousesCount, 2, "the sign-up warehouse and wh_zh");
    assert.strictEqual(m.recentOrders.length, 5);
  });

  await runTest("orders page: one page from SQL with customer names; filters and search; detail with items", async () => {
    const list = await call("GET", "orders", "orders", auth);
    assert.strictEqual(list.status, 200, JSON.stringify(list.json));
    assert.strictEqual(list.json.meta?.total ?? list.json.data.length, 12);
    assert.ok(list.json.data.every((o: Order) => o.tenant_id === T), "only this workspace's orders");
    assert.ok(list.json.data.some((o: any) => o.customer_name === "Zh1 Buyer"));
    const confirmed = await call("GET", "orders", "orders?status=CONFIRMED", auth);
    assert.ok(confirmed.json.data.length > 0 && confirmed.json.data.every((o: Order) => o.status === "CONFIRMED"));
    const byName = await call("GET", "orders", "orders?search=zh3", auth);
    assert.ok(byName.json.data.length > 0 && byName.json.data.every((o: Order) => o.customer_id === "cus_zh_3"), "search matches the customer name");
    const detail = await call("GET", "orders/[id]", "orders/ord_zh_1", auth, { id: "ord_zh_1" });
    assert.strictEqual(detail.status, 200, JSON.stringify(detail.json));
    assert.strictEqual(detail.json.data.order.items.length, 1);
    assert.strictEqual(detail.json.data.order.customer_name, "Zh1 Buyer");
    assert.strictEqual(detail.json.data.order.delivery_address.district, "Dhaka");
    const foreign = await call("GET", "orders/[id]", "orders/ord_zh_other", auth, { id: "ord_zh_other" });
    assert.strictEqual(foreign.status, 404, "another workspace's order is not found");
  });

  await runTest("products and customers pages: one page from SQL, with variants and addresses", async () => {
    const products = await call("GET", "products", "products", auth);
    assert.strictEqual(products.status, 200, JSON.stringify(products.json));
    assert.strictEqual(products.json.data.length, 3);
    assert.ok(products.json.data.every((p: Product) => (p.variants ?? []).length === 1));
    const searched = await call("GET", "products", "products?search=zh-p1", auth);
    assert.deepStrictEqual(searched.json.data.map((p: Product) => p.id), ["prod_zh_1"]);
    const product = await call("GET", "products/[id]", "products/prod_zh_2", auth, { id: "prod_zh_2" });
    assert.strictEqual(product.status, 200);
    const customers = await call("GET", "customers", "customers", auth);
    assert.strictEqual(customers.status, 200, JSON.stringify(customers.json));
    assert.strictEqual(customers.json.data.length, 12);
    assert.ok(customers.json.data.every((c: Customer) => (c.addresses ?? []).length === 1));
    const customer = await call("GET", "customers/[id]", "customers/cus_zh_1", auth, { id: "cus_zh_1" });
    assert.strictEqual(customer.status, 200, JSON.stringify(customer.json));
    assert.deepStrictEqual(customer.json.data.orders.map((o: Order) => o.id).sort(), ["ord_zh_1", "ord_zh_7"]);
    const inventory = await call("GET", "inventory", "inventory", auth);
    assert.strictEqual(inventory.status, 200, JSON.stringify(inventory.json));
    assert.ok(inventory.json.data.inventory.every((i: any) => i.product_name.startsWith("ZH Product")), "stock joined to the catalog");
  });

  // An organization, so enterprise GETs get past organization resolution
  await call("POST", "enterprise/organizations", "enterprise/organizations", auth, {}, { name: "Phase D Group" });

  await runTest("no tenant GET route answers COLLECTION_NOT_HYDRATED, and none queues a write", async () => {
    const REAL: Record<string, string> = { orders: "ord_zh_1", evaluate: "ord_zh_1", customers: "cus_zh_1", lifecycle: "cus_zh_1", products: "prod_zh_1" };
    const failures: string[] = [];
    let saves = 0;
    const rowSaved = (db as any).rowSaved;
    (db as any).rowSaved = function (...args: unknown[]) {
      saves++;
      return rowSaved.apply(this, args);
    };
    try {
      for (const route of routesWith("GET").filter((r) => !r.startsWith("platform"))) {
        for (const real of route.includes("[") ? [false, true] : [false]) {
          const params: Record<string, string> = {};
          const segments = route.split("/");
          const url = segments
            .map((seg, i) => seg.replace(/^\[(\.\.\.)?([^\]]+)\]$/, (_m, _r, name: string) => (params[name] = (real && REAL[segments[i - 1]]) || `missing_${name}`)))
            .join("/");
          if (real && Object.values(params).every((v) => v.startsWith("missing_"))) continue;
          const before = saves;
          const r = await call("GET", route, url, auth, params).catch((err: Error) => ({ status: 0, json: err.message }));
          if (JSON.stringify(r.json ?? "").includes("COLLECTION_NOT_HYDRATED")) failures.push(`GET ${url}`);
          if (saves !== before) failures.push(`GET ${url} queued a write`);
        }
      }
    } finally {
      (db as any).rowSaved = rowSaved;
    }
    assert.deepStrictEqual(failures, []);
  });

  await runTest("a caller without the route's permission causes no whole-tenant read (403 first)", async () => {
    const salesId = `usr_pd_sales_${crypto.randomUUID().slice(0, 8)}`;
    db.createUser({ id: salesId, email: `${salesId}@phase-d.test`, name: "PD Sales", password_hash: "!disabled", status: "ACTIVE", created_at: iso, updated_at: iso });
    db.createMembership({ id: `mem_${salesId}`, tenant_id: T, user_id: salesId, role: "SALES", created_at: iso, updated_at: iso });
    const salesToken = await signSessionToken({ userId: salesId, tenantId: T, role: "SALES", email: `${salesId}@phase-d.test`, name: "PD Sales" });
    const sql = (db as any).pg.client;
    const query = sql.query;
    const reads: string[] = [];
    sql.query = (text: string, params?: unknown[]) => (reads.push(text), query.call(sql, text, params));
    try {
      const r = await call("POST", "intelligence/recompute", "intelligence/recompute", { authorization: `Bearer ${salesToken}` });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    } finally {
      sql.query = query;
    }
    assert.deepStrictEqual(reads.filter((q) => /FROM commerceos\.(orders|order_items|customers|products|inventory_items|stock_movements)/.test(q)), []);
  });

  await runTest("list pages clamp limit and offset (never the whole table, never a 500)", async () => {
    for (const q of ["limit=-1", "limit=abc", "limit=100000&offset=-5"]) {
      const r = await call("GET", "orders", `orders?${q}`, auth);
      assert.strictEqual(r.status, 200, `${q}: ${JSON.stringify(r.json).slice(0, 200)}`);
      assert.ok(r.json.data.length <= 500 && r.json.data.length > 0, q);
    }
    const words = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(" ");
    const r = await call("GET", "products", `products?search=${encodeURIComponent(words)}`, auth);
    assert.strictEqual(r.status, 200);
  });

  await runTest("the core writes work: customers, products, stock, orders, status changes", async () => {
    const results: Record<string, { status: number; json: any }> = {
      createCustomer: await call("POST", "customers", "customers", auth, {}, { first_name: "Walk", last_name: "In", phone: "01712345678" }),
      updateCustomer: await call("PATCH", "customers/[id]", "customers/cus_zh_2", auth, { id: "cus_zh_2" }, { first_name: "Renamed" }),
      createProduct: await call("POST", "products", "products", auth, {}, { name: "ZH New", sku: "ZH-NEW-1", base_price: 900, cost_price: 400, initial_stock: 4 }),
      updateProduct: await call("PATCH", "products/[id]", "products/prod_zh_0", auth, { id: "prod_zh_0" }, { name: "Renamed Product" }),
      adjustStock: await call("POST", "inventory/adjust", "inventory/adjust", auth, {}, { warehouse_id: "wh_zh", product_variant_id: "var_zh_0", quantity_delta: 5, type: "ADJUSTMENT", reason: "recount" }),
      createOrder: await call("POST", "orders", "orders", auth, {}, {
        customer: { first_name: "New", last_name: "Buyer", phone: "01812345678" }, delivery_address: { district: "Dhaka", address_line_1: "House 1" },
        items: [{ variant_id: "var_zh_2", quantity: 1 }], payment_method: "COD", warehouse_id: "wh_zh",
      }),
      transition: await call("POST", "orders/[id]/transition", "orders/ord_zh_1/transition", auth, { id: "ord_zh_1" }, { status: "PROCESSING", reason: "packing" }),
      archiveProduct: await call("DELETE", "products/[id]", "products/prod_zh_1", auth, { id: "prod_zh_1" }),
    };
    const failed = Object.entries(results).filter(([, r]) => r.status >= 400).map(([name, r]) => `${name}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    assert.deepStrictEqual(failed, []);
    assert.strictEqual(results.updateCustomer.json.data.customer.first_name, "Renamed");
    assert.strictEqual(results.adjustStock.json.data.item.quantity_on_hand, 6);
    assert.strictEqual(results.createOrder.json.data.order.order_number, `ORD-${new Date().getFullYear()}-000013`, "numbering continues past the orders in Postgres");
    assert.strictEqual(results.transition.json.data.order.status, "PROCESSING");
  });

  await runTest("audit logs are read from Postgres", async () => {
    await client.query(
      `INSERT INTO commerceos.audit_logs (id, tenant_id, created_at, data, version) VALUES ($1, $2, now(), $3::jsonb, 1)`,
      ["aud_zh_1", T, JSON.stringify({ id: "aud_zh_1", tenant_id: T, actor_user_id: "u", action: "SECURITY_FAILED_LOGIN", resource_type: "session", resource_id: "x", metadata: {}, created_at: iso })]
    );
    const logs = await userRepository.findAuditLogs(T, 10);
    assert.ok(logs.some((l) => l.id === "aud_zh_1"));
    assert.ok(logs.every((l) => l.tenant_id === T));
  });

  // The control plane, as a signed-in operator
  const opPassword = "Phase-D-Operator-Pass-3317!";
  const opId = `usr_pd_op_${crypto.randomUUID().slice(0, 8)}`;
  db.createUser({ id: opId, email: `${opId}@operators.test`, name: "PD Operator", password_hash: await hashPassword(opPassword), status: "ACTIVE", created_at: iso, updated_at: iso });
  db.savePlatformMembership({ id: `pm_${opId}`, user_id: opId, role: "SUPER_ADMIN", mfa_enabled: false, is_active: true, created_at: iso, updated_at: iso });
  const { POST: platformLogin } = (await import("@/app/api/v1/platform/auth/login/route")) as { POST: (r: Request) => Promise<Response> };
  const opLogin = await platformLogin(
    new NextRequest(`${BASE}/platform/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${opId}@operators.test`, password: opPassword }) })
  );
  const opCookie = opLogin.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${PLATFORM_AUTH_COOKIE_NAME}=`)) ?? "";

  await runTest("no platform GET route answers COLLECTION_NOT_HYDRATED", async () => {
    const failures: string[] = [];
    for (const route of routesWith("GET").filter((r) => r.startsWith("platform"))) {
      const params: Record<string, string> = {};
      const url = route.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_m, _r, name: string) => (params[name] = name.toLowerCase().includes("tenant") ? T : `missing_${name}`));
      const r = await call("GET", route, `${url}?tenant_id=${T}`, { cookie: opCookie }, params).catch((err: Error) => ({ status: 0, json: err.message }));
      if (JSON.stringify(r.json ?? "").includes("COLLECTION_NOT_HYDRATED")) failures.push(`GET ${url}`);
    }
    assert.deepStrictEqual(failures, []);
  });
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
