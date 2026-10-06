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
import { LEASE_TTL_MS, PgStorePersistence, StoreConflictError } from "@/infrastructure/store/pg-store";
import { CORE_TABLES } from "@/infrastructure/store/store-schema";
import { createPgliteClient } from "@/infrastructure/store/pglite-client";
import type { SqlClient } from "@/infrastructure/store/sql-client";
import { envNumber } from "@/lib/env-number";
import { AppError } from "@/lib/errors";
import { apiError } from "@/lib/api-response";
import { withStore } from "@/lib/store-unit";
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

/** The client, recording the start of every statement sent through it (a transaction counts as "BEGIN"). */
function counting(client: SqlClient): { client: SqlClient; log: string[] } {
  const log: string[] = [];
  const wrapped = new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if ((prop === "query" || prop === "exec" || prop === "transaction") && typeof value === "function") {
        return (...args: unknown[]) => {
          log.push(prop === "transaction" ? "BEGIN" : String(args[0]).replace(/\s+/g, " ").trim().slice(0, 80));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  return { client: wrapped, log };
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

  const refusedIn = (code: string) => (e: Error & { code?: string; statusCode?: number }) => e.code === code && e.statusCode === 409;
  const commitAll = () => true;

  await runTest("a unit whose change breaks a data rule is refused whole: 409, nothing written, memory restored", async () => {
    const before = store.data.orders.length;
    await assert.rejects(
      store.unit(async () => {
        store.createOrder(order(t, "ord_p4_dup", "P4-1001"), []); // same order number as ord_p4_1
        store.createOrder(order(t, "ord_p4_ok", "P4-1002"), [item(t, "oi_p4_ok", "ord_p4_ok")]);
        return true;
      }, commitAll),
      refusedIn("CONSTRAINT_VIOLATION")
    );
    assert.strictEqual(store.data.orders.length, before, "both orders of the refused unit are gone from memory");
    const rows = await client.query("SELECT id FROM commerceos.orders WHERE id IN ('ord_p4_dup', 'ord_p4_ok')");
    assert.strictEqual(rows.rows.length, 0, "nothing of the unit was written");
    await store.unit(async () => {
      store.createOrder(order(t, "ord_p4_ok", "P4-1002"), [item(t, "oi_p4_ok", "ord_p4_ok")]);
      return true;
    }, commitAll);
    assert.strictEqual((await client.query("SELECT 1 FROM commerceos.order_items WHERE id = 'oi_p4_ok'")).rows.length, 1);
  });

  await runTest("composite foreign keys: stock can't sit in another workspace's warehouse; items need their order (409)", async () => {
    const other = catalog("ten_p4_b");
    await store.unit(async () => {
      store.createTenant(tenant("ten_p4_b"));
      store.data.products.push(other.product);
      store.data.product_variants.push(other.variant);
      store.markDirty();
      return true;
    }, commitAll);
    await assert.rejects(
      store.unit(async () => {
        store.data.inventory_items.push({ ...other.stock, id: "inv_p4_cross", warehouse_id: warehouse.id }); // tenant B, tenant A's warehouse
        store.markDirty();
        return true;
      }, commitAll),
      refusedIn("CONSTRAINT_VIOLATION")
    );
    await assert.rejects(
      store.unit(async () => {
        store.data.order_items.push(item(t, "oi_p4_orphan", "ord_missing"));
        store.markDirty();
        return true;
      }, commitAll),
      refusedIn("CONSTRAINT_VIOLATION")
    );
    assert.ok(!store.data.inventory_items.some((i) => i.id === "inv_p4_cross") && !store.data.order_items.some((i) => i.id === "oi_p4_orphan"));
    assert.strictEqual(store.getPersistenceHealth().ok, true, "a refused request leaves the store healthy");
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

  await runTest("a row never moves to another tenant through a write (security review L5)", async () => {
    await assert.rejects(
      store.unit(async () => {
        const o = store.data.orders.find((x) => x.id === "ord_p4_ok");
        assert.ok(o);
        (o as { tenant_id: string }).tenant_id = "ten_p4_b"; // bypassing safePatch on purpose
        store.markDirty();
        return true;
      }, commitAll),
      refusedIn("STORE_CONFLICT")
    );
    const row = await client.query<{ tenant_id: string }>("SELECT tenant_id FROM commerceos.orders WHERE id = 'ord_p4_ok'");
    assert.strictEqual(row.rows[0].tenant_id, t);
    assert.strictEqual(store.data.orders.find((x) => x.id === "ord_p4_ok")?.tenant_id, t, "memory restored");
  });

  await runTest("new workspaces get distinct default warehouses even when their ids start alike (review M3)", async () => {
    store.createTenant(tenant("ten_abcde_111111"));
    store.createTenant(tenant("ten_abcde_222222"));
    const ids = store.data.warehouses.filter((w) => w.tenant_id.startsWith("ten_abcde_")).map((w) => w.id);
    assert.strictEqual(new Set(ids).size, 2, ids.join(","));
    await store.flush();
    assert.strictEqual(store.getUnsavedRows().length, 0);
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

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-45] Several app servers on one store${ANSI_RESET}`);
  // ---------------------------------------------------------------------------
  const mwClient = await migratedClient();
  const A = await openStore(mwClient);
  await A.flush(); // A's default seed is committed before B starts, so B loads it instead of seeding its own
  const B = await openStore(mwClient);
  const mwCatalog = catalog("ten_mw");

  await runTest("a unit commits before it returns; the other server sees it at its next sync", async () => {
    await A.unit(async () => {
      A.createTenant(tenant("ten_mw"));
      A.data.products.push(mwCatalog.product);
      A.data.product_variants.push(mwCatalog.variant);
      A.data.warehouses.push(mwCatalog.warehouse);
      A.data.inventory_items.push({ ...mwCatalog.stock, quantity_on_hand: 1, quantity_reserved: 0, quantity_available: 1 });
      A.createOrder(order("ten_mw", "ord_mw_1", "MW-1"), [item("ten_mw", "oi_mw_1", "ord_mw_1")]);
      A.data.growth_insights.push({ id: "gi_counter", tenant_id: "ten_mw", count: 0 } as never);
      A.markDirty();
      return true;
    }, commitAll);
    assert.strictEqual((await mwClient.query("SELECT 1 FROM commerceos.orders WHERE id = 'ord_mw_1'")).rows.length, 1, "committed before unit() returned");
    assert.ok(!B.data.orders.some((o) => o.id === "ord_mw_1"));
    await B.syncNow();
    assert.ok(B.data.orders.some((o) => o.id === "ord_mw_1"));
    assert.ok(B.data.tenants.some((x) => x.id === "ten_mw"));
  });

  await runTest("two servers change the same record: the second gets 409, nothing is lost, and it then sees the first's change", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const second = B.unit(async () => {
      await gate; // B synced at the start of its unit, then waits while A commits
      const o = B.data.orders.find((x) => x.id === "ord_mw_1");
      assert.ok(o);
      o.notes = "from B";
      B.markDirty();
      return true;
    }, commitAll);
    await new Promise((r) => setTimeout(r, 50));
    await A.unit(async () => {
      const o = A.data.orders.find((x) => x.id === "ord_mw_1");
      assert.ok(o);
      o.notes = "from A";
      A.markDirty();
      return true;
    }, commitAll);
    open();
    await assert.rejects(second, refusedIn("STORE_CONFLICT"));
    const saved = await mwClient.query<{ notes: string }>("SELECT data->>'notes' AS notes FROM commerceos.orders WHERE id = 'ord_mw_1'");
    assert.strictEqual(saved.rows[0].notes, "from A");
    assert.strictEqual(B.data.orders.find((x) => x.id === "ord_mw_1")?.notes, "from A", "B's memory holds the winner, not its own refused change");
  });

  await runTest("a customer-agent quote claimed by two servers at once: exactly one PLACING wins, the other gets 409 (FX-73)", async () => {
    const now = new Date().toISOString();
    await A.unit(async () => {
      A.createQuote({
        id: "q_mw_1", tenant_id: "ten_mw", conversation_id: "conv_mw", items: [{ variant_id: "var_mw", quantity: 1 }], district: "Dhaka",
        zone: "INSIDE_DHAKA", lines: [], subtotal: 100, discount_total: 0, delivery_charge: 60, grand_total: 160,
        customer_msg_count_at_quote: 0, status: "QUOTED", expires_at: new Date(Date.now() + 60_000).toISOString(), created_at: now, updated_at: now,
      });
      return true;
    }, commitAll);
    await B.syncNow();
    const claim = (server: CommerceDatabase, gate?: Promise<void>) =>
      server.unit(async () => {
        if (gate) await gate;
        const q = server.findQuote("ten_mw", "conv_mw", "q_mw_1");
        if (!q || q.status !== "QUOTED") return false;
        server.updateQuote("ten_mw", "q_mw_1", { status: "PLACING" });
        return true;
      }, (claimed) => claimed);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const second = claim(B, gate); // B starts its unit, then waits while A claims
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(await claim(A), true, "the first claim wins");
    open();
    await assert.rejects(second, refusedIn("STORE_CONFLICT"));
    const saved = await mwClient.query<{ status: string }>("SELECT data->>'status' AS status FROM commerceos.documents WHERE collection = 'quotes' AND id = 'q_mw_1'");
    assert.strictEqual(saved.rows[0]?.status, "PLACING");
  });

  await runTest("no lost writes: 30 concurrent read-modify-write requests on two servers (retrying on 409) all land", async () => {
    const bump = async (server: CommerceDatabase) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          await server.unit(async () => {
            const counter = server.data.growth_insights.find((x) => x.id === "gi_counter") as unknown as { count: number };
            const next = counter.count + 1;
            await new Promise((r) => setTimeout(r, Math.random() * 4));
            counter.count = next;
            server.markDirty();
            return true;
          }, commitAll);
          return;
        } catch (err) {
          if ((err as { code?: string }).code !== "STORE_CONFLICT") throw err;
        }
      }
      throw new Error("gave up after 50 conflicts");
    };
    await Promise.all(Array.from({ length: 30 }, (_, i) => bump(i % 2 ? A : B)));
    const row = await mwClient.query<{ count: string }>("SELECT data->>'count' AS count FROM commerceos.documents WHERE collection = 'growth_insights' AND id = 'gi_counter'");
    assert.strictEqual(Number(row.rows[0].count), 30);
    await A.syncNow();
    await B.syncNow();
    for (const server of [A, B]) {
      assert.strictEqual((server.data.growth_insights.find((x) => x.id === "gi_counter") as unknown as { count: number }).count, 30);
    }
  });

  await runTest("no overselling across servers: the last unit of stock can be reserved once", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const reserve = (server: CommerceDatabase) =>
      server.unit(async () => {
        const inv = server.data.inventory_items.find((x) => x.id === mwCatalog.stock.id);
        assert.ok(inv);
        if (inv.quantity_on_hand - inv.quantity_reserved < 1) throw new Error("insufficient stock");
        await gate; // both servers have seen 1 available
        inv.quantity_reserved += 1;
        inv.quantity_available = inv.quantity_on_hand - inv.quantity_reserved;
        server.markDirty();
        return true;
      }, commitAll);
    const results = Promise.allSettled([reserve(A), reserve(B)]);
    await new Promise((r) => setTimeout(r, 50));
    open();
    const settled = await results;
    assert.deepStrictEqual(settled.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    const refused = settled.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.strictEqual((refused.reason as { code?: string }).code, "STORE_CONFLICT");
    const row = await mwClient.query<{ q: string }>("SELECT quantity_reserved::text AS q FROM commerceos.inventory_items WHERE id = $1", [mwCatalog.stock.id]);
    assert.strictEqual(row.rows[0].q, "1", "reserved once");
  });

  await runTest("a unit that fails or answers with an error writes nothing and restores memory", async () => {
    await assert.rejects(A.unit(async () => {
      A.createTenant(tenant("ten_mw_thrown"));
      throw new Error("handler failed");
    }, commitAll), /handler failed/);
    const answered = await A.unit(async () => {
      A.createTenant(tenant("ten_mw_400"));
      return { status: 400 };
    }, (res) => res.status < 400);
    assert.strictEqual(answered.status, 400);
    assert.ok(!A.data.tenants.some((x) => x.id === "ten_mw_thrown" || x.id === "ten_mw_400"));
    const rows = await mwClient.query("SELECT 1 FROM commerceos.tenants WHERE id IN ('ten_mw_thrown', 'ten_mw_400')");
    assert.strictEqual(rows.rows.length, 0);
  });

  await runTest("with migration 008 a write is one statement: no transaction round trips, one apply_changes call", async () => {
    const { client, log } = counting(await migratedClient());
    const S = await openStore(client);
    assert.strictEqual((S as unknown as { pg: PgStorePersistence }).pg.oneStatementWrites, true);
    await S.unit(async () => {
      S.createTenant(tenant("ten_fast_1")); // the first write also prunes the change log (every 5 min)
      return true;
    }, commitAll);
    log.length = 0;
    await S.unit(async () => {
      S.createTenant(tenant("ten_fast_2"));
      S.recordPlatformSecurityEvent({ id: "sec_fast", event_type: "SUSPICIOUS_SESSION", severity: "LOW", description: "fast", created_at: new Date().toISOString() });
      return true;
    }, commitAll);
    const writes = log.filter((q) => !q.startsWith("WITH s AS")); // syncs (the unit's, and the background loop's)
    assert.deepStrictEqual(writes.map((q) => (q.includes("apply_changes") ? "apply_changes" : q)), ["apply_changes"], `statements: ${log.join(" | ")}`);
    const saved = await client.query<{ n: string }>(
      "SELECT (SELECT count(*) FROM commerceos.tenants WHERE id = 'ten_fast_2') + (SELECT count(*) FROM commerceos.documents WHERE id = 'sec_fast') + (SELECT count(*) FROM commerceos.changes WHERE id IN ('ten_fast_2', 'sec_fast')) AS n"
    );
    assert.strictEqual(Number(saved.rows[0].n), 4, "both rows and both change-log entries");
    await S.shutdown();
  });

  await runTest("one-statement writes report conflicts with the rows involved (and write nothing)", async () => {
    const client = await migratedClient();
    const seedStore = await openStore(client);
    await seedStore.unit(async () => {
      seedStore.createTenant(tenant("ten_fast_c"));
      return true;
    }, commitAll);
    await seedStore.shutdown();
    const p1 = new PgStorePersistence(client);
    const p2 = new PgStorePersistence(client);
    const d1 = await p1.load();
    const d2 = await p2.load();
    const rename = (data: Record<string, unknown>, name: string) => {
      const t = (data.tenants as TenantRecord[]).find((x) => x.id === "ten_fast_c");
      assert.ok(t);
      t.name = name;
    };
    rename(d1, "first");
    await p1.write(p1.computeChanges(d1, new Set(["tenants"])));
    rename(d2, "second");
    const err = await p2.write(p2.computeChanges(d2, new Set(["tenants"]))).then(() => null, (e: unknown) => e);
    assert.ok(err instanceof StoreConflictError, `got ${String(err)}`);
    assert.deepStrictEqual(err.rows, [{ collection: "tenants", id: "ten_fast_c" }]);
    const row = await client.query<{ name: string }>("SELECT data->>'name' AS name FROM commerceos.tenants WHERE id = 'ten_fast_c'");
    assert.strictEqual(row.rows[0].name, "first");
  });

  await runTest("one-statement writes keep every guard: no tenant move, no overwrite of another server's insert, all or nothing", async () => {
    const client = await migratedClient();
    const seedStore = await openStore(client);
    await seedStore.unit(async () => {
      seedStore.createTenant(tenant("ten_g_a"));
      seedStore.createTenant(tenant("ten_g_b"));
      seedStore.recordPlatformSecurityEvent({ id: "sec_g", event_type: "SUSPICIOUS_SESSION", severity: "LOW", description: "g", created_at: new Date().toISOString() });
      seedStore.data.growth_insights.push({ id: "gi_g", tenant_id: "ten_g_a", count: 0 } as never);
      seedStore.markDirty();
      return true;
    }, commitAll);
    await seedStore.shutdown();
    const changeLogCount = async () => Number((await client.query<{ n: string }>("SELECT count(*)::text AS n FROM commerceos.changes")).rows[0].n);

    // A row may not move to another tenant (core table and documents)
    const p = new PgStorePersistence(client);
    const d = await p.load();
    const before = await changeLogCount();
    (d.growth_insights as Array<{ id: string; tenant_id: string }>).find((x) => x.id === "gi_g")!.tenant_id = "ten_g_b";
    const moved = await p.write(p.computeChanges(d, new Set(["growth_insights"]))).then(() => null, (e: unknown) => e);
    assert.ok(moved instanceof StoreConflictError);
    assert.deepStrictEqual(moved.rows, [{ collection: "growth_insights", id: "gi_g" }]);
    const kept = await client.query<{ t: string }>("SELECT tenant_id AS t FROM commerceos.documents WHERE collection = 'growth_insights' AND id = 'gi_g'");
    assert.strictEqual(kept.rows[0].t, "ten_g_a");
    assert.strictEqual(await changeLogCount(), before, "no change-log entry for a refused write");

    // Two servers insert the same id: the second is refused, the first row stays as written
    const p1 = new PgStorePersistence(client);
    const p2 = new PgStorePersistence(client);
    const d1 = await p1.load();
    const d2 = await p2.load();
    (d1.products as unknown[]).push({ ...catalog("ten_g_a").product, id: "prod_same" });
    (d2.products as unknown[]).push({ ...catalog("ten_g_b").product, id: "prod_same", name: "second" });
    await p1.write(p1.computeChanges(d1, new Set(["products"])));
    const dup = await p2.write(p2.computeChanges(d2, new Set(["products"]))).then(() => null, (e: unknown) => e);
    assert.ok(dup instanceof StoreConflictError);
    const same = await client.query<{ t: string }>("SELECT tenant_id AS t FROM commerceos.products WHERE id = 'prod_same'");
    assert.strictEqual(same.rows[0].t, "ten_g_a");

    // One conflict among valid changes: nothing of the write is saved
    const p3 = new PgStorePersistence(client);
    const d3 = await p3.load();
    (d3.tenants as TenantRecord[]).push(tenant("ten_g_new"));
    (d3.products as Array<{ id: string; tenant_id: string }>).find((x) => x.id === "prod_same")!.tenant_id = "ten_g_b";
    const mixedBefore = await changeLogCount();
    const mixed = await p3.write(p3.computeChanges(d3)).then(() => null, (e: unknown) => e);
    assert.ok(mixed instanceof StoreConflictError);
    assert.strictEqual((await client.query("SELECT 1 FROM commerceos.tenants WHERE id = 'ten_g_new'")).rows.length, 0);
    assert.strictEqual(await changeLogCount(), mixedBefore);
  });

  await runTest("apply_changes accepts only the store's tables, and its list matches CORE_TABLES", async () => {
    const sql = fs.readFileSync(path.join(ROOT, "src/infrastructure/db/migrations/008_apply_changes.sql"), "utf8");
    const listed = [...(sql.match(/core_tables CONSTANT text\[\] := ARRAY\[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const expected = Object.values(CORE_TABLES).map((t) => (t as { table: string }).table).sort();
    assert.deepStrictEqual(listed, expected);
    const client = await migratedClient();
    const payload = JSON.stringify({ upserts: [{ collection: "x", table: "changes", updates: [], inserts: [{ id: "1", tenant_id: null, created_at: null, data: {} }] }] });
    const refused = await client.query("SELECT commerceos.apply_changes($1::jsonb, 'w')", [payload]).then(() => null, (e: unknown) => e);
    assert.ok(refused, "a table outside the store is refused");
    assert.match(String((refused as Error).message), /not a store table/);
  });

  await runTest("migration 008 removed while a server runs: its next write falls back to the transaction path instead of failing", async () => {
    const client = await migratedClient();
    const S = await openStore(client);
    await client.exec("DROP FUNCTION commerceos.apply_changes(jsonb, text)");
    await S.unit(async () => {
      S.createTenant(tenant("ten_after_drop"));
      return true;
    }, commitAll);
    assert.strictEqual((S as unknown as { pg: PgStorePersistence }).pg.oneStatementWrites, false);
    assert.strictEqual((await client.query("SELECT 1 FROM commerceos.tenants WHERE id = 'ten_after_drop'")).rows.length, 1);
    await S.shutdown();
  });

  await runTest("without migration 008 (a server started before it's applied) writes still work, statement by statement", async () => {
    const base = await migratedClient();
    await base.exec("DROP FUNCTION commerceos.apply_changes(jsonb, text)");
    const { client, log } = counting(base);
    const S = await openStore(client);
    assert.strictEqual((S as unknown as { pg: PgStorePersistence }).pg.oneStatementWrites, false);
    log.length = 0;
    await S.unit(async () => {
      S.createTenant(tenant("ten_slow"));
      return true;
    }, commitAll);
    assert.ok(log.includes("BEGIN"), "the transaction path");
    const saved = await client.query("SELECT 1 FROM commerceos.changes WHERE id = 'ten_slow'");
    assert.strictEqual(saved.rows.length, 1);
    await S.shutdown();
  });

  await runTest("a failed request still saves the rows it marked (a failed sign-in's security event), and nothing else", async () => {
    const answered = await A.unit(async () => {
      A.recordPlatformSecurityEvent({ id: "sec_mw_fail", event_type: "FAILED_LOGIN", severity: "HIGH", description: "Failed platform login attempt", created_at: new Date().toISOString() });
      A.keepEvenIfRequestFails("platform_security_events", "sec_mw_fail");
      A.recordPlatformSecurityEvent({ id: "sec_mw_other", event_type: "SUSPICIOUS_SESSION", severity: "LOW", description: "not marked", created_at: new Date().toISOString() });
      A.createTenant(tenant("ten_mw_401"));
      return { status: 401 };
    }, (res) => res.status < 400);
    assert.strictEqual(answered.status, 401);
    const kept = await mwClient.query<{ id: string }>("SELECT id FROM commerceos.documents WHERE collection = 'platform_security_events' AND id IN ('sec_mw_fail', 'sec_mw_other')");
    assert.deepStrictEqual(kept.rows.map((r) => r.id), ["sec_mw_fail"]);
    assert.ok(A.data.platform_security_events.some((e) => e.id === "sec_mw_fail"), "kept in memory too");
    assert.ok(!A.data.platform_security_events.some((e) => e.id === "sec_mw_other"));
    assert.ok(!A.data.tenants.some((x) => x.id === "ten_mw_401"));
    await B.syncNow();
    assert.ok(B.data.platform_security_events.some((e) => e.id === "sec_mw_fail"), "the other server sees it");
  });

  await runTest("a failed request's change a service forgot to report is undone too, not saved by the next sweep", async () => {
    const before = A.data.orders.find((x) => x.id === "ord_mw_1")?.notes;
    await A.unit(async () => {
      A.createTenant(tenant("ten_mw_unreported")); // reports "tenants" only
      const o = A.data.orders.find((x) => x.id === "ord_mw_1");
      assert.ok(o);
      o.notes = "changed without markDirty";
      return { status: 422 };
    }, (res) => res.status < 400);
    assert.strictEqual(A.data.orders.find((x) => x.id === "ord_mw_1")?.notes, before);
    await A.flush();
    const saved = await mwClient.query<{ notes: string | null }>("SELECT data->>'notes' AS notes FROM commerceos.orders WHERE id = 'ord_mw_1'");
    assert.strictEqual(saved.rows[0].notes ?? undefined, before);
  });

  await runTest("work a request left running is not part of a later request: a failing unit doesn't undo it, the background commits it", async () => {
    let later!: () => void;
    const laterGate = new Promise<void>((resolve) => (later = resolve));
    let detached!: Promise<void>;
    await A.unit(async () => {
      detached = (async () => {
        await laterGate; // e.g. a conversation summary saved after an LLM call, once the response has gone
        A.recordPlatformSecurityEvent({ id: "sec_mw_late", event_type: "SUSPICIOUS_SESSION", severity: "LOW", description: "late", created_at: new Date().toISOString() });
      })();
      return true;
    }, commitAll);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const failing = A.unit(async () => {
      A.createTenant(tenant("ten_mw_fails"));
      await gate;
      return { status: 500 };
    }, (res) => res.status < 400);
    await new Promise((r) => setTimeout(r, 20));
    later();
    await detached; // lands while the failing unit runs
    open();
    await failing;
    assert.ok(A.data.platform_security_events.some((x) => x.id === "sec_mw_late"), "the earlier request's late write survives");
    assert.ok(!A.data.tenants.some((x) => x.id === "ten_mw_fails"));
    await A.flush();
    const late = await mwClient.query("SELECT 1 FROM commerceos.documents WHERE collection = 'platform_security_events' AND id = 'sec_mw_late'");
    assert.strictEqual(late.rows.length, 1, "committed by the background");
    const failed = await mwClient.query("SELECT 1 FROM commerceos.tenants WHERE id = 'ten_mw_fails'");
    assert.strictEqual(failed.rows.length, 0);
  });

  await runTest("the automation kill switch is stored: set on one server, it halts runs on the other", async () => {
    await A.unit(async () => {
      A.setAutomationKillSwitch({ scope: "TENANT", target_id: "ten_mw", tenant_id: "ten_mw", active: true, reason: "test", changed_by: "usr_x" });
      return true;
    }, commitAll);
    await B.syncNow();
    assert.strictEqual(B.getActiveAutomationKillSwitches("ten_mw").length, 1);
    assert.strictEqual(B.getActiveAutomationKillSwitches("ten_other").length, 0);
    await B.unit(async () => {
      B.setAutomationKillSwitch({ scope: "TENANT", target_id: "ten_mw", tenant_id: "ten_mw", active: false, changed_by: "usr_x" });
      return true;
    }, commitAll);
    await A.syncNow();
    assert.strictEqual(A.getActiveAutomationKillSwitches("ten_mw").length, 0);
  });

  await runTest("rejected webhook deliveries are kept although their request answers 4xx", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/domains/automation/services/webhook-gateway.service.ts"), "utf8");
    const rejected = source.split('status: "REJECTED"').length - 1;
    const kept = source.split('keepEvenIfRequestFails("automation_webhook_deliveries"').length - 1;
    assert.ok(rejected > 0);
    assert.strictEqual(kept, rejected, "every rejected delivery is marked to keep");
  });

  await runTest("store refusals carry no internal names (collections, constraints) to the client", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const second = B.unit(async () => {
      await gate;
      const o = B.data.orders.find((x) => x.id === "ord_mw_1");
      assert.ok(o);
      o.notes = "B again";
      B.markDirty();
      return true;
    }, commitAll);
    await new Promise((r) => setTimeout(r, 50));
    await A.unit(async () => {
      const o = A.data.orders.find((x) => x.id === "ord_mw_1");
      assert.ok(o);
      o.notes = "A again";
      A.markDirty();
      return true;
    }, commitAll);
    open();
    const err = await second.then(() => null, (e: AppError) => e);
    assert.ok(err && err.code === "STORE_CONFLICT");
    assert.strictEqual(err.details, undefined);
    assert.ok(!/orders|commerceos/.test(err.message));
  });

  await runTest("a request that waits too long for this server's store lock gets 503 STORE_BUSY; so does a read that can't sync", async () => {
    const previous = process.env.STORE_LOCK_WAIT_MS;
    process.env.STORE_LOCK_WAIT_MS = "100";
    try {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const slow = A.unit(async () => {
        await gate; // e.g. a slow outbound call inside a request
        return true;
      }, commitAll);
      await new Promise((r) => setTimeout(r, 20));
      const waited = await A.unit(async () => true, commitAll).then(() => null, (e: AppError) => e);
      assert.ok(waited && waited.code === "STORE_BUSY" && waited.statusCode === 503, "a queued write gives up");
      await A.syncIfDue(); // recently synced: the read is served without waiting
      (A as unknown as { lastSyncAt: number }).lastSyncAt = 0; // no sync for longer than STORE_MAX_STALENESS_MS
      const stale = await A.syncIfDue().then(() => null, (e: AppError) => e);
      assert.ok(stale && stale.statusCode === 503, "a read too far behind other servers refuses");
      open();
      await slow;
      await A.syncIfDue(); // the lock is free again: it syncs and serves
      assert.ok(Date.now() - (A as unknown as { lastSyncAt: number }).lastSyncAt < 5_000);
    } finally {
      if (previous === undefined) delete process.env.STORE_LOCK_WAIT_MS;
      else process.env.STORE_LOCK_WAIT_MS = previous;
    }
  });

  await runTest("an AppError from another copy of the errors module (the store is built with instrumentation) keeps its status", async () => {
    // What the soak test found: the store's 409 / 503 reached clients as 500 because `instanceof` failed across copies
    const foreign = Object.assign(new Error("Someone else changed this record at the same time."), { code: "STORE_CONFLICT", statusCode: 409 });
    Object.defineProperty(foreign, Symbol.for("commerceos.AppError"), { value: true });
    const res = apiError(foreign);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(((await res.json()) as { error: { code: string } }).error.code, "STORE_CONFLICT");
    assert.strictEqual(apiError(Object.assign(new Error("plain"), { code: "X", statusCode: 409 })).status, 500, "an unbranded error stays a generic 500");
  });

  await runTest("withStore receives the body before queueing, and refuses one that is declared too large (413)", async () => {
    const echo = withStore("POST", async (request: Request) => new Response(JSON.stringify(await request.json()), { status: 200 }));
    const ok = await echo(new Request("http://x/api", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "content-type": "application/json" } }));
    assert.deepStrictEqual(await ok.json(), { a: 1 }, "the handler still reads the body");
    const big = await echo(new Request("http://x/api", { method: "POST", body: "{}", headers: { "content-length": String(1024 * 1024 * 1024) } }));
    assert.strictEqual(big.status, 413);
  });

  await runTest("changes made outside a request are committed in the background and reach the other server", async () => {
    A.createTenant(tenant("ten_mw_bg")); // e.g. the reservation sweeper
    await A.flush();
    await B.syncNow();
    assert.ok(B.data.tenants.some((x) => x.id === "ten_mw_bg"));
  });

  await runTest("a new store epoch (backfill) or a pruned change log makes a server reload everything", async () => {
    await mwClient.query(
      "INSERT INTO commerceos.tenants (id, tenant_id, data) VALUES ('ten_mw_sql', 'ten_mw_sql', $1::jsonb)",
      [JSON.stringify(tenant("ten_mw_sql"))]
    );
    await mwClient.query("UPDATE commerceos.store_state SET epoch = 'rebuilt' WHERE id = 1");
    await B.syncNow();
    assert.ok(B.data.tenants.some((x) => x.id === "ten_mw_sql"), "reloaded (the row had no change-log entry)");
    await mwClient.query("DELETE FROM commerceos.tenants WHERE id = 'ten_mw_sql'");
    await mwClient.query("UPDATE commerceos.store_state SET pruned_through = 1000000000 WHERE id = 1");
    await B.syncNow();
    assert.ok(!B.data.tenants.some((x) => x.id === "ten_mw_sql"), "reloaded again after the prune mark passed its position");
    await mwClient.query("UPDATE commerceos.store_state SET pruned_through = 0 WHERE id = 1");
  });

  await runTest("rate limits are shared: hits on one server count on the other", async () => {
    const key = `p4:shared:${Date.now()}`;
    for (let i = 0; i < 3; i++) await A.rateLimitHit(key, 60_000, Date.now());
    const hit = await B.rateLimitHit(key, 60_000, Date.now());
    assert.ok(hit, "shared counters exist on the Postgres store");
    assert.strictEqual(hit.current, 4);
    const stored = await mwClient.query<{ n: string }>("SELECT count(*)::text AS n FROM commerceos.rate_limits WHERE key = $1", [key]);
    assert.strictEqual(stored.rows[0].n, "1", "one row per key and window");
  });

  await runTest("the campaign kill switch is stored: set on one server, it holds on the other (and survives a restart)", async () => {
    await A.unit(async () => {
      A.setCampaignKillSwitch("ten_mw", true);
      return true;
    }, commitAll);
    await B.syncNow();
    assert.strictEqual(B.isCampaignKillSwitchActive("ten_mw"), true);
    assert.strictEqual(B.isCampaignKillSwitchActive("ten_other"), false);
    const restarted = await openStore(mwClient);
    assert.strictEqual(restarted.isCampaignKillSwitchActive("ten_mw"), true);
    await restarted.shutdown();
  });

  await runTest("a backfill refuses while an app server is writing to the target", async () => {
    await assert.rejects(backfillStore({ tenants: [] }, mwClient, { replace: true, onRejected: "throw" }), /Stop every app server/);
  });
  await A.shutdown();
  await B.shutdown();

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

  await runTest("a non-empty target needs --replace; replace restores it exactly", async () => {
    await assert.rejects(backfillStore(source, target, { replace: false, onRejected: "throw" }), /already holds/);
    await backfillStore(source, target, { replace: true, onRejected: "throw" });
    assert.ok((await verifyStore(source, target)).pass);
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

  await runTest("every rate limit is awaited (an un-awaited check would silently allow everything)", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (rel === "src/lib/rate-limit.ts") continue;
      fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/(?<![\w.])enforceRateLimit\(/.test(line) && !/await enforceRateLimit\(/.test(line) && !/import /.test(line)) hits.push(`${rel}:${i + 1}`);
        // checkRateLimit results are awaited directly, or all together (the widget's Promise.all)
        if (
          /(?<![\w.])checkRateLimit\(/.test(line) &&
          !/await checkRateLimit\(|import |(public|private|function) checkRateLimit\(/.test(line) &&
          rel !== "src/app/api/v1/social/widget/message/route.ts"
        ) {
          hits.push(`${rel}:${i + 1}`);
        }
      });
    }
    assert.deepStrictEqual(hits, []);
  });

  await runTest("every API route handler runs through withStore (units of work, ADR-109)", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, "src/app"))) {
      if (!file.endsWith("route.ts")) continue;
      const text = fs.readFileSync(file, "utf8");
      if (/^export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/m.test(text)) missing.push(path.relative(ROOT, file));
      for (const m of text.matchAll(/^export const (GET|POST|PUT|PATCH|DELETE) = (\w+)\(/gm)) {
        if (m[2] !== "withStore") missing.push(`${path.relative(ROOT, file)} ${m[1]}`);
      }
    }
    assert.deepStrictEqual(missing, []);
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
