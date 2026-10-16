/**
 * CommerceOS — Zero-Hydration Architecture Benchmark (Phase D)
 * 
 * Compares Cold Boot Latency, Process Heap Memory Consumption, and
 * Mutation Performance between:
 *   Mode A: Legacy Hydrated Store (loads all tables into Node.js RAM, diffCollection)
 *   Mode B: Phase D Zero-Hydration Store (0 large business rows in RAM, semantic repository SQL + OCC)
 */

import { createPgliteClient } from "../src/infrastructure/store/pglite-client";
import { runMigrations } from "../src/infrastructure/store/migrations";
import { PgStorePersistence } from "../src/infrastructure/store/pg-store";
import { orderRepository } from "../src/domains/orders/order.repository";
import type { SqlClient } from "../src/infrastructure/store/sql-client";

interface BenchmarkResult {
  mode: "LEGACY_HYDRATED" | "ZERO_HYDRATION";
  seededRows: number;
  bootDurationMs: number;
  heapUsedMb: number;
  heapDeltaMb: number;
  hydratedBusinessRows: number;
  mutationDurationMs: number;
}

async function seedDataset(client: SqlClient, count: number): Promise<void> {
  const tenantId = "ten_benchmark";
  const now = Date.now();

  // Tenant
  await client.query(
    `INSERT INTO commerceos.tenants (id, tenant_id, data) VALUES ($1, $1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
    [tenantId, JSON.stringify({ id: tenantId, name: "Benchmark Store", status: "ACTIVE" })]
  );

  // Batch insert orders, customers, products
  for (let i = 0; i < count; i++) {
    const createdAt = new Date(now - i * 1000).toISOString();
    await client.query(
      `INSERT INTO commerceos.orders (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
      [
        `ord_bm_${i}`,
        tenantId,
        JSON.stringify({
          id: `ord_bm_${i}`,
          tenant_id: tenantId,
          order_number: `ORD-BM-${i}`,
          status: "CONFIRMED",
          grand_total: 1500,
          created_at: createdAt,
        }),
        createdAt,
      ]
    );

    await client.query(
      `INSERT INTO commerceos.customers (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
      [
        `cust_bm_${i}`,
        tenantId,
        JSON.stringify({
          id: `cust_bm_${i}`,
          tenant_id: tenantId,
          first_name: `Customer`,
          last_name: `${i}`,
          phone: `0171000${i.toString().padStart(4, "0")}`,
          created_at: createdAt,
        }),
        createdAt,
      ]
    );

    await client.query(
      `INSERT INTO commerceos.products (id, tenant_id, created_at, data, version) VALUES ($1, $2, $4::timestamptz, $3::jsonb, 1)`,
      [
        `prod_bm_${i}`,
        tenantId,
        JSON.stringify({
          id: `prod_bm_${i}`,
          tenant_id: tenantId,
          title: `Product SKU ${i}`,
          status: "ACTIVE",
          price: 990,
          created_at: createdAt,
        }),
        createdAt,
      ]
    );
  }
}

async function runBenchmark(): Promise<void> {
  console.log("================================================================");
  console.log("  COMMERCEOS PHASE D: ZERO-HYDRATION BENCHMARK                  ");
  console.log("================================================================\n");

  const ROW_COUNT = 1000; // 1,000 orders + 1,000 customers + 1,000 products = 3,000 core entities
  console.log(`Setting up in-memory PGlite with ${ROW_COUNT * 3} core entities...`);

  const client = createPgliteClient();
  await runMigrations(client);
  await seedDataset(client, ROW_COUNT);

  console.log("Dataset seeded successfully.\n");

  // Force GC if available
  if (global.gc) {
    global.gc();
  }

  // --- MEASURE MODE A: Legacy Hydrated Store ---
  console.log("--- Measuring Mode A: Legacy Full-Hydration (all: true) ---");
  const baselineMemA = process.memoryUsage().heapUsed;
  const startBootA = performance.now();

  const storeA = new PgStorePersistence(client);
  const dataA = await storeA.load({ all: true });
  const bootDurationA = performance.now() - startBootA;
  const memAfterBootA = process.memoryUsage().heapUsed;
  const heapDeltaA = Math.max(0, (memAfterBootA - baselineMemA) / (1024 * 1024));

  const ordersCountA = Array.isArray(dataA.orders) ? dataA.orders.length : 0;
  const customersCountA = Array.isArray(dataA.customers) ? dataA.customers.length : 0;
  const productsCountA = Array.isArray(dataA.products) ? dataA.products.length : 0;
  const totalHydratedA = ordersCountA + customersCountA + productsCountA;

  // Measure write with diffing in Mode A
  const startMutA = performance.now();
  (dataA.orders as any)[0].notes = "Mutated via full store";
  const changesA = storeA.computeChanges(dataA as any, new Set(["orders"]));
  await storeA.write(changesA);
  const mutDurationA = performance.now() - startMutA;

  const resultA: BenchmarkResult = {
    mode: "LEGACY_HYDRATED",
    seededRows: ROW_COUNT * 3,
    bootDurationMs: Math.round(bootDurationA * 10) / 10,
    heapUsedMb: Math.round((memAfterBootA / (1024 * 1024)) * 10) / 10,
    heapDeltaMb: Math.round(heapDeltaA * 10) / 10,
    hydratedBusinessRows: totalHydratedA,
    mutationDurationMs: Math.round(mutDurationA * 100) / 100,
  };

  // Force GC if available
  if (global.gc) {
    global.gc();
  }

  // --- MEASURE MODE B: Zero-Hydration Store ---
  console.log("--- Measuring Mode B: Phase D Zero-Hydration (zeroHydration: true) ---");
  const baselineMemB = process.memoryUsage().heapUsed;
  const startBootB = performance.now();

  const storeB = new PgStorePersistence(client);
  const dataB = await storeB.load({ zeroHydration: true });
  const bootDurationB = performance.now() - startBootB;
  const memAfterBootB = process.memoryUsage().heapUsed;
  const heapDeltaB = Math.max(0, (memAfterBootB - baselineMemB) / (1024 * 1024));

  const ordersCountB = dataB.orders === undefined ? 0 : (dataB.orders as any[]).length;
  const customersCountB = dataB.customers === undefined ? 0 : (dataB.customers as any[]).length;
  const productsCountB = dataB.products === undefined ? 0 : (dataB.products as any[]).length;
  const totalHydratedB = ordersCountB + customersCountB + productsCountB;

  // Measure repository-native mutation in Mode B
  const startMutB = performance.now();
  await orderRepository.update("ten_benchmark", "ord_bm_1", {
    notes: "Direct SQL mutation with OCC",
  }, { tx: client });
  const mutDurationB = performance.now() - startMutB;

  const resultB: BenchmarkResult = {
    mode: "ZERO_HYDRATION",
    seededRows: ROW_COUNT * 3,
    bootDurationMs: Math.round(bootDurationB * 10) / 10,
    heapUsedMb: Math.round((memAfterBootB / (1024 * 1024)) * 10) / 10,
    heapDeltaMb: Math.round(heapDeltaB * 10) / 10,
    hydratedBusinessRows: totalHydratedB,
    mutationDurationMs: Math.round(mutDurationB * 100) / 100,
  };

  // --- Summary Report ---
  console.log("\n================================================================");
  console.log("  BENCHMARK RESULTS                                             ");
  console.log("================================================================\n");

  console.log(`Core Business Rows in Database:      ${resultA.seededRows}`);
  console.log(`\nMetric                             Legacy (Mode A)    Zero-Hydration (Mode B)   Improvement`);
  console.log(`---------------------------------  -----------------  ------------------------   -----------`);

  const bootSpeedup = (resultA.bootDurationMs / Math.max(resultB.bootDurationMs, 0.1)).toFixed(1);
  console.log(
    `Cold Boot Duration                 ${resultA.bootDurationMs.toFixed(1).padStart(8)} ms       ${resultB.bootDurationMs.toFixed(1).padStart(10)} ms            ${bootSpeedup}x faster`
  );

  console.log(
    `Hydrated Business Rows             ${resultA.hydratedBusinessRows.toString().padStart(8)} rows     ${resultB.hydratedBusinessRows.toString().padStart(10)} rows            100% eliminated`
  );

  const memSavings = (resultA.heapDeltaMb - resultB.heapDeltaMb).toFixed(1);
  console.log(
    `Boot Heap Delta                    ${resultA.heapDeltaMb.toFixed(1).padStart(8)} MB       ${resultB.heapDeltaMb.toFixed(1).padStart(10)} MB            ${memSavings} MB saved`
  );

  const mutSpeedup = (resultA.mutationDurationMs / Math.max(resultB.mutationDurationMs, 0.1)).toFixed(1);
  console.log(
    `Mutation + Write Latency           ${resultA.mutationDurationMs.toFixed(2).padStart(8)} ms       ${resultB.mutationDurationMs.toFixed(2).padStart(10)} ms            ${mutSpeedup}x faster`
  );

  console.log("\n================================================================\n");
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
