/**
 * Benchmark: Cold Boot Time & Memory Consumption
 * Compares Full Hydration vs Selective Hydration (Path A).
 */
import { createPgliteClient } from "../src/infrastructure/store/pglite-client";
import { runMigrations } from "../src/infrastructure/store/migrations";
import { PgStorePersistence } from "../src/infrastructure/store/pg-store";
import { qualified } from "../src/infrastructure/store/store-schema";

async function runBenchmark() {
  console.log("====================================================");
  console.log("   COMMERCEOS HYDRATION BENCHMARK (PHASE B)          ");
  console.log("====================================================\n");

  const client = createPgliteClient();
  await runMigrations(client);

  console.log("Seeding Postgres with historical enterprise dataset (20,000 records)...");
  const tenantId = "ten_benchmark";
  await client.query(
    `INSERT INTO ${qualified("tenants")} (id, tenant_id, created_at, data) VALUES ($1, $1, now(), $2)`,
    [tenantId, JSON.stringify({ id: tenantId, name: "Benchmark Tenant", currency: "BDT" })]
  );

  // Seed 10,000 audit logs
  console.log(" - Inserting 10,000 historical audit logs into commerceos.audit_logs...");
  const auditIds: string[] = [];
  const auditTenants: string[] = [];
  const auditDates: string[] = [];
  const auditData: string[] = [];
  for (let i = 0; i < 10000; i++) {
    const id = `aud_bench_${i}`;
    auditIds.push(id);
    auditTenants.push(tenantId);
    auditDates.push(new Date(Date.now() - i * 60000).toISOString());
    auditData.push(
      JSON.stringify({
        id,
        tenant_id: tenantId,
        actor_user_id: "usr_bench",
        action: "ORDER_UPDATED",
        resource_type: "ORDER",
        resource_id: `ord_${i}`,
        metadata: { ip: "127.0.0.1", user_agent: "Mozilla/5.0 Enterprise Browser" },
        created_at: new Date(Date.now() - i * 60000).toISOString(),
      })
    );
  }
  await client.query(
    `INSERT INTO ${qualified("audit_logs")} (id, tenant_id, created_at, data)
     SELECT u.id, u.tenant_id, u.created_at, u.data
     FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::jsonb[]) AS u(id, tenant_id, created_at, data)`,
    [auditIds, auditTenants, auditDates, auditData]
  );

  // Seed 5,000 ai_traces into documents
  console.log(" - Inserting 5,000 ai_traces into commerceos.documents...");
  const traceIds: string[] = [];
  const traceCollections: string[] = [];
  const traceTenants: string[] = [];
  const traceDates: string[] = [];
  const traceData: string[] = [];
  for (let i = 0; i < 5000; i++) {
    const id = `trace_bench_${i}`;
    traceIds.push(id);
    traceCollections.push("ai_traces");
    traceTenants.push(tenantId);
    traceDates.push(new Date(Date.now() - i * 60000).toISOString());
    traceData.push(
      JSON.stringify({
        id,
        tenant_id: tenantId,
        agent_type: "CUSTOMER_SUPPORT",
        input_prompt: "Where is my order #12345? Customer requesting status update.",
        output_response: "Your order #12345 is currently processing and will be delivered by tomorrow.",
        latency_ms: 320,
        tokens_used: 154,
      })
    );
  }
  await client.query(
    `INSERT INTO commerceos.documents (id, collection, tenant_id, created_at, data)
     SELECT u.id, u.collection, u.tenant_id, u.created_at, u.data
     FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::jsonb[]) AS u(id, collection, tenant_id, created_at, data)`,
    [traceIds, traceCollections, traceTenants, traceDates, traceData]
  );

  // Seed 5,000 csp_reports into documents
  console.log(" - Inserting 5,000 csp_reports into commerceos.documents...\n");
  const cspIds: string[] = [];
  const cspCollections: string[] = [];
  const cspTenants: string[] = [];
  const cspDates: string[] = [];
  const cspData: string[] = [];
  for (let i = 0; i < 5000; i++) {
    const id = `csp_bench_${i}`;
    cspIds.push(id);
    cspCollections.push("csp_reports");
    cspTenants.push(tenantId);
    cspDates.push(new Date(Date.now() - i * 60000).toISOString());
    cspData.push(
      JSON.stringify({
        id,
        tenant_id: tenantId,
        directive: "script-src",
        blocked_uri: "https://evil.tracker.com/pixel.js",
        status: "BLOCKED",
      })
    );
  }
  await client.query(
    `INSERT INTO commerceos.documents (id, collection, tenant_id, created_at, data)
     SELECT u.id, u.collection, u.tenant_id, u.created_at, u.data
     FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::jsonb[]) AS u(id, collection, tenant_id, created_at, data)`,
    [cspIds, cspCollections, cspTenants, cspDates, cspData]
  );

  if (global.gc) global.gc();

  // Test 1: Full Hydration
  console.log("Running Test 1: Full Hydration (Legacy Path)...");
  const memBeforeFull = process.memoryUsage().heapUsed;
  const startFull = performance.now();
  const pgFull = new PgStorePersistence(client);
  const loadedFull = await pgFull.load({ all: true });
  const durationFull = performance.now() - startFull;
  const memAfterFull = process.memoryUsage().heapUsed;
  const memDeltaFullMb = (memAfterFull - memBeforeFull) / (1024 * 1024);

  let fullRecordCount = 0;
  for (const val of Object.values(loadedFull)) {
    if (Array.isArray(val)) fullRecordCount += val.length;
  }

  // Force Garbage Collection if available
  if (global.gc) global.gc();

  // Test 2: Selective Hydration (Path A)
  console.log("Running Test 2: Selective Hydration (Path A)...");
  const memBeforeSelective = process.memoryUsage().heapUsed;
  const startSelective = performance.now();
  const pgSelective = new PgStorePersistence(client);
  const loadedSelective = await pgSelective.load();
  const durationSelective = performance.now() - startSelective;
  const memAfterSelective = process.memoryUsage().heapUsed;
  const memDeltaSelectiveMb = (memAfterSelective - memBeforeSelective) / (1024 * 1024);

  let selectiveRecordCount = 0;
  for (const val of Object.values(loadedSelective)) {
    if (Array.isArray(val)) selectiveRecordCount += val.length;
  }

  console.log("\n====================================================");
  console.log("                  BENCHMARK RESULTS                 ");
  console.log("====================================================");
  console.table([
    {
      Strategy: "Full Hydration (Legacy)",
      "Boot Load Time": `${durationFull.toFixed(2)} ms`,
      "Records Hydrated in RAM": fullRecordCount.toLocaleString(),
      "Heap Delta": `${memDeltaFullMb.toFixed(2)} MB`,
    },
    {
      Strategy: "Selective Hydration (Path A)",
      "Boot Load Time": `${durationSelective.toFixed(2)} ms`,
      "Records Hydrated in RAM": selectiveRecordCount.toLocaleString(),
      "Heap Delta": `${memDeltaSelectiveMb.toFixed(2)} MB`,
    },
  ]);

  const timeReduction = ((durationFull - durationSelective) / durationFull) * 100;
  const memoryReduction = ((fullRecordCount - selectiveRecordCount) / fullRecordCount) * 100;
  console.log(`\nBoot Time Reduction: ${timeReduction.toFixed(1)}% faster`);
  console.log(`RAM Hydration Reduction: ${memoryReduction.toFixed(1)}% fewer records loaded at startup`);
  console.log("====================================================\n");

  await client.close();
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
