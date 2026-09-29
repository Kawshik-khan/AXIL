/**
 * Phase 4 Postgres suite (FIX_IMPLEMENTATION_PLAN FX-40…FX-44, ADR-108). Runs against PGlite (real Postgres in WASM):
 * migrations, the Postgres-backed store (load, change detection, one-transaction writes, lease and fencing, refused
 * rows set aside), backfill + verification + export, and the scripts end to end on temporary data.
 * Run: node tests/ts-runner.cjs ./tests/phase4-postgres-tests.ts
 */
import assert from "assert";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { CommerceDatabase, db, type DatabaseSchema, type TenantRecord } from "@/infrastructure/db";
import { backfillStore, verifyStore } from "@/infrastructure/store/backfill";
import { diffStores } from "@/infrastructure/store/canonical";
import { runMigrations } from "@/infrastructure/store/migrations";
import { LEASE_TTL_MS, PgStorePersistence } from "@/infrastructure/store/pg-store";
import { createPgliteClient } from "@/infrastructure/store/pglite-client";
import type { SqlClient } from "@/infrastructure/store/sql-client";
import { envNumber } from "@/lib/env-number";
import type { Order, OrderItem, Product, ProductVariant, Warehouse, InventoryItem } from "@/types/commerce";
import type { PlatformAuditLogRecord } from "@/types/platform";

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

const iso = () => new Date().toISOString();
const ROOT = path.resolve(__dirname, "..");

function tenant(id: string): TenantRecord {
  return { id, name: id, slug: id, currency: "BDT", timezone: "Asia/Dhaka", language: "en", settings: {}, status: "ACTIVE", created_at: iso(), updated_at: iso() };
}

function order(tenantId: string, id: string, orderNumber: string, total = 160): Order {
  return {
    id, tenant_id: tenantId, order_number: orderNumber, customer_id: "cus_p4", status: "PENDING", currency: "BDT", subtotal: total - 60,
    discount_total: 0, shipping_total: 60, tax_total: 0, grand_total: total, payment_method: "COD", payment_status: "PENDING",
    fulfillment_status: "UNFULFILLED", shipping_address_snapshot: { district: "Dhaka" }, source: "WEBSITE", created_at: iso(), updated_at: iso(),
  } as unknown as Order;
}

function item(tenantId: string, id: string, orderId: string, quantity = 1): OrderItem {
  return {
    id, tenant_id: tenantId, order_id: orderId, product_id: "prod_p4", variant_id: "var_p4", product_name_snapshot: "Kurta", sku_snapshot: "P4",
    unit_price: 100, quantity, discount: 0, tax: 0, line_total: 100 * quantity,
  };
}

function catalog(tenantId: string): { product: Product; variant: ProductVariant; warehouse: Warehouse; stock: InventoryItem } {
  const product = { id: `prod_${tenantId}`, tenant_id: tenantId, name: "Kurta", slug: `kurta-${tenantId}`, description: "", sku: `SKU-${tenantId}`,
    base_price: 100, currency: "BDT", status: "ACTIVE", images: [], created_at: iso(), updated_at: iso() } as unknown as Product;
  const variant = { id: `var_${tenantId}`, tenant_id: tenantId, product_id: product.id, sku: `SKU-${tenantId}-M`, title: "M", price: 100,
    attributes: {}, status: "ACTIVE", created_at: iso(), updated_at: iso() } as unknown as ProductVariant;
  const warehouse: Warehouse = { id: `wh_${tenantId}`, tenant_id: tenantId, name: "Main", code: "MAIN", address: "", city: "Dhaka", district: "Dhaka",
    status: "ACTIVE", created_at: iso(), updated_at: iso() };
  const stock: InventoryItem = { id: `inv_${tenantId}`, tenant_id: tenantId, warehouse_id: warehouse.id, product_variant_id: variant.id,
    quantity_on_hand: 25, quantity_reserved: 3, quantity_available: 22, reorder_point: 5, updated_at: iso() };
  return { product, variant, warehouse, stock };
}

async function migratedClient(): Promise<SqlClient> {
  const client = createPgliteClient();
  await runMigrations(client);
  return client;
}

