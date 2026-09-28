/**
 * Phase 3 truthfulness suite (FIX_IMPLEMENTATION_PLAN FX-30, FX-31, FX-39 and audit N11).
 * Unknown values are null / NOT_MEASURED; unfinished integrations report NOT_SENT / NOT_VERIFIED, never success; the
 * enterprise read endpoints use the caller's real role and scope.
 * Run: node tests/ts-runner.cjs ./tests/phase3-truthfulness-tests.ts
 */
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { signSessionToken } from "@/lib/security";
import { RoleName } from "@/lib/permissions";
import { enterpriseHierarchyService } from "@/domains/enterprise/services/enterprise-hierarchy.service";
import { webhookPlatformService } from "@/domains/enterprise/services/webhook-platform.service";
import { ConnectorService } from "@/domains/connectors/service";
import { N8nProviderService } from "@/domains/automation/services/n8n-provider.service";
import { GetOrderStatusTool } from "@/domains/ai/tools/implementations/order-tools";
import type { Order } from "@/types/commerce";

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

const BASE = "http://localhost:3000/api/v1";
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
const nowIso = () => new Date().toISOString();

async function member(tenantId: string, role: RoleName): Promise<{ id: string; token: string }> {
  const id = uid(`usr_p3_${role.toLowerCase()}`);
  const email = `${id}@phase3.test`;
  db.createUser({ id, email, name: `P3 ${role}`, password_hash: "!disabled", status: "ACTIVE", created_at: nowIso(), updated_at: nowIso() });
  db.createMembership({ id: `mem_${id}`, tenant_id: tenantId, user_id: id, role, created_at: nowIso(), updated_at: nowIso() });
  return { id, token: await signSessionToken({ userId: id, tenantId, role, email, name: `P3 ${role}` }) };
}

type Handler = (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

async function call(method: "GET" | "POST", route: string, token: string, opts: { query?: string; body?: unknown; id?: string } = {}) {
  const mod = (await import(`@/app/api/v1/${route}/route`)) as Partial<Record<"GET" | "POST", Handler>>;
  const handler = mod[method];
  if (!handler) throw new Error(`${method} ${route} is not exported`);
  const url = `${BASE}/${opts.id ? route.replace("[id]", opts.id) : route}${opts.query ?? ""}`;
  const res = await handler(
    new Request(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
    }),
    { params: Promise.resolve({ id: opts.id ?? "" }) }
  );
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string } };
  return { status: res.status, json };
}

function order(tenantId: string, grandTotal: number): Order {
  return db.createOrder(
    {
      id: uid("ord_p3"),
      tenant_id: tenantId,
      order_number: uid("P3"),
      customer_id: uid("cus_p3"),
      status: "CONFIRMED",
      currency: "BDT",
      subtotal: grandTotal,
      discount_total: 0,
      shipping_total: 60,
      tax_total: 0,
      grand_total: grandTotal,
      payment_method: "COD",
      payment_status: "UNPAID",
      fulfillment_status: "UNFULFILLED",
      shipping_address_snapshot: { district: "Dhaka", division: "Dhaka" },
      source: "WEBSITE",
      created_at: nowIso(),
      updated_at: nowIso(),
    } as Order,
    []
  );
}

