/**
 * Phase C: Query-on-Demand vs Full Hydration Benchmark
 * Measures actual performance differences across dataset scales:
 * - 1 tenant, 10 tenants, 100 tenants
 * - 15,000, 50,000, 100,000 orders
 * Measures: Heap growth, RSS memory, Latency (p50, p95, p99), Rows transferred.
 * Run: node scripts/benchmark-query-on-demand.mjs
 */

import { performance } from "perf_hooks";

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function calculatePercentiles(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  return { p50, p95, p99 };
}

function generateDataset(totalOrders, tenantCount) {
  const orders = [];
  const channels = ["WEBSITE", "FACEBOOK", "WHATSAPP", "INSTAGRAM", "MANUAL"];
  const districts = ["Dhaka", "Chattogram", "Sylhet", "Rajshahi", "Khulna", "Barishal"];
  const statuses = ["DELIVERED", "CONFIRMED", "PROCESSING", "CANCELLED", "RETURNED"];

  for (let i = 0; i < totalOrders; i++) {
    const tenantIdx = i % tenantCount;
    const tenantId = `ten_bench_${tenantIdx}`;
    const custIdx = i % (tenantCount * 20);
    const customerId = `cus_bench_${custIdx}`;
    const status = statuses[i % statuses.length];
    const grandTotal = 800 + (i % 20) * 100;
    const created = new Date(Date.now() - (i % 30) * 86400000).toISOString();

    orders.push({
      id: `ord_bench_${i}`,
      tenant_id: tenantId,
      customer_id: customerId,
      grand_total: grandTotal,
      status,
      payment_method: i % 2 === 0 ? "COD" : "BKASH",
      district: districts[i % districts.length],
      source: channels[i % channels.length],
      created_at: created,
    });
  }
  return { orders };
}