async function openStore(client: SqlClient): Promise<CommerceDatabase> {
  const store = new CommerceDatabase({ backend: "pg", client, persist: true });
  await store.ready();
  return store;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function runScript(script: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["tests/ts-runner.cjs", script, ...args], {
    cwd: ROOT,
    // No real database can be reached from these runs: the local env's DATABASE_URL etc. are blanked.
    env: { ...process.env, NODE_ENV: "development", PERSIST_DEBOUNCE_MS: "50", DATA_BACKEND: "", DATABASE_URL: "", DATABASE_URL_POOLED: "", ...env },
    encoding: "utf-8",
    timeout: 240_000,
  });
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 4: POSTGRES SYSTEM OF RECORD      ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  // ---------------------------------------------------------------------------
  console.log(`${ANSI_BOLD}[FX-41] Migrations${ANSI_RESET}`);
  // ---------------------------------------------------------------------------
  const client = await migratedClient();

  await runTest("migration 006 creates the commerceos schema; the legacy 001-005 files don't run; re-running applies nothing", async () => {
    const tables = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'commerceos'");
    assert.ok(Number(tables.rows[0].n) >= 35, `commerceos tables: ${tables.rows[0].n}`);
    const legacy = await client.query<{ t: string | null }>("SELECT to_regclass('public.tenants')::text AS t");
    assert.strictEqual(legacy.rows[0].t, null, "legacy public tables are not created");
    const again = await runMigrations(client);
    assert.deepStrictEqual(again.applied, []);
    assert.ok(again.alreadyApplied.includes("006_align_domain_model"));
  });

  await runTest("each migration file applies whole (functions with ';' inside) or not at all", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cos-mig-"));
    fs.writeFileSync(
      path.join(dir, "001_fn.sql"),
      "CREATE TABLE p4_probe (x int);\nCREATE FUNCTION p4_add(a int) RETURNS int AS $$\nBEGIN\n  RETURN a + 1;\nEND;\n$$ LANGUAGE plpgsql;\n"
    );
    fs.writeFileSync(path.join(dir, "002_broken.sql"), "CREATE TABLE p4_half (x int);\nSELECT * FROM no_such_table;\n");
    const fresh = createPgliteClient();
    await assert.rejects(runMigrations(fresh, dir));
    const fn = await fresh.query<{ v: number }>("SELECT p4_add(1) AS v");
    assert.strictEqual(fn.rows[0].v, 2);
    const half = await fresh.query<{ t: string | null }>("SELECT to_regclass('public.p4_half')::text AS t");
    assert.strictEqual(half.rows[0].t, null, "a failed file leaves nothing behind");
    const rows = await fresh.query<{ name: string }>("SELECT name FROM _migrations ORDER BY name");
    assert.deepStrictEqual(rows.rows.map((r) => r.name), ["001_fn"]);
    await fresh.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await runTest("the store refuses to start on a database without the schema", async () => {
    const empty = createPgliteClient();
    const store = new CommerceDatabase({ backend: "pg", client: empty, persist: true });
    await assert.rejects(store.ready(), /SCHEMA_MISSING/);
    await empty.close();
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-42/FX-44] The store on Postgres${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("before ready() a Postgres store answers 503 STORE_NOT_READY instead of empty data", () => {
    const store = new CommerceDatabase({ backend: "pg", client, persist: true });
    assert.throws(() => store.data.tenants, (e: Error & { code?: string; statusCode?: number }) => e.code === "STORE_NOT_READY" && e.statusCode === 503);
  });

  const store = await openStore(client);
  const t = "ten_p4_a";
  const { product, variant, warehouse, stock } = catalog(t);

  await runTest("records written through the store reload identically in a new process (tables and documents)", async () => {
    store.createTenant(tenant(t));
    store.data.products.push(product);
    store.data.product_variants.push(variant);
    store.createWarehouse(warehouse);
    store.data.inventory_items.push(stock);
    store.createOrder(order(t, "ord_p4_1", "P4-1001", 260), [item(t, "oi_p4_1", "ord_p4_1", 2)]);
    store.data.order_sequences[t] = 1001;
    store.saveTenantEntitlement({ tenant_id: t, entitlement_id: "max_users", value: 7, is_override: true, updated_at: iso() });
    store.data.growth_insights.push({ id: "gi_p4", tenant_id: t, title: "doc row", created_at: iso() } as never);
    store.appendPlatformAuditLog({ id: "pal_p4_old", action: "OLD", created_at: iso() } as unknown as PlatformAuditLogRecord);
    store.appendPlatformAuditLog({ id: "pal_p4_new", action: "NEW", created_at: iso() } as unknown as PlatformAuditLogRecord);
    store.markDirty();
    await store.flush();
    assert.ok(store.getPersistenceHealth().ok, JSON.stringify(store.getPersistenceHealth()));
    const reloaded = await new PgStorePersistence(client).load();
    assert.deepStrictEqual(diffStores(store.data as unknown as Record<string, unknown>, reloaded), []);
    assert.strictEqual((reloaded.order_sequences as Record<string, number>)[t], 1001);
    const audit = reloaded.platform_audit_logs as Array<{ id: string }>;
    assert.deepStrictEqual(audit.slice(0, 2).map((a) => a.id), ["pal_p4_new", "pal_p4_old"], "newest-first collections keep their order");
    const doc = await client.query<{ tenant_id: string }>("SELECT tenant_id FROM commerceos.documents WHERE collection = 'growth_insights' AND id = 'gi_p4'");
    assert.strictEqual(doc.rows[0]?.tenant_id, t);
    const ent = await client.query<{ id: string }>("SELECT id FROM commerceos.documents WHERE collection = 'tenant_entitlements'");
    assert.ok(ent.rows.some((r) => r.id === `${t}:max_users`), "records without an id are keyed by their natural key");
  });

  await runTest("generated columns carry the record's values (order number, totals, stock)", async () => {
    const o = await client.query<{ order_number: string; grand_total: string; status: string }>(
      "SELECT order_number, grand_total::text AS grand_total, status FROM commerceos.orders WHERE id = 'ord_p4_1'"
    );
    assert.deepStrictEqual(o.rows[0], { order_number: "P4-1001", grand_total: "260", status: "PENDING" });
    const inv = await client.query<{ q: string }>("SELECT quantity_on_hand::text AS q FROM commerceos.inventory_items WHERE id = $1", [stock.id]);
    assert.strictEqual(inv.rows[0].q, "25");
  });

  await runTest("a flush writes only the rows that changed, and removed records are deleted", async () => {
    const rewritten = async (since: string) => {
      let n = 0;
      for (const table of ["orders", "order_items", "tenants", "users", "products", "inventory_items", "documents"]) {
        const r = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM commerceos.${table} WHERE row_updated_at > $1::timestamptz`, [since]);
        n += Number(r.rows[0].n);
      }
      return n;
    };
    const t0 = (await client.query<{ t: string }>("SELECT clock_timestamp()::text AS t")).rows[0].t;
    const o = store.data.orders.find((x) => x.id === "ord_p4_1");
    assert.ok(o);
    o.status = "CONFIRMED" as Order["status"];
    store.data.growth_insights = store.data.growth_insights.filter((g) => g.id !== "gi_p4");
    store.markDirty();
    await store.flush();
    assert.strictEqual(await rewritten(t0), 1, "only the changed order was rewritten");
    const after = await client.query<{ status: string }>("SELECT status FROM commerceos.orders WHERE id = 'ord_p4_1'");
    assert.strictEqual(after.rows[0].status, "CONFIRMED");
    const gone = await client.query("SELECT 1 FROM commerceos.documents WHERE collection = 'growth_insights' AND id = 'gi_p4'");
    assert.strictEqual(gone.rows.length, 0);
  });

  await runTest("text Postgres can't hold (NUL, half an emoji) is cleaned instead of failing every write", async () => {
    const note = `a\u0000b ${"😀".slice(0, 1)} end`;
    const o = store.data.orders.find((x) => x.id === "ord_p4_1");
    assert.ok(o);
    o.notes = note;
    store.markDirty();
    await store.flush();
    assert.ok(store.getPersistenceHealth().ok);
    const reloaded = await new PgStorePersistence(client).load();
    const saved = (reloaded.orders as Order[]).find((x) => x.id === "ord_p4_1");
    assert.strictEqual(saved?.notes, "ab � end");
  });

  await runTest("a refused record is set aside and reported; every other change is saved; fixing it saves it", async () => {
    store.createOrder(order(t, "ord_p4_dup", "P4-1001"), []); // same order number as ord_p4_1
    store.createOrder(order(t, "ord_p4_ok", "P4-1002"), [item(t, "oi_p4_ok", "ord_p4_ok")]);
    await store.flush();
    const health = store.getPersistenceHealth();
    assert.strictEqual(health.ok, false, "not ok while a record is unsaved");
    assert.strictEqual(health.unsaved_rows, 1);
    const [refused] = store.getUnsavedRows();
    assert.strictEqual(refused.id, "ord_p4_dup");
    assert.strictEqual(refused.constraint, "orders_tenant_order_number_key");
    const rows = await client.query<{ id: string }>("SELECT id FROM commerceos.orders WHERE tenant_id = $1 ORDER BY id", [t]);
    assert.deepStrictEqual(rows.rows.map((r) => r.id), ["ord_p4_1", "ord_p4_ok"], "the good order and its item were saved");
    const dup = store.data.orders.find((x) => x.id === "ord_p4_dup");
    assert.ok(dup);
    dup.order_number = "P4-1003";
    store.markDirty();
    await store.flush();
    assert.ok(store.getPersistenceHealth().ok, JSON.stringify(store.getPersistenceHealth()));
    assert.strictEqual(store.getUnsavedRows().length, 0);
  });

  await runTest("composite foreign keys: stock can't sit in another workspace's warehouse; items need their order", async () => {
    const other = catalog("ten_p4_b");
    store.createTenant(tenant("ten_p4_b"));
    store.data.products.push(other.product);
    store.data.product_variants.push(other.variant);
    store.data.inventory_items.push({ ...other.stock, id: "inv_p4_cross", warehouse_id: warehouse.id }); // tenant B, tenant A's warehouse
    store.data.order_items.push(item(t, "oi_p4_orphan", "ord_missing"));
    store.markDirty();
    await store.flush();
    const refused = store.getUnsavedRows().map((r) => `${r.id}:${r.constraint}`).sort();
    assert.deepStrictEqual(refused, ["inv_p4_cross:inventory_items_warehouse_fkey", "oi_p4_orphan:order_items_order_fkey"]);
    store.data.inventory_items = store.data.inventory_items.filter((i) => i.id !== "inv_p4_cross");
    store.data.order_items = store.data.order_items.filter((i) => i.id !== "oi_p4_orphan");
    store.markDirty();
    await store.flush();
    assert.strictEqual(store.getUnsavedRows().length, 0, "records removed from memory are no longer reported");
  });

  await runTest("records without a usable id are reported, never sent", async () => {
    store.data.cohort_records.push({ cohort_month: "2020-01", initial_size: 1, periods: [] } as never);
    store.markDirty();
    await store.flush();
    assert.deepStrictEqual(store.getUnsavedRows().map((r) => `${r.collection}:${r.reason}`), ["cohort_records:MISSING_ID"]);
    store.data.cohort_records = store.data.cohort_records.filter((c) => c.id);
    store.markDirty();
    await store.flush();
    assert.ok(store.getPersistenceHealth().ok);
  });

  await runTest("a row never moves to another tenant through an upsert (security review L5)", async () => {
    const o = store.data.orders.find((x) => x.id === "ord_p4_ok");
    assert.ok(o);
    (o as { tenant_id: string }).tenant_id = "ten_p4_b"; // bypassing safePatch on purpose
    store.markDirty();
    await store.flush();
    assert.deepStrictEqual(store.getUnsavedRows().map((r) => `${r.id}:${r.constraint}`), ["ord_p4_ok:tenant_id_unchanged"]);
    const row = await client.query<{ tenant_id: string }>("SELECT tenant_id FROM commerceos.orders WHERE id = 'ord_p4_ok'");
    assert.strictEqual(row.rows[0].tenant_id, t);
    (o as { tenant_id: string }).tenant_id = t;
    store.markDirty();
    await store.flush();
    assert.ok(store.getPersistenceHealth().ok);
  });

  await runTest("new workspaces get distinct default warehouses even when their ids start alike (review M3)", async () => {
    store.createTenant(tenant("ten_abcde_111111"));
    store.createTenant(tenant("ten_abcde_222222"));
    const ids = store.data.warehouses.filter((w) => w.tenant_id.startsWith("ten_abcde_")).map((w) => w.id);
    assert.strictEqual(new Set(ids).size, 2, ids.join(","));
    await store.flush();
    assert.strictEqual(store.getUnsavedRows().length, 0);
  });

  await runTest("without a confirmed lease: requests are refused before any change; a change that slips through is never saved (review M1, done-check)", async () => {
    const fencedClient = await migratedClient();
    const fencedStore = await openStore(fencedClient);
    const internals = fencedStore as unknown as { leaseConfirmedAt: number };
    const tenantsBefore = fencedStore.data.tenants.length;
    internals.leaseConfirmedAt = Date.now() - LEASE_TTL_MS * 0.55; // Postgres unreachable for more than half the lease
    // The request context refuses a mutating request before it touches anything.
    assert.throws(() => fencedStore.assertWritable(), (e: Error & { code?: string; statusCode?: number }) => e.code === "STORE_UNAVAILABLE" && e.statusCode === 503);
    assert.strictEqual(fencedStore.data.tenants.length, tenantsBefore, "nothing changed; reads still work");
    internals.leaseConfirmedAt = Date.now() - LEASE_TTL_MS * 0.85; // past 80%: another process may own the store soon
    assert.throws(() => fencedStore.data.tenants, (e: Error & { statusCode?: number }) => e.statusCode === 503);
    // A change that bypassed the request context: refused, and this store never saves anything again.
    internals.leaseConfirmedAt = Date.now() - LEASE_TTL_MS * 0.55;
    assert.throws(() => fencedStore.createTenant(tenant("ten_p4_fenced")), (e: Error & { statusCode?: number }) => e.statusCode === 503);
    internals.leaseConfirmedAt = Date.now(); // Postgres answers again
    await fencedStore.flush();
    const saved = await fencedClient.query("SELECT 1 FROM commerceos.tenants WHERE id = 'ten_p4_fenced'");
    assert.strictEqual(saved.rows.length, 0, "the refused change is never saved later (a retry can't duplicate it)");
    assert.strictEqual(fencedStore.getPersistenceHealth().blocked_code, "DATABASE_UNAVAILABLE");
    assert.throws(() => fencedStore.data.tenants, (e: Error & { statusCode?: number }) => e.statusCode === 503);
    await fencedStore.shutdown();
    await fencedClient.close();
  });

  await runTest("a child refused because of its parent is retried once the parent saves (done-check)", async () => {
    store.createOrder(order(t, "ord_p4_parent", "P4-1001"), [item(t, "oi_p4_child", "ord_p4_parent", 2)]); // duplicate number
    await store.flush();
    assert.deepStrictEqual(
      store.getUnsavedRows().map((r) => `${r.id}:${r.constraint}`).sort(),
      ["oi_p4_child:order_items_order_fkey", "ord_p4_parent:orders_tenant_order_number_key"]
    );
    const parent = store.data.orders.find((x) => x.id === "ord_p4_parent");
    assert.ok(parent);
    parent.order_number = "P4-1101";
    store.markDirty();
    await store.flush(); // the order saves; that commit schedules a retry of the waiting item
    await new Promise((resolve) => setTimeout(resolve, 600));
    await store.flush();
    assert.strictEqual(store.getUnsavedRows().length, 0, JSON.stringify(store.getUnsavedRows()));
    const child = await client.query("SELECT 1 FROM commerceos.order_items WHERE id = 'oi_p4_child'");
    assert.strictEqual(child.rows.length, 1);
    const quarantine = await client.query("SELECT 1 FROM commerceos.refused_rows");
    assert.strictEqual(quarantine.rows.length, 0, "saved rows leave the quarantine");
  });

  await runTest("refused rows survive a restart in commerceos.refused_rows and stay reported until saved (done-check)", async () => {
    const qClient = await migratedClient();
    const first = await openStore(qClient);
    first.createTenant(tenant("ten_q"));
    first.createOrder(order("ten_q", "ord_q_1", "Q-1"), []);
    first.createOrder(order("ten_q", "ord_q_2", "Q-1"), []); // refused: duplicate order number
    await first.flush();
    assert.deepStrictEqual(first.getUnsavedRows().map((r) => r.id), ["ord_q_2"]);
    await first.shutdown();
    const kept = await qClient.query<{ id: string; constraint_name: string; data: { order_number: string } }>(
      "SELECT id, constraint_name, data FROM commerceos.refused_rows"
    );
    assert.deepStrictEqual(kept.rows.map((r) => [r.id, r.constraint_name, r.data.order_number]), [["ord_q_2", "orders_tenant_order_number_key", "Q-1"]]);
    const second = await openStore(qClient); // a restart: the refused order is not in memory any more
    assert.ok(!second.data.orders.some((o) => o.id === "ord_q_2"));
    assert.deepStrictEqual(second.getUnsavedRows().map((r) => r.id), ["ord_q_2"], "still reported after the restart");
    assert.strictEqual(second.getPersistenceHealth().ok, false);
    second.createOrder(order("ten_q", "ord_q_2", "Q-2"), []); // re-entered correctly
    await second.flush();
    assert.strictEqual(second.getUnsavedRows().length, 0);
    assert.strictEqual((await qClient.query("SELECT 1 FROM commerceos.refused_rows")).rows.length, 0);
    await second.shutdown();
    await qClient.close();
  });

  await runTest("the readiness ping runs one query at a time and at most every 5 s (review M2)", async () => {
    const pingClient = await migratedClient();
    let pings = 0;
    const counting: SqlClient = {
      ...pingClient,
      query: (text, params) => {
        if (text === "SELECT 1") pings++;
        return pingClient.query(text, params);
      },
    };
    const probe = new CommerceDatabase({ backend: "pg", client: counting, persist: true });
    await probe.ready();
    const results = await Promise.all(Array.from({ length: 25 }, () => probe.pingDatabase()));
    assert.ok(results.every((r) => r === true));
    await probe.pingDatabase();
    assert.strictEqual(pings, 1);
    await probe.shutdown();
    await pingClient.close();
  });

  await runTest("numeric settings: blank or invalid values fall back to the default (review L6)", () => {
    const saved = process.env.P4_NUM;
    try {
      process.env.P4_NUM = "";
      assert.strictEqual(envNumber("P4_NUM", 30_000, 5_000), 30_000);
      process.env.P4_NUM = "abc";
      assert.strictEqual(envNumber("P4_NUM", 30_000, 5_000), 30_000);
      process.env.P4_NUM = "1000";
      assert.strictEqual(envNumber("P4_NUM", 30_000, 5_000), 5_000);
      process.env.P4_NUM = " 45000 ";
      assert.strictEqual(envNumber("P4_NUM", 30_000, 5_000), 45_000);
    } finally {
      if (saved === undefined) delete process.env.P4_NUM;
      else process.env.P4_NUM = saved;
    }
  });

  await runTest("single writer: the lease is held; a stale lease is taken over; the old writer is fenced out", async () => {
    const intruder = new PgStorePersistence(client);
    const denied = await intruder.acquireLease();
    assert.strictEqual(denied.acquired, false);
    assert.ok(!denied.acquired && denied.holder?.pid === process.pid);
    await client.query("UPDATE commerceos.store_writer SET heartbeat_at = now() - interval '1 hour'");
    assert.strictEqual((await intruder.acquireLease()).acquired, true, "an expired lease can be taken over");
    const o = store.data.orders.find((x) => x.id === "ord_p4_1");
    assert.ok(o);
    o.notes = "written after losing the lease";
    store.markDirty();
    await store.flush();
    const health = store.getPersistenceHealth();
    assert.strictEqual(health.blocked_code, "LOCK_LOST");
    assert.strictEqual(health.ok, false);
    const saved = await client.query<{ notes: string }>("SELECT data->>'notes' AS notes FROM commerceos.orders WHERE id = 'ord_p4_1'");
    assert.notStrictEqual(saved.rows[0].notes, "written after losing the lease", "nothing was written without the lease");
    assert.throws(() => store.createTenant(tenant("ten_p4_late")), (e: Error & { statusCode?: number }) => e.statusCode === 503);
    await intruder.releaseLease();
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-43] Backfill, verification, export${ANSI_RESET}`);
  // ---------------------------------------------------------------------------
  const cat = catalog("ten_bf");
  const source = CommerceDatabase.fromParsed({
    tenants: [tenant("ten_bf")],
    products: [cat.product],
    product_variants: [cat.variant],
    warehouses: [cat.warehouse],
    inventory_items: [cat.stock],
    orders: [order("ten_bf", "ord_bf_1", "BF-1", 500), order("ten_bf", "ord_bf_2", "BF-2", 250)],
    order_items: [item("ten_bf", "oi_bf_1", "ord_bf_1", 4), item("ten_bf", "oi_bf_2", "ord_bf_2")],
    order_sequences: { ten_bf: 2 },
    tenant_entitlements: [{ tenant_id: "ten_bf", entitlement_id: "max_users", value: 5, is_override: false, updated_at: iso() }],
  } as Partial<DatabaseSchema>) as unknown as Record<string, unknown>;
  const target = await migratedClient();

  await runTest("backfill writes the whole store in one transaction and verification passes", async () => {
    const result = await backfillStore(source, target, { replace: false, onRejected: "throw" });
    assert.strictEqual(result.report.mode, "batch");
    const report = await verifyStore(source, target);
    assert.ok(report.pass, JSON.stringify(report.checks));
    assert.deepStrictEqual(report.checks.map((c) => c.name), [
      "row counts per tenant and collection",
      "SUM(grand_total) of orders per tenant",
      "SUM(quantity_on_hand) of inventory per tenant",
      "order number sequences",
      "every record deep-equal",
    ]);
  });

  await runTest("verification fails when Postgres differs (a changed total)", async () => {
    await target.query("UPDATE commerceos.orders SET data = jsonb_set(data, '{grand_total}', '999') WHERE id = 'ord_bf_1'");
    const report = await verifyStore(source, target);
    assert.strictEqual(report.pass, false);
    const failed = report.checks.filter((c) => !c.pass).map((c) => c.name);
    assert.deepStrictEqual(failed, ["SUM(grand_total) of orders per tenant", "every record deep-equal"]);
    assert.deepStrictEqual(report.diffs.map((d) => [d.collection, d.different]), [["orders", ["ord_bf_1"]]]);
  });

  await runTest("a non-empty target needs --replace; replace restores it exactly; an app holding the lease blocks it", async () => {
    await assert.rejects(backfillStore(source, target, { replace: false, onRejected: "throw" }), /already holds/);
    await backfillStore(source, target, { replace: true, onRejected: "throw" });
    assert.ok((await verifyStore(source, target)).pass);
    const app = new PgStorePersistence(target);
    assert.ok((await app.acquireLease()).acquired);
    await assert.rejects(backfillStore(source, target, { replace: true, onRejected: "throw" }), /in use/);
    await app.releaseLease();
  });

  await runTest("a source the database refuses: the rehearsal lists the rows, the real backfill changes nothing", async () => {
    const bad = { ...source, orders: [...(source.orders as Order[]), order("ten_bf", "ord_bf_dup", "BF-1")] };
    const rehearsal = await backfillStore(bad, await migratedClient(), { replace: true, onRejected: "row-by-row" });
    assert.deepStrictEqual(rehearsal.report.rejected.map((r) => `${r.id}:${r.constraint}`), ["ord_bf_dup:orders_tenant_order_number_key"]);
    await assert.rejects(backfillStore(bad, target, { replace: true, onRejected: "throw" }));
    assert.ok((await verifyStore(source, target)).pass, "the failed backfill rolled back completely");
  });

  await runTest("export (rollback path) returns exactly what was backfilled", async () => {
    const exported = await new PgStorePersistence(target).load();
    assert.deepStrictEqual(diffStores(source, exported), []);
    assert.deepStrictEqual(exported.order_sequences, { ten_bf: 2 });
  });

  await runTest("scripts end to end on temporary data: dry run, backfill, verify, export (never the real .data or Neon)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cos-p4-"));
    const dataDir = path.join(tmp, "data");
    const pgDir = path.join(tmp, "pg");
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, "commerceos.json"), JSON.stringify(source));
    const env = { COMMERCEOS_DATA_DIR: dataDir };
    try {
      const migrate = runScript("./src/infrastructure/db/migrate.ts", ["--pglite", pgDir], env);
      assert.strictEqual(migrate.status, 0, migrate.stderr + migrate.stdout);
      const dry = runScript("./scripts/migrate-json-to-pg.ts", [], env);
      assert.strictEqual(dry.status, 0, dry.stderr + dry.stdout);
      assert.match(dry.stdout, /VERIFICATION PASS/);
      assert.match(dry.stdout, /Dry run only/);
      const applied = runScript("./scripts/migrate-json-to-pg.ts", ["--apply", "--target", `pglite:${pgDir}`], env);
      assert.strictEqual(applied.status, 0, applied.stderr + applied.stdout);
      const verified = runScript("./scripts/verify-migration.ts", ["--target", `pglite:${pgDir}`], env);
      assert.strictEqual(verified.status, 0, verified.stderr + verified.stdout);
      assert.match(verified.stdout, /VERIFICATION PASS/);
      const exportFile = path.join(tmp, "export.json");
      const exported = runScript("./scripts/export-pg-to-json.ts", ["--out", exportFile, "--target", `pglite:${pgDir}`], env);
      assert.strictEqual(exported.status, 0, exported.stderr + exported.stdout);
      const back = JSON.parse(fs.readFileSync(exportFile, "utf-8")) as Record<string, unknown>;
      const json = JSON.parse(fs.readFileSync(path.join(dataDir, "commerceos.json"), "utf-8")) as Record<string, unknown>;
      assert.deepStrictEqual(diffStores(json, back), [], "the export equals the JSON store");
      assert.strictEqual(fs.readFileSync(path.join(dataDir, "commerceos.json"), "utf-8"), JSON.stringify(source), "the scripts never wrote the JSON file");
      assert.ok(!fs.existsSync(path.join(dataDir, "commerceos.lock")), "and left no lock behind");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[Integrity] Findings from the Postgres test mode${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("a stock adjustment can't use another workspace's variant or warehouse (no phantom rows)", () => {
    db.clearAllForTesting();
    const a = catalog("ten_adj_a");
    db.data.products.push(a.product);
    db.data.product_variants.push(a.variant);
    db.data.warehouses.push(a.warehouse);
    const b = catalog("ten_adj_b");
    db.data.warehouses.push(b.warehouse);
    const adjust = (tenantId: string, warehouseId: string, variantId: string) =>
      db.adjustStock(tenantId, { warehouse_id: warehouseId, product_variant_id: variantId, quantity_delta: 5, type: "ADJUSTMENT" as never, reason: "p4", actor_user_id: "u" });
    assert.throws(() => adjust("ten_adj_b", b.warehouse.id, a.variant.id), (e: Error & { statusCode?: number }) => e.statusCode === 404);
    assert.throws(() => adjust("ten_adj_a", b.warehouse.id, a.variant.id), (e: Error & { statusCode?: number }) => e.statusCode === 404);
    assert.strictEqual(db.data.inventory_items.filter((i) => i.tenant_id.startsWith("ten_adj_")).length, 0, "no row was created");
    assert.throws(() => db.adjustStock("ten_adj_a", { warehouse_id: a.warehouse.id, product_variant_id: a.variant.id, quantity_delta: -3,
      type: "ADJUSTMENT" as never, reason: "p4", actor_user_id: "u" }), /Insufficient stock/);
    assert.strictEqual(db.data.inventory_items.filter((i) => i.tenant_id === "ten_adj_a").length, 0, "a refused adjustment leaves no empty row");
    assert.strictEqual(adjust("ten_adj_a", a.warehouse.id, a.variant.id).quantity_on_hand, 5);
  });

  await runTest("record ids are never built from the clock alone (two in one millisecond collided)", () => {
    const hits: string[] = [];
    const idFromClock = /\b(id: (?:existing\?\.id \|\| )?|(?:workflowId|syncId|decisionId) = )`[^`]*\$\{Date\.now\(\)\}[^`]*`/;
    for (const file of sourceFiles(path.join(ROOT, "src"))) {
      if (file.includes("mock-llm.provider")) continue;
      fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (idFromClock.test(line) && !/randomSuffix|getRandomValues/.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
      });
    }
    assert.deepStrictEqual(hits, []);
  });

  await runTest("withTransaction propagates failures (no silent re-run over HTTP after a rollback, M8)", () => {
    const text = fs.readFileSync(path.join(ROOT, "src/infrastructure/neon/client.ts"), "utf8");
    assert.ok(!/fallbackClient|fall back to HTTP/.test(text));
  });

  await runTest("test suites never use a database from the local environment", () => {
    assert.strictEqual(process.env.DATA_BACKEND, undefined, "the runner drops DATA_BACKEND for suites");
  });

  await store.shutdown();
  await client.close();
  await target.close();

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Phase 4 Postgres suite crashed:", err);
  process.exit(1);
});