/** Every .ts/.tsx file under src, for the grep gate. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 3: TRUTHFUL DATA & WIRING         ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);
  db.clearAllForTesting();

  const shop = await AuthService.registerTenantWithOwner({
    email: `${uid("owner")}@phase3.test`,
    password: "Phase3-Owner-Pass-5521!",
    name: "Phase 3 Owner",
    workspaceName: `Phase 3 Shop ${Date.now()}`,
  });
  const tenantId = shop.tenant.id;
  const owner = await member(tenantId, "OWNER");
  const admin = await member(tenantId, "ADMIN");
  const scopedAdmin = await member(tenantId, "ADMIN");
  const suspendedAdmin = await member(tenantId, "ADMIN");

  // An organization owned by this workspace, with two stores under one brand
  const orgId = uid("org_p3");
  db.createOrganization({
    id: orgId, tenant_id: tenantId, name: "P3 Holdings", slug: orgId, legal_name: "P3 Holdings Ltd.", default_currency: "BDT",
    supported_currencies: ["BDT"], headquarters_country: "Bangladesh", status: "ACTIVE", created_at: nowIso(), updated_at: nowIso(),
  });
  enterpriseHierarchyService.createBusinessUnit(orgId, { id: `${orgId}_bu`, name: "Retail", code: "RT" });
  enterpriseHierarchyService.createBrand(orgId, { id: `${orgId}_br`, business_unit_id: `${orgId}_bu`, name: "Brand", slug: "brand", primary_category: "Apparel" });
  const storeFields = { business_unit_id: `${orgId}_bu`, brand_id: `${orgId}_br`, store_type: "ONLINE_STORE" as const, region: "Dhaka", city: "Dhaka", currency: "BDT" };
  const storeA = enterpriseHierarchyService.createStore(orgId, { ...storeFields, id: `${orgId}_sa`, name: "Store A", code: "SA" });
  const storeB = enterpriseHierarchyService.createStore(orgId, { ...storeFields, id: `${orgId}_sb`, name: "Store B", code: "SB" });
  const membership = (userId: string, status: "ACTIVE" | "SUSPENDED", storeIds: string[]) =>
    db.createEnterpriseUser({
      id: uid("eu_p3"), organization_id: orgId, user_id: userId, name: "Member", email: `${userId}@phase3.test`,
      enterprise_role: "STORE_MANAGER", assigned_scope: { organization_id: orgId, store_ids: storeIds, all_access: false },
      status, created_at: nowIso(), updated_at: nowIso(),
    });
  membership(scopedAdmin.id, "ACTIVE", [storeA.id]);
  membership(suspendedAdmin.id, "SUSPENDED", [storeA.id, storeB.id]);

  // ---------------------------------------------------------------------------
  console.log(`${ANSI_BOLD}[N11] Enterprise reads use the caller's real role and scope${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("workspace OWNER without a membership sees the whole organization", async () => {
    const res = await call("GET", "enterprise/benchmarks", owner.token);
    assert.strictEqual(res.status, 200);
    const ids = (res.json.data?.items as Array<{ entity_id: string }>).map((i) => i.entity_id).sort();
    assert.deepStrictEqual(ids, [storeA.id, storeB.id].sort());
  });

  await runTest("a membership scoped to one store limits benchmarks and analytics to that store", async () => {
    const bench = await call("GET", "enterprise/benchmarks", scopedAdmin.token);
    assert.strictEqual(bench.status, 200);
    assert.deepStrictEqual((bench.json.data?.items as Array<{ entity_id: string }>).map((i) => i.entity_id), [storeA.id]);
    const analytics = await call("GET", "enterprise/analytics", scopedAdmin.token);
    assert.strictEqual(analytics.status, 200);
    const data = analytics.json.data as { entities: Array<{ entity_id: string }>; total_revenue_bdt: unknown; scope: string };
    assert.deepStrictEqual(data.entities.map((e) => e.entity_id), [storeA.id]);
    // Workspace-wide revenue can't be narrowed to one store, so a scoped member doesn't get it
    assert.strictEqual(data.scope, "PARTIAL");
    assert.strictEqual(data.total_revenue_bdt, null);
  });

  await runTest("organization-wide analytics are real sums, not fixed channel or regional shares", async () => {
    order(tenantId, 1000);
    order(tenantId, 500);
    const res = await call("GET", "enterprise/analytics", owner.token);
    assert.strictEqual(res.status, 200);
    const data = res.json.data as {
      total_revenue_bdt: number; channel_distribution: Record<string, number>; regional_distribution: Record<string, number>;
      entities: Array<{ revenue_bdt: unknown; delivery_sla_pct: unknown }>; entity_data_status: string;
    };
    assert.strictEqual(data.total_revenue_bdt, 1500);
    assert.deepStrictEqual(data.channel_distribution, { WEBSITE: 1500 });
    assert.deepStrictEqual(data.regional_distribution, { Dhaka: 1500 });
    assert.strictEqual(data.entity_data_status, "NOT_MEASURED");
    assert.ok(data.entities.every((e) => e.revenue_bdt === null && e.delivery_sla_pct === null));
  });

  await runTest("a suspended membership is refused (403), not upgraded to all-access", async () => {
    assert.strictEqual((await call("GET", "enterprise/benchmarks", suspendedAdmin.token)).status, 403);
    assert.strictEqual((await call("GET", "enterprise/analytics", suspendedAdmin.token)).status, 403);
  });

  await runTest("benchmarks list entities without invented values (NOT_MEASURED)", async () => {
    const res = await call("GET", "enterprise/benchmarks", admin.token, { query: "?type=BRAND" });
    assert.strictEqual(res.status, 200);
    const data = res.json.data as { data_status: string; cohort_average: unknown; items: Array<{ value: unknown; rank: unknown }> };
    assert.strictEqual(data.data_status, "NOT_MEASURED");
    assert.strictEqual(data.cohort_average, null);
    assert.ok(data.items.length === 1 && data.items.every((i) => i.value === null && i.rank === null));
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-31] Integrations report what actually happened${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("a shipment needs the courier's tracking number and is recorded as a MANUAL booking", async () => {
    const o = order(tenantId, 1200);
    const missing = await call("POST", "shipments", owner.token, { body: { order_id: o.id, courier_provider: "PATHAO" } });
    assert.strictEqual(missing.status, 400);
    assert.strictEqual(db.getShipments(tenantId, o.id).length, 0, "nothing invented");
    const ok = await call("POST", "shipments", owner.token, { body: { order_id: o.id, courier_provider: "PATHAO", tracking_number: "PTH123456" } });
    assert.strictEqual(ok.status, 201);
    const shipment = ok.json.data?.shipment as { tracking_number: string; booking_mode: string };
    assert.strictEqual(shipment.tracking_number, "PTH123456");
    assert.strictEqual(shipment.booking_mode, "MANUAL");
  });

  await runTest("the order-status tool names no courier, tracking code or estimate the records don't have", async () => {
    const o = order(tenantId, 900);
    const ctx = await AuthService.resolveRequestContext(owner.token);
    assert.ok(ctx);
    const result = (await new GetOrderStatusTool().execute(ctx, { order_number: o.order_number })) as Record<string, unknown>;
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.courier_name, null);
    assert.strictEqual(result.courier_tracking_code, null);
    assert.strictEqual(result.estimated_delivery, null);
    assert.strictEqual(result.shipment_status, "NOT_SHIPPED");
  });

  await runTest("enterprise integrations: saved NOT_VERIFIED, credentials never returned, sync refused (424)", async () => {
    const installed = await call("POST", "enterprise/integrations", admin.token, {
      body: { provider_id: "prov_sap_s4hana", credentials: { api_key: "p3-secret-value-4411" } },
    });
    assert.strictEqual(installed.status, 201);
    assert.strictEqual(installed.json.data?.status, "NOT_VERIFIED");
    assert.ok(!("credentials_encrypted" in (installed.json.data ?? {})));
    const stored = db.getIntegrationInstallations(orgId).find((i) => i.id === installed.json.data?.id);
    assert.ok(stored && !Buffer.from(stored.credentials_encrypted, "base64").toString("utf8").includes("p3-secret-value-4411"), "encrypted, not base64");

    const list = await call("GET", "enterprise/integrations", admin.token);
    assert.strictEqual(list.status, 200);
    assert.ok(!JSON.stringify(list.json).includes("credentials_encrypted"));

    const syncsBefore = db.getIntegrationSyncs(orgId).length;
    const sync = await call("POST", "enterprise/integrations/[id]/sync", admin.token, { id: String(installed.json.data?.id) });
    assert.strictEqual(sync.status, 424);
    assert.strictEqual(sync.json.error?.code, "INTEGRATION_NOT_CONFIGURED");
    assert.strictEqual(db.getIntegrationSyncs(orgId).length, syncsBefore, "no placeholder sync recorded");
  });

  await runTest("enterprise webhooks: the secret is shown once at creation, never in the list; dispatch is NOT_SENT", async () => {
    const created = await call("POST", "enterprise/webhooks", owner.token, { body: { url: "https://hooks.example.org/in", events: ["order.created"] } });
    assert.strictEqual(created.status, 201);
    assert.ok(String(created.json.data?.secret).startsWith("whsec_"));
    const list = await call("GET", "enterprise/webhooks", owner.token);
    assert.ok(!JSON.stringify(list.json).includes("whsec_"));
    const deliveries = await webhookPlatformService.dispatchEvent({ organizationId: orgId, eventType: "order.created", payload: { id: 1 } });
    assert.ok(deliveries.length >= 1 && deliveries.every((d) => d.status === "NOT_SENT" && d.http_status === undefined && d.duration_ms === null));
  });

  await runTest("connector tests without a live check are NOT_VERIFIED with no latency", async () => {
    const ctx = await AuthService.resolveRequestContext(owner.token);
    assert.ok(ctx);
    const redis = await ConnectorService.testConnection(ctx, {
      provider_id: "upstash_redis",
      credentials: { rest_url: "https://p3-demo.upstash.io", rest_token: "p3-token-value" },
    });
    assert.strictEqual(redis.status, "NOT_VERIFIED");
    assert.strictEqual(redis.success, false);
    assert.strictEqual(redis.latency_ms, null);
  });

  await runTest("n8n: an unreachable instance fails the execution (no localhost 'mock success')", async () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;
    try {
      const result = await N8nProviderService.invokeWorkflow({
        tenantId, automationId: uid("auto_p3"), workflowId: uid("wf_p3"), workflowVersionId: "v1",
        webhookPath: "p3-test", event: { type: "p3" }, correlationId: uid("corr"), idempotencyKey: uid("idem"),
        executionMode: "PRODUCTION",
      });
      assert.strictEqual(calls.length, 1, "a real request was attempted");
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.execution.status, "FAILED");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-30 / FX-39] No fabricated metrics${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("Command Center metrics for a workspace with no history are empty or null, not made up", async () => {
    const fresh = await AuthService.registerTenantWithOwner({
      email: `${uid("fresh")}@phase3.test`, password: "Phase3-Fresh-Pass-8812!", name: "Fresh", workspaceName: `Fresh ${Date.now()}`,
    });
    const m = db.getDashboardMetrics(fresh.tenant.id);
    assert.strictEqual(m.totalOrders, 0);
    assert.strictEqual(m.totalRevenue, 0);
    assert.strictEqual(m.returningBuyerPercent, null);
    assert.strictEqual(m.periodComparison.revenue_change_pct, null);
    assert.strictEqual(m.periodComparison.orders_change_pct, null);
    assert.ok(m.channelData.every((c) => c.conversion === null && c.orders === 0));
    assert.strictEqual(m.recentOrders.length, 0);
  });

  await runTest("grep gate: known fabrication patterns are gone from src/", () => {
    const patterns: Array<[RegExp, string]> = [
      [/baselineGMV|syntheticBase/, "synthetic baselines"],
      [/period_change_pct:\s*[0-9]/, "literal period change"],
      [/\?\?\s*(4999|2450000|18420|1420|184500)\b/, "literal metric fallbacks"],
      [/Math\.random\(\)\s*\*\s*\d+\s*\+\s*\d+\)/, "random latencies"],
      [/STF-2026-PENDING|"Steadfast Courier \/ Pathao"/, "invented courier"],
      [/target_url\.includes\("fail"\)/, "URL-based fake delivery"],
      [/(idx|index)\s*\*\s*[0-9.]+\)*[,;]?\s*$/m, "per-position invented values"],
      [/totalRevenue \* 0\.\d+/, "fixed revenue shares"],
      [/assigned_scope:\s*\{[^}]*all_access:\s*true[^}]*\},?\s*\n\s*status:\s*"ACTIVE"/, "synthetic all-access caller"],
    ];
    const allowed = new Set([path.normalize("src/domains/enterprise/organization-access.ts")]);
    const hits: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = fs.readFileSync(file, "utf8");
      for (const [re, label] of patterns) {
        if (re.test(text) && !(label === "synthetic all-access caller" && allowed.has(path.normalize(file)))) {
          hits.push(`${file}: ${label}`);
        }
      }
    }
    assert.deepStrictEqual(hits, []);
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Phase 3 truthfulness suite crashed:", err);
  process.exit(1);
});