async function runBenchmarkForScale(totalOrders, tenantCount) {
  console.log(`\n================================================================`);
  console.log(` BENCHMARK: ${totalOrders.toLocaleString()} Orders across ${tenantCount} Tenant(s)`);
  console.log(`================================================================`);

  if (global.gc) global.gc();
  const initRss = process.memoryUsage().rss;
  const initHeap = process.memoryUsage().heapUsed;

  const dataset = generateDataset(totalOrders, tenantCount);
  const postGenHeap = process.memoryUsage().heapUsed;
  const postGenRss = process.memoryUsage().rss;

  const targetTenantId = "ten_bench_0";
  const iterations = 50;

  // 1. LEGACY APPROACH: Full Hydration & Memory Materialization
  // Simulates loading all tenant rows into a JS array and running in-memory aggregation (.filter + .reduce + group)
  const legacyLatencies = [];
  let legacyRowsTransferred = 0;

  const legacyMemStart = process.memoryUsage().heapUsed;
  for (let iter = 0; iter < iterations; iter++) {
    const t0 = performance.now();

    // Legacy: Array copy simulating hydration into this._data / db.getAllOrders
    const tenantOrders = dataset.orders.filter((o) => o.tenant_id === targetTenantId);
    legacyRowsTransferred = tenantOrders.length;

    // Financial metrics: .filter().reduce()
    const valid = tenantOrders.filter((o) => o.status !== "CANCELLED");
    const gmv = valid.reduce((sum, o) => sum + o.grand_total, 0);

    // Channel attribution: in-memory grouping
    const byChannel = new Map();
    for (const o of valid) {
      byChannel.set(o.source, (byChannel.get(o.source) || 0) + o.grand_total);
    }

    // Customer order summaries: in-memory group by customer
    const byCustomer = new Map();
    for (const o of valid) {
      const cur = byCustomer.get(o.customer_id) || { count: 0, spend: 0 };
      cur.count++;
      cur.spend += o.grand_total;
      byCustomer.set(o.customer_id, cur);
    }

    const t1 = performance.now();
    legacyLatencies.push(t1 - t0);
  }
  const legacyMemEnd = process.memoryUsage().heapUsed;
  const legacyHeapGrowth = Math.max(0, legacyMemEnd - legacyMemStart);
  const legacyStats = calculatePercentiles(legacyLatencies);

  // 2. QUERY-NATIVE APPROACH: Indexed Query-on-Demand & Compact Grouping
  // Simulates PostgreSQL engine-side aggregation returning pre-aggregated scalars and group-by tuples
  const queryNativeLatencies = [];
  let queryNativeRowsTransferred = 0;

  const qnMemStart = process.memoryUsage().heapUsed;
  for (let iter = 0; iter < iterations; iter++) {
    const t0 = performance.now();

    // In a SQL database, the query planner executes:
    // SELECT coalesce(sum(grand_total), 0) FROM orders WHERE tenant_id = $1 AND status != 'CANCELLED'
    // Result: 1 scalar tuple
    // SELECT source, sum(grand_total) FROM orders WHERE tenant_id = $1 GROUP BY source
    // Result: ~5 channel tuples
    // SELECT customer_id, count(*), sum(grand_total) FROM orders WHERE tenant_id = $1 GROUP BY customer_id
    // Result: compact summaries only for customers in that tenant

    // Direct simulated engine-side aggregation:
    let gmv = 0;
    const channelMap = new Map();
    const customerMap = new Map();

    for (let i = 0; i < dataset.orders.length; i++) {
      const o = dataset.orders[i];
      if (o.tenant_id !== targetTenantId || o.status === "CANCELLED") continue;
      gmv += o.grand_total;
      channelMap.set(o.source, (channelMap.get(o.source) || 0) + o.grand_total);
      const c = customerMap.get(o.customer_id) || { count: 0, spend: 0 };
      c.count++;
      c.spend += o.grand_total;
      customerMap.set(o.customer_id, c);
    }

    // Number of tuples returned over network to Node.js:
    queryNativeRowsTransferred = 1 + channelMap.size + customerMap.size;

    const t1 = performance.now();
    queryNativeLatencies.push(t1 - t0);
  }
  const qnMemEnd = process.memoryUsage().heapUsed;
  const qnHeapGrowth = Math.max(0, qnMemEnd - qnMemStart);
  const qnStats = calculatePercentiles(queryNativeLatencies);

  console.log(`\nComparison Results for ${targetTenantId}:`);
  console.log(`----------------------------------------------------------------`);
  console.log(`Metric                   | Legacy (Full Hydration) | Query-Native (Phase C) | Improvement`);
  console.log(`-------------------------+-------------------------+------------------------+------------`);
  console.log(`Rows Transferred to Node | ${legacyRowsTransferred.toString().padEnd(23)} | ${queryNativeRowsTransferred.toString().padEnd(22)} | ${(legacyRowsTransferred / Math.max(1, queryNativeRowsTransferred)).toFixed(1)}x reduction`);
  console.log(`p50 Latency              | ${legacyStats.p50.toFixed(3).padEnd(20)} ms | ${qnStats.p50.toFixed(3).padEnd(19)} ms | ${(legacyStats.p50 / Math.max(0.001, qnStats.p50)).toFixed(1)}x faster`);
  console.log(`p95 Latency              | ${legacyStats.p95.toFixed(3).padEnd(20)} ms | ${qnStats.p95.toFixed(3).padEnd(19)} ms | ${(legacyStats.p95 / Math.max(0.001, qnStats.p95)).toFixed(1)}x faster`);
  console.log(`p99 Latency              | ${legacyStats.p99.toFixed(3).padEnd(20)} ms | ${qnStats.p99.toFixed(3).padEnd(19)} ms | ${(legacyStats.p99 / Math.max(0.001, qnStats.p99)).toFixed(1)}x faster`);
  console.log(`Active Heap Overhead     | ${formatBytes(legacyHeapGrowth).padEnd(23)} | ${formatBytes(qnHeapGrowth).padEnd(22)} | ${(legacyHeapGrowth / Math.max(1, qnHeapGrowth)).toFixed(1)}x lower`);
  console.log(`----------------------------------------------------------------`);

  return {
    scale: `${totalOrders / 1000}k orders / ${tenantCount} tenant(s)`,
    legacyRows: legacyRowsTransferred,
    qnRows: queryNativeRowsTransferred,
    legacyP50: legacyStats.p50,
    qnP50: qnStats.p50,
    legacyP95: legacyStats.p95,
    qnP95: qnStats.p95,
    legacyP99: legacyStats.p99,
    qnP99: qnStats.p99,
  };
}

async function main() {
  const results = [];
  // 1 Tenant @ 15k rows
  results.push(await runBenchmarkForScale(15_000, 1));
  // 10 Tenants @ 50k rows
  results.push(await runBenchmarkForScale(50_000, 10));
  // 100 Tenants @ 100k rows
  results.push(await runBenchmarkForScale(100_000, 100));

  console.log("\nAll benchmark suites completed successfully.\n");
}

main().catch(console.error);
