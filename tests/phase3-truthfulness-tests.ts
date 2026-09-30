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
import { GetIntegrationStatusTool } from "@/domains/ai/tools/implementations/enterprise-tools";
import type { Order } from "@/types/commerce";
import { ProductService } from "@/domains/catalog/product.service";
import { findDistrict } from "@/lib/bd-geography";
import { encryptCredential } from "@/lib/security";
import { planCredentialMigration } from "@/domains/enterprise/services/credential-migration";
import { cleanDemoTelemetry, type DemoTelemetryData } from "@/infrastructure/db/demo-telemetry-cleanup";
import { fulfillmentOperationsService } from "@/domains/operations/services/fulfillment-operations.service";
import { CreateBusinessObjectiveTool } from "@/domains/ai/tools/implementations/autonomous-tools";
import type { IntegrationInstallation } from "@/types/enterprise";
import { PlatformTenantService } from "@/domains/platform/services/platform-tenant.service";
import { PLATFORM_PERMISSIONS } from "@/lib/permissions";
import type { PlatformContext } from "@/lib/context";
import { applyWarehouseTenancyFix, planWarehouseTenancyFix, type WarehouseTenancyData } from "@/infrastructure/db/warehouse-tenancy-fix";
import { fixFabricatedData } from "@/infrastructure/db/fabricated-data-fix";
import type { Customer, Warehouse } from "@/types/commerce";
import { OrderService } from "@/domains/orders/order.service";
import { ShippingService } from "@/domains/shipping/shipping.service";
import { ReturnService } from "@/domains/returns/return.service";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";
import { PlatformSupportService } from "@/domains/platform/services/platform-support.service";
import { PLATFORM_ROLE_PERMISSIONS } from "@/lib/permissions";
import { signPlatformSessionToken } from "@/lib/security";
import { ModelRouter } from "@/domains/ai/providers/model-router";
import { globalDecisionEngineService } from "@/domains/autonomous/services";
import { isFeatureEnabled } from "@/lib/safety-gate";
import { ResolveSemanticMetricTool } from "@/domains/ai/tools/implementations/enterprise-tools";
import { CalculateCheckoutTool } from "@/domains/ai/tools/implementations/checkout-tools";
import { toolRegistry } from "@/domains/ai/tools/tool-registry";
import { ContextBuilder } from "@/domains/ai/context/context-builder";
import { PricingService } from "@/domains/pricing/pricing.service";

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
  // PLAN_LIMIT_OVERRIDE: this suite adds many members directly; plan limits apply since FX-34
  db.saveTenantEntitlement({ tenant_id: tenantId, entitlement_id: "max_users", value: 1000, is_override: true, updated_at: new Date().toISOString() });
  const owner = await member(tenantId, "OWNER");
  const admin = await member(tenantId, "ADMIN");
  const scopedAdmin = await member(tenantId, "ADMIN");
  const suspendedAdmin = await member(tenantId, "ADMIN");
  const invitedAdmin = await member(tenantId, "ADMIN");
  const manager = await member(tenantId, "MANAGER");

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
  db.createEnterpriseUser({
    id: uid("eu_p3"), organization_id: orgId, user_id: invitedAdmin.id, name: "Invited", email: `${invitedAdmin.id}@phase3.test`,
    enterprise_role: "ENTERPRISE_ADMIN", assigned_scope: { organization_id: orgId, all_access: true },
    status: "INVITED", created_at: nowIso(), updated_at: nowIso(),
  });

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

  await runTest("an invited (not yet accepted) membership is refused too", async () => {
    assert.strictEqual((await call("GET", "enterprise/benchmarks", invitedAdmin.token)).status, 403);
    assert.strictEqual((await call("GET", "enterprise/overview", invitedAdmin.token)).status, 403);
  });

  await runTest("the enterprise overview hides workspace-wide revenue from a store-scoped member", async () => {
    const scoped = await call("GET", "enterprise/overview", scopedAdmin.token);
    assert.strictEqual(scoped.status, 200);
    const m = (scoped.json.data as { summary_metrics: Record<string, unknown> }).summary_metrics;
    assert.strictEqual(m.consolidated_revenue_bdt, null);
    assert.strictEqual(m.consolidated_orders, null);
    assert.strictEqual(m.blended_gross_margin_pct, null);
    const full = await call("GET", "enterprise/overview", owner.token);
    assert.strictEqual(typeof (full.json.data as { summary_metrics: Record<string, unknown> }).summary_metrics.consolidated_revenue_bdt, "number");
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
    const numeric = await call("POST", "shipments", owner.token, { body: { order_id: o.id, courier_provider: "PATHAO", tracking_number: 12345 } });
    assert.strictEqual(numeric.status, 400, "a non-string tracking number is a validation error, not a 500");
    const negative = await call("POST", "shipments", owner.token, { body: { order_id: o.id, courier_provider: "PATHAO", tracking_number: "PTH1", shipping_cost: -50 } });
    assert.strictEqual(negative.status, 400);
    const unknownCourier = await call("POST", "shipments", owner.token, { body: { order_id: o.id, courier_provider: "DHL_FAKE", tracking_number: "X1" } });
    assert.strictEqual(unknownCourier.status, 400);
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

    // Another workspace can't reach this installation
    const other = await AuthService.registerTenantWithOwner({
      email: `${uid("other")}@phase3.test`, password: "Phase3-Other-Pass-6633!", name: "Other", workspaceName: `Other ${Date.now()}`,
    });
    const otherOwner = await member(other.tenant.id, "OWNER");
    db.createOrganization({
      id: uid("org_other"), tenant_id: other.tenant.id, name: "Other Org", slug: uid("other"), legal_name: "Other Ltd.", default_currency: "BDT",
      supported_currencies: ["BDT"], headquarters_country: "Bangladesh", status: "ACTIVE", created_at: nowIso(), updated_at: nowIso(),
    });
    const foreign = await call("POST", "enterprise/integrations/[id]/sync", otherOwner.token, { id: String(installed.json.data?.id) });
    assert.strictEqual(foreign.status, 404);

    // The AI tool never hands credentials to the model
    const ctx = await AuthService.resolveRequestContext(admin.token);
    assert.ok(ctx);
    const toolOut = await new GetIntegrationStatusTool().execute(ctx, {});
    assert.ok(JSON.stringify(toolOut).length > 20 && !JSON.stringify(toolOut).includes("credentials_encrypted"));
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

  await runTest("connector test route: settings.update only, no fetch to custom endpoints, rate limited", async () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const body = { provider_id: "groq", endpoint_url: "http://10.0.0.5:8080/v1", credentials: { api_key: "gsk_p3_value_0000" } };
      assert.strictEqual((await call("POST", "connectors/test", manager.token, { body })).status, 403, "MANAGER can read settings but not change them");
      const custom = await call("POST", "connectors/test", owner.token, { body });
      assert.strictEqual(custom.status, 200);
      assert.strictEqual(custom.json.data?.status, "NOT_VERIFIED");
      assert.deepStrictEqual(calls, [], "an internal endpoint is never fetched");
      let last = 0;
      for (let i = 0; i < 10; i++) last = (await call("POST", "connectors/test", owner.token, { body })).status;
      assert.strictEqual(last, 429);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  const invokeN8n = () =>
    N8nProviderService.invokeWorkflow({
      tenantId, automationId: uid("auto_p3"), workflowId: uid("wf_p3"), workflowVersionId: "v1",
      webhookPath: "p3-test", event: { type: "p3" }, correlationId: uid("corr"), idempotencyKey: uid("idem"),
      executionMode: "PRODUCTION",
    });

  await runTest("n8n: with no instance configured nothing is sent (no localhost default, no 'mock success')", async () => {
    const saved = { host: process.env.N8N_HOST, base: process.env.COMMERCEOS_N8N_BASE_URL };
    delete process.env.N8N_HOST;
    delete process.env.COMMERCEOS_N8N_BASE_URL;
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const result = await invokeN8n();
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.statusCode, 424);
      assert.strictEqual(result.execution.error_code, "N8N_NOT_CONFIGURED");
    } finally {
      globalThis.fetch = realFetch;
      if (saved.host !== undefined) process.env.N8N_HOST = saved.host;
      if (saved.base !== undefined) process.env.COMMERCEOS_N8N_BASE_URL = saved.base;
    }
  });

  await runTest("AI: embeddings go to LLM_EMBEDDING_BASE_URL (own key, model, dimensions) while chat stays on the primary provider", async () => {
    const router = ModelRouter.getInstance();
    const realFetch = globalThis.fetch;
    const calls: Array<{ url: string; auth: string | undefined; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: (init?.headers as Record<string, string>)?.Authorization, body: JSON.parse(String(init?.body)) });
      const isEmbed = String(url).endsWith("/embeddings");
      return new Response(JSON.stringify(isEmbed ? { data: [{ embedding: [0.1, 0.2, 0.3] }] } : { choices: [{ message: { content: "hi" } }], usage: {} }), { status: 200 });
    }) as typeof fetch;
    try {
      router.configure({
        LLM_BASE_URL: "http://chat.p3/v1", LLM_API_KEY: "chat-key", LLM_MODEL_FAST: "chat-model",
        LLM_EMBEDDING_BASE_URL: "http://embed.p3/v1", LLM_EMBEDDING_API_KEY: "embed-key", LLM_EMBEDDING_MODEL: "embed-model", LLM_EMBEDDING_DIMENSIONS: "768",
      } as NodeJS.ProcessEnv);
      assert.strictEqual(router.getStatus().embedding_provider, "embeddings");
      assert.deepStrictEqual(await router.generateEmbedding("hello"), [0.1, 0.2, 0.3]);
      assert.strictEqual(calls[0].url, "http://embed.p3/v1/embeddings");
      assert.strictEqual(calls[0].auth, "Bearer embed-key");
      assert.strictEqual(calls[0].body.model, "embed-model");
      assert.strictEqual(calls[0].body.dimensions, 768);
      await router.chatWithRouting("TIER_1_FAST", [{ role: "user", content: "x" }]);
      assert.strictEqual(calls[1].url, "http://chat.p3/v1/chat/completions");
      assert.strictEqual(calls[1].auth, "Bearer chat-key");
    } finally {
      globalThis.fetch = realFetch;
      router.configure(process.env);
    }
  });

  await runTest("n8n: calls carry X-CommerceOS-Token when COMMERCEOS_N8N_WEBHOOK_TOKEN is set, and none when it isn't", async () => {
    const saved = { host: process.env.N8N_HOST, token: process.env.COMMERCEOS_N8N_WEBHOOK_TOKEN };
    process.env.N8N_HOST = "http://n8n.tok.p3:5678";
    const realFetch = globalThis.fetch;
    let seen: Record<string, string> | null = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.headers as Record<string, string>;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      process.env.COMMERCEOS_N8N_WEBHOOK_TOKEN = "p3-token-0123456789abcdef";
      await invokeN8n();
      assert.strictEqual((seen as Record<string, string> | null)?.["X-CommerceOS-Token"], "p3-token-0123456789abcdef");
      delete process.env.COMMERCEOS_N8N_WEBHOOK_TOKEN;
      seen = null;
      await invokeN8n();
      assert.ok(seen, "n8n must still be called");
      assert.strictEqual((seen as Record<string, string>)["X-CommerceOS-Token"], undefined);
    } finally {
      globalThis.fetch = realFetch;
      for (const [k, v] of [["N8N_HOST", saved.host], ["COMMERCEOS_N8N_WEBHOOK_TOKEN", saved.token]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  await runTest("n8n: an unreachable configured instance fails, and the tenant sees no internal host", async () => {
    const saved = process.env.N8N_HOST;
    process.env.N8N_HOST = "http://n8n.internal.p3:5678";
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      throw new Error("connect ECONNREFUSED n8n.internal.p3:5678");
    }) as typeof fetch;
    try {
      const result = await invokeN8n();
      assert.strictEqual(calls.length, 1, "a real request was attempted");
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.execution.status, "FAILED");
      assert.ok(!JSON.stringify(result).includes("n8n.internal.p3"), "no internal host in the result");
    } finally {
      globalThis.fetch = realFetch;
      if (saved === undefined) delete process.env.N8N_HOST;
      else process.env.N8N_HOST = saved;
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

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[N13-N15, demo seed, delivery fee] Follow-ups${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("N13: stores, brands and business units list only the caller's enterprise scope", async () => {
    const stores = await call("GET", "enterprise/stores", scopedAdmin.token);
    assert.strictEqual(stores.status, 200);
    assert.deepStrictEqual((stores.json.data?.stores as Array<{ id: string }>).map((x) => x.id), [storeA.id]);
    const units = await call("GET", "enterprise/business-units", scopedAdmin.token);
    assert.deepStrictEqual(units.json.data?.business_units, [], "no business unit is assigned to this member");
    const all = await call("GET", "enterprise/stores", owner.token);
    assert.strictEqual((all.json.data?.stores as unknown[]).length, 2);
    assert.strictEqual((await call("GET", "enterprise/brands", suspendedAdmin.token)).status, 403);
  });

  await runTest("N13: creating stores needs a real brand in scope; units need organization-wide scope", async () => {
    const noBrand = await call("POST", "enterprise/stores", owner.token, { body: { name: "X", code: "X1", brand_id: "br_does_not_exist" } });
    assert.strictEqual(noBrand.status, 404);
    const ok = await call("POST", "enterprise/stores", owner.token, { body: { name: "Store C", code: "SC", brand_id: `${orgId}_br`, store_type: "POPUP" } });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual((ok.json.data as { business_unit_id: string }).business_unit_id, `${orgId}_bu`, "unit comes from the brand");
    const scopedStore = await call("POST", "enterprise/stores", scopedAdmin.token, { body: { name: "Y", code: "Y1", brand_id: `${orgId}_br` } });
    assert.strictEqual(scopedStore.status, 403, "a store-scoped member can't add stores under the brand");
    const unit = await call("POST", "enterprise/business-units", scopedAdmin.token, { body: { name: "U", code: "U1" } });
    assert.strictEqual(unit.status, 403);
    const extra = await call("POST", "enterprise/stores", owner.token, { body: { name: "Z", code: "Z1", brand_id: `${orgId}_br`, organization_id: orgId, business_unit_id: "bu_x" } });
    assert.strictEqual(extra.status, 400, "strict body: the unit can't be chosen separately");
  });

  await runTest("N13/N12: metrics use this organization and the caller's scope, with no invented values", async () => {
    const org = await call("GET", "enterprise/metrics", owner.token, { query: "?metric_key=gross_margin_pct" });
    assert.strictEqual(org.status, 200);
    const margin = org.json.data as { value: number | null; data_quality_status: string };
    assert.ok(margin.value === null || typeof margin.value === "number");
    assert.notStrictEqual(margin.value, 32.5, "the literal margin is gone");
    assert.strictEqual((await call("GET", "enterprise/metrics", scopedAdmin.token, { query: "?metric_key=gross_revenue" })).status, 403);
    const store = await call("POST", "enterprise/metrics", owner.token, { body: { metric_key: "gross_revenue", entity_type: "STORE", entity_id: storeA.id } });
    assert.strictEqual(store.status, 200);
    assert.strictEqual((store.json.data as { value: unknown }).value, null, "orders carry no store");
    assert.strictEqual((await call("GET", "enterprise/metrics", owner.token, { query: "?metric_key=made_up_metric" })).status, 404);
  });

  await runTest("N14: legacy base64 integration credentials are re-encrypted; unreadable ones cleared", () => {
    const base = { organization_id: "org_x", provider_id: "p", provider_name: "SAP", category: "ERP", status: "HEALTHY", config: {}, sync_frequency_minutes: 60, created_at: nowIso(), updated_at: nowIso() };
    const legacy = planCredentialMigration({ ...base, id: "a", credentials_encrypted: Buffer.from(JSON.stringify({ api_key: "n14-plain" })).toString("base64") } as IntegrationInstallation);
    assert.strictEqual(legacy.result, "reencrypted");
    assert.ok(legacy.update?.credentials_encrypted && !legacy.update.credentials_encrypted.includes("n14-plain"));
    assert.strictEqual(planCredentialMigration({ ...base, id: "b", credentials_encrypted: encryptCredential({ k: 1 }) } as IntegrationInstallation).result, "already_encrypted");
    const junk = planCredentialMigration({ ...base, id: "c", credentials_encrypted: "garbage!!" } as IntegrationInstallation);
    assert.strictEqual(junk.result, "unreadable");
    assert.strictEqual(junk.update?.status, "DISCONNECTED");
  });

  await runTest("N15: objectives POST is strict; new objectives are PROPOSED with the baseline approvals", async () => {
    const extra = await call("POST", "autonomous/objectives", owner.token, { body: { name: "Grow", target_value: 10, baseline_value: 5, status: "ACTIVE" } });
    assert.strictEqual(extra.status, 400, "status isn't client-settable");
    const badDomain = await call("POST", "autonomous/objectives", owner.token, { body: { name: "Grow", target_value: 10, baseline_value: 5, allowed_domains: ["EVERYTHING"] } });
    assert.strictEqual(badDomain.status, 400);
    const ok = await call("POST", "autonomous/objectives", owner.token, { body: { name: "Grow", target_value: 10, baseline_value: 5, required_approvals: [] } });
    assert.strictEqual(ok.status, 201);
    const obj = ok.json.data as { status: string; required_approvals: string[]; created_by: string; forecast_achievement_percent: unknown };
    assert.strictEqual(obj.status, "PROPOSED");
    assert.ok(obj.required_approvals.includes("HIGH_RISK_PRICING") && obj.required_approvals.includes("BUDGET_OVERRUN"));
    assert.strictEqual(obj.created_by, owner.id);
    assert.strictEqual(obj.forecast_achievement_percent, null);
    const parent = await call("POST", "autonomous/objectives", owner.token, { body: { name: "Child", target_value: 1, baseline_value: 0, parent_objective_id: "obj_someone_else" } });
    assert.strictEqual(parent.status, 404);

    // The AI tool proposes too, and needs the merchant's numbers
    const ctx = await AuthService.resolveRequestContext(owner.token);
    assert.ok(ctx);
    const tool = new CreateBusinessObjectiveTool();
    assert.throws(() => tool.schema.parse({ name: "Grow sales", description: "x" }), "target and baseline are required");
    const viaTool = (await tool.execute(ctx, tool.schema.parse({ name: "Grow sales", description: "x", target_value: 100, baseline_value: 50 }))) as { data: { status: string } };
    assert.strictEqual(viaTool.data.status, "PROPOSED");
  });

  await runTest("FX-36: orders need a real district; division and zone (and the fee) follow from it", async () => {
    const ctx = await AuthService.resolveRequestContext(owner.token);
    assert.ok(ctx);
    if (db.getWarehouses(tenantId).length === 0) {
      db.createWarehouse({ id: uid("wh_p3"), tenant_id: tenantId, name: "Main", code: "MAIN", address: "Dhaka", city: "Dhaka", district: "Dhaka", status: "ACTIVE", created_at: nowIso(), updated_at: nowIso() });
    }
    const product = await ProductService.createProduct(ctx, { name: "P3 Panjabi", sku: uid("P3SKU"), base_price: 1000, initial_stock: 10 });
    const variantId = (product as { variants?: Array<{ id: string }> }).variants?.[0]?.id;
    assert.ok(variantId, "product has a variant");
    const body = (district: string, zone?: string) => ({
      customer: { first_name: "Rahim", phone: "01712345678" },
      delivery_address: { district, address_line_1: "House 1" },
      ...(zone ? { delivery_zone: zone } : {}),
      items: [{ variant_id: variantId, quantity: 1 }],
      payment_method: "COD",
    });
    assert.strictEqual((await call("POST", "orders", owner.token, { body: body("Atlantis") })).status, 400);
    assert.strictEqual((await call("POST", "orders", owner.token, { body: { ...body("Dhaka"), items: [{ variant_id: variantId, quantity: 1.5 }] } })).status, 400);
    const fees = (await call("GET", "tenants/current", owner.token)).json.data?.delivery_fees as { inside_dhaka_bdt: number; outside_dhaka_bdt: number };
    // A client claiming "inside Dhaka" for Sylhet is charged the outside-Dhaka fee
    const sylhet = await call("POST", "orders", owner.token, { body: body("sylhet", "INSIDE_DHAKA") });
    assert.strictEqual(sylhet.status, 201);
    const order = sylhet.json.data?.order as { shipping_total: number; shipping_address_snapshot: { district: string; division: string } };
    assert.strictEqual(order.shipping_address_snapshot.district, "Sylhet");
    assert.strictEqual(order.shipping_address_snapshot.division, "Sylhet");
    assert.strictEqual(order.shipping_total, fees.outside_dhaka_bdt);
    assert.strictEqual(findDistrict("Chittagong")?.district, "Chattogram", "old spellings are accepted");
  });

  await runTest("no courier history: no courier is recommended (no Steadfast / ৳60 / 24 h default)", () => {
    const rec = fulfillmentOperationsService.recommendCourier("ten_without_history", "ord_x");
    assert.strictEqual(rec.recommended_courier, null);
    assert.strictEqual(rec.estimated_cost_bdt, null);
    assert.strictEqual(rec.estimated_transit_hours, null);
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-33] Broken endpoints${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("FX-33: the daily cycle endpoint exists, says nothing runs yet, and honours the emergency halt", async () => {
    const started = await call("POST", "autonomous/cycles", owner.token, { body: { cycle_type: "DAILY" } });
    assert.strictEqual(started.status, 201);
    const data = started.json.data as { executed: boolean; run: { trigger: string; status: string } };
    assert.strictEqual(data.executed, false);
    assert.strictEqual(data.run.trigger, "MANUAL");
    assert.strictEqual((await call("POST", "autonomous/pause", owner.token, { body: { level: "ALL", reason: "test" } })).status, 200);
    const halted = await call("POST", "autonomous/cycles", owner.token, { body: {} });
    assert.strictEqual(halted.status, 503);
    assert.strictEqual(halted.json.error?.code, "KILL_SWITCH_ACTIVE");
    assert.strictEqual((await call("POST", "autonomous/resume", owner.token, { body: { level: "ALL" } })).status, 200);
    assert.strictEqual((await call("POST", "autonomous/cycles", owner.token, { body: {} })).status, 201);
    assert.strictEqual((await call("POST", "autonomous/cycles", owner.token, { body: { cycle_type: "HOURLY" } })).status, 400);
  });

  await runTest("FX-33: report CSV download exists, is scoped, and neutralises spreadsheet formulas", async () => {
    enterpriseHierarchyService.createStore(orgId, { ...storeFields, id: `${orgId}_evil`, name: "=HYPERLINK(\"http://x\")", code: "EV" });
    const def = await call("POST", "enterprise/reports", owner.token, { body: { title: "Stores" } });
    assert.strictEqual(def.status, 201);
    const id = String((def.json.data as { id: string }).id);
    const mod = (await import("@/app/api/v1/enterprise/reports/[id]/download/route")) as { GET: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> };
    const get = (token: string, reportId: string) =>
      mod.GET(new Request(`${BASE}/enterprise/reports/${reportId}/download`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id: reportId }) });
    const res = await get(owner.token, id);
    assert.strictEqual(res.status, 200);
    assert.ok((res.headers.get("content-type") ?? "").startsWith("text/csv"));
    const csv = await res.text();
    assert.ok(csv.includes(`"'=HYPERLINK`), "formula neutralised");
    assert.ok(csv.includes(storeB.id));
    const scoped = await (await get(scopedAdmin.token, id)).text();
    assert.ok(scoped.includes(storeA.id) && !scoped.includes(storeB.id), "only the member's stores");
    assert.strictEqual((await get(owner.token, "rep_does_not_exist")).status, 404);
  });

  await runTest("FX-33: every webhook URL the connector catalogue advertises has a route", () => {
    const missing: string[] = [];
    for (const provider of ConnectorService.PROVIDERS) {
      const url = provider.guidelines?.webhook_info;
      if (!url) continue;
      const route = url.split("?")[0].replace(/^\/api\/v1\//, "");
      const direct = path.join("src/app/api/v1", route, "route.ts");
      const dynamic = path.join("src/app/api/v1", path.dirname(route), "[provider]", "route.ts");
      if (!fs.existsSync(direct) && !fs.existsSync(dynamic)) missing.push(`${provider.id}: ${url}`);
    }
    assert.deepStrictEqual(missing, []);
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-37 / N8] Invitations and owner setup${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  type InviteRoute = {
    GET: (r: Request, c: { params: { token: string } }) => Promise<Response>;
    POST: (r: Request, c: { params: { token: string } }) => Promise<Response>;
  };
  const invite = (await import("@/app/api/v1/invitations/[token]/route")) as InviteRoute;
  const invGet = async (token: string) => {
    const res = await invite.GET(new Request(`${BASE}/invitations/${token}`), { params: { token } });
    return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown>; error?: { code?: string } } };
  };
  const invPost = async (token: string, body: unknown) => {
    const res = await invite.POST(
      new Request(`${BASE}/invitations/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { params: { token } }
    );
    return { status: res.status, cookie: res.headers.get("set-cookie") ?? "", json: (await res.json()) as { data?: Record<string, unknown> } };
  };
  const tokenOf = (path: unknown) => String(path).split("/invite/")[1];

  await runTest("FX-37: an invite link is shown once to its creator; listings never contain tokens", async () => {
    const created = await call("POST", "users", admin.token, { body: { email: `${uid("new")}@phase3.test`, role: "SALES" } });
    assert.strictEqual(created.status, 201);
    const data = created.json.data as { invitation: Record<string, unknown>; invite_path: string };
    assert.ok(!("token" in data.invitation));
    assert.ok(data.invite_path.startsWith("/invite/"));
    const listed = await call("GET", "users", manager.token);
    assert.ok(!JSON.stringify(listed.json).includes(tokenOf(data.invite_path)), "a MANAGER can't read pending tokens");
  });

  await runTest("FX-37: a new person accepts with name and password, is signed in, and the link works once", async () => {
    const email = `${uid("joiner")}@phase3.test`;
    const created = await call("POST", "users", admin.token, { body: { email, role: "SALES" } });
    const token = tokenOf((created.json.data as { invite_path: string }).invite_path);
    const info = await invGet(token);
    assert.strictEqual(info.status, 200);
    assert.strictEqual(info.json.data?.existing_account, false);
    assert.strictEqual((await invPost(token, { name: "Joiner", password: "short" })).status, 400);
    const accepted = await invPost(token, { name: "Joiner", password: "Joiner-Pass-4411" });
    assert.strictEqual(accepted.status, 200);
    assert.ok(accepted.cookie.includes("commerceos_session="), "signed in");
    assert.strictEqual((await invPost(token, { name: "Again", password: "Joiner-Pass-4411" })).status, 400, "used once");
    assert.strictEqual((await invPost(token, { name: "x", password: "y", role: "OWNER" })).status, 400, "strict body");
  });

  await runTest("N8: a provisioned owner sets a password with the one-time setup link; others can't claim it", async () => {
    const platform: PlatformContext = {
      requestId: "req_p3_platform",
      traceId: "trc_p3_platform",
      scope: "PLATFORM",
      platformUser: { id: "usr_p3_platform", email: "ops@phase3.test", name: "Ops", status: "ACTIVE" },
      platformRole: "SUPER_ADMIN",
      permissions: Object.values(PLATFORM_PERMISSIONS),
      mfaVerified: true,
      stepUpVerified: true,
      timestamp: nowIso(),
    };
    const ownerEmail = `${uid("prov")}@phase3.test`;
    const provisioned = PlatformTenantService.provisionTenant(
      { name: "P3 Provisioned", slug: uid("p3-prov"), legal_name: "P3 Ltd", plan_id: "GROWTH", owner_email: ownerEmail, owner_name: "Prov Owner" },
      platform
    );
    assert.strictEqual(provisioned.owner_setup_required, true);
    assert.ok(provisioned.owner_setup_path);

    // Another workspace invites the same email and tries to claim the not-yet-activated account first
    const attackerInvite = await call("POST", "users", owner.token, { body: { email: ownerEmail, role: "SALES" } });
    assert.strictEqual(attackerInvite.status, 201);
    const claim = await invPost(tokenOf((attackerInvite.json.data as { invite_path: string }).invite_path), { name: "Attacker", password: "Attacker-Pass-9911" });
    assert.strictEqual(claim.status, 401, "only the owner's own workspace link can activate the account");

    const setupToken = tokenOf(provisioned.owner_setup_path);
    assert.strictEqual((await invGet(setupToken)).json.data?.existing_account, false, "asks for name and password");
    const activated = await invPost(setupToken, { name: "Prov Owner", password: "Owner-Pass-5522" });
    assert.strictEqual(activated.status, 200);
    const user = db.findUserByEmail(ownerEmail);
    assert.strictEqual(user?.status, "ACTIVE");
    const login = await AuthService.login(ownerEmail, "Owner-Pass-5522");
    assert.ok(login, "the owner can sign in");
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-36] Data entry${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("M11: a new workspace has its own warehouse; products never land in another tenant's", async () => {
    const fresh = await AuthService.registerTenantWithOwner({
      email: `${uid("wh")}@phase3.test`, password: "Phase3-Wh-Pass-7731!", name: "Wh Owner", workspaceName: `Wh ${Date.now()}`,
    });
    const warehouses = db.getWarehouses(fresh.tenant.id);
    assert.strictEqual(warehouses.length, 1, "created with the workspace");
    // A workspace from before (no warehouse) gets its own on first product, not the store's first warehouse
    const legacyTenant = uid("ten_legacy");
    db.createTenant({ id: legacyTenant, name: "Legacy", slug: legacyTenant, currency: "BDT", timezone: "Asia/Dhaka", language: "en", settings: {}, status: "ACTIVE", created_at: nowIso(), updated_at: nowIso() } as never);
    const legacyOwner = await member(legacyTenant, "OWNER");
    const ctx = await AuthService.resolveRequestContext(legacyOwner.token);
    assert.ok(ctx);
    const product = await ProductService.createProduct(ctx, { name: "Legacy P", sku: uid("LEG"), base_price: 100, initial_stock: 3 });
    const variantId = (product as { variants?: Array<{ id: string }> }).variants?.[0]?.id;
    const row = db.data.inventory_items.find((i) => i.product_variant_id === variantId);
    const wh = db.data.warehouses.find((w) => w.id === row?.warehouse_id);
    assert.strictEqual(wh?.tenant_id, legacyTenant, "stock is in this workspace's warehouse");
    // Orders can't name another workspace's warehouse
    const foreign = db.getWarehouses(tenantId)[0];
    const res = await call("POST", "orders", legacyOwner.token, {
      body: { customer: { first_name: "A", phone: "01712345679" }, delivery_address: { district: "Dhaka", address_line_1: "x" }, items: [{ variant_id: variantId, quantity: 1 }], payment_method: "COD", warehouse_id: foreign.id },
    });
    assert.strictEqual(res.status, 400);
  });

  await runTest("M11: the data fix moves stock out of another tenant's warehouse and merges duplicates", () => {
    const wh = (id: string, tenant: string): Warehouse => ({ id, tenant_id: tenant, name: id, code: id, address: "", city: "", district: "", status: "ACTIVE", created_at: nowIso(), updated_at: nowIso() });
    const item = (id: string, tenant: string, warehouse: string, variant: string, qty: number) => ({ id, tenant_id: tenant, warehouse_id: warehouse, product_variant_id: variant, quantity_on_hand: qty, quantity_reserved: 0, quantity_available: qty, reorder_point: 1, updated_at: nowIso() });
    const data: WarehouseTenancyData = {
      warehouses: [wh("wh_a", "ta"), wh("wh_b", "tb")],
      inventory_items: [item("i1", "tb", "wh_a", "v1", 5), item("i2", "tb", "wh_b", "v2", 1), item("i3", "tb", "wh_a", "v2", 2), item("i4", "ta", "wh_a", "v9", 7)],
      stock_movements: [{ id: "m1", tenant_id: "tb", warehouse_id: "wh_a", product_variant_id: "v1", type: "PURCHASE", quantity: 5, reason: "init", actor_user_id: "system", created_at: nowIso() }],
    };
    assert.deepStrictEqual(planWarehouseTenancyFix(data).tenants_affected, ["tb"]);
    const report = applyWarehouseTenancyFix(data, (t) => data.warehouses.find((w) => w.tenant_id === t) as Warehouse);
    assert.strictEqual(report.inventory_items_moved, 1);
    assert.strictEqual(report.inventory_items_merged, 1);
    assert.ok(data.inventory_items.filter((i) => i.tenant_id === "tb").every((i) => i.warehouse_id === "wh_b"));
    assert.strictEqual(data.inventory_items.find((i) => i.id === "i2")?.quantity_on_hand, 3, "merged into the existing row");
    assert.strictEqual(data.inventory_items.find((i) => i.id === "i4")?.warehouse_id, "wh_a", "the owner's own stock is untouched");
    assert.strictEqual(data.stock_movements[0].warehouse_id, "wh_b");
  });

  await runTest("M15/M5: made-up phones are cleared; old \"Chittagong\" orders are flagged UNKNOWN", () => {
    const customers = [
      { id: "c1", phone: "+8801700123456", notes: "Ingressed from FACEBOOK ID 9" },
      { id: "c2", phone: "+8801700123456", notes: "Walk-in" },
      { id: "c3", phone: "+8801711111111", notes: "Ingressed from WHATSAPP ID 3" },
    ] as unknown as Customer[];
    const orders = [
      { id: "o1", shipping_address_snapshot: { district: "Chittagong", division: "Chittagong" } },
      { id: "o2", shipping_address_snapshot: { district: "Chattogram", division: "Chattogram" } },
    ] as unknown as Order[];
    assert.deepStrictEqual(fixFabricatedData({ customers, orders }, { apply: false }), { customers_phone_cleared: 1, orders_address_flagged: 1 });
    fixFabricatedData({ customers, orders }, { apply: true });
    assert.deepStrictEqual(customers.map((c) => c.phone), ["", "+8801700123456", "+8801711111111"]);
    assert.strictEqual(orders[0].address_confidence, "UNKNOWN");
    assert.strictEqual(orders[1].address_confidence, undefined);
  });

  await runTest("M16: knowledge upload takes text formats only", async () => {
    const pdf = await call("POST", "ai/knowledge", owner.token, { body: { title: "Policy", raw_content: "%PDF-1.4 ...", file_format: "PDF" } });
    assert.strictEqual(pdf.status, 400);
    const md = await call("POST", "ai/knowledge", owner.token, { body: { title: "Returns", raw_content: "# Returns\nWithin 7 days.", file_format: "MD" } });
    assert.strictEqual(md.status, 201);
    assert.strictEqual((md.json.data as { file_format: string }).file_format, "MARKDOWN");
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-35] One writer for order status${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const ownerCtx = await AuthService.resolveRequestContext(owner.token);
  assert.ok(ownerCtx);
  const lcProduct = await ProductService.createProduct(ownerCtx, { name: "Lifecycle Panjabi", sku: uid("LC"), base_price: 500, initial_stock: 100 });
  const lcVariant = (lcProduct as { variants?: Array<{ id: string }> }).variants?.[0]?.id as string;
  const stockOf = () => db.getInventory(tenantId).find((i) => i.product_variant_id === lcVariant) as { quantity_on_hand: number; quantity_available: number; quantity_reserved: number };
  const newOrder = async (quantity = 1, payment: "COD" | "BKASH" = "COD") =>
    OrderService.createOrder(ownerCtx, {
      customer: { first_name: "Karim", last_name: "", phone: `0171${Math.floor(1000000 + Math.random() * 8999999)}` },
      delivery_address: { district: "Dhaka", address_line_1: "Road 1" },
      items: [{ variant_id: lcVariant, quantity }],
      payment_method: payment,
    });

  await runTest("FX-35: people move one legal step at a time (409 otherwise)", async () => {
    const o = await newOrder();
    await assert.rejects(OrderService.transitionOrderStatus(ownerCtx, o.id, "SHIPPED"), (e: Error & { statusCode?: number; code?: string }) => e.code === "CONFLICT");
    const confirmed = await OrderService.transitionOrderStatus(ownerCtx, o.id, "CONFIRMED");
    assert.strictEqual(confirmed.status, "CONFIRMED");
  });

  await runTest("FX-35: booking and delivering commits the stock and marks COD paid", async () => {
    const before = stockOf();
    const o = await newOrder(2);
    assert.strictEqual(stockOf().quantity_reserved, before.quantity_reserved + 2, "reserved at creation");
    await OrderService.transitionOrderStatus(ownerCtx, o.id, "CONFIRMED");
    const shipment = await ShippingService.createShipment(ownerCtx, { order_id: o.id, courier_provider: "PATHAO", tracking_number: uid("PTH") });
    assert.strictEqual(db.findOrderById(tenantId, o.id)?.status, "READY_TO_SHIP", "CONFIRMED walked to READY_TO_SHIP");
    await ShippingService.updateDeliveryStatus(ownerCtx, shipment.id, "DELIVERED");
    const after = db.findOrderById(tenantId, o.id);
    assert.strictEqual(after?.status, "DELIVERED");
    assert.strictEqual(after?.payment_status, "PAID");
    assert.strictEqual(stockOf().quantity_on_hand, before.quantity_on_hand - 2, "on hand decremented");
    assert.ok(db.getReservationsForOrder(tenantId, o.id).every((r) => r.status === "COMMITTED"));
  });

  await runTest("FX-35: a delivery on a cancelled order is refused (409) and recorded as an exception", async () => {
    const o = await newOrder();
    await OrderService.transitionOrderStatus(ownerCtx, o.id, "CONFIRMED");
    const shipment = await ShippingService.createShipment(ownerCtx, { order_id: o.id, courier_provider: "REDX", tracking_number: uid("RDX") });
    // Cancel after booking (READY_TO_SHIP -> CANCELLED is allowed), then the delivery arrives
    await OrderService.transitionOrderStatus(ownerCtx, o.id, "CANCELLED");
    const exceptionsBefore = db.data.operational_exceptions.filter((e) => e.entity_id === o.id).length;
    const courier = { ...ownerCtx, user: { ...ownerCtx.user } };
    await assert.rejects(ShippingService.updateDeliveryStatus(courier, shipment.id, "DELIVERED"), (e: Error & { code?: string }) => e.code === "CONFLICT");
    assert.strictEqual(db.findOrderById(tenantId, o.id)?.status, "CANCELLED", "not revived");
    assert.strictEqual(db.findShipmentById(tenantId, shipment.id)?.status, "PENDING", "shipment untouched");
    assert.strictEqual(db.data.operational_exceptions.filter((e) => e.entity_id === o.id).length, exceptionsBefore + 1);
  });

  await runTest("FX-35: lapsed holds are released; confirming later re-reserves, or refuses when stock is gone", async () => {
    const o = await newOrder(3);
    const heldAvailable = stockOf().quantity_available;
    for (const r of db.getReservationsForOrder(tenantId, o.id)) r.expires_at = new Date(Date.now() - 1000).toISOString();
    assert.ok(db.releaseExpiredReservations() >= 1);
    assert.strictEqual(stockOf().quantity_available, heldAvailable + 3, "availability restored");
    const confirmed = await OrderService.transitionOrderStatus(ownerCtx, o.id, "CONFIRMED");
    assert.strictEqual(confirmed.status, "CONFIRMED");
    assert.strictEqual(stockOf().quantity_available, heldAvailable, "taken again on confirmation");
    // A confirmed order's hold isn't swept
    for (const r of db.getReservationsForOrder(tenantId, o.id)) if (r.status === "ACTIVE") assert.ok(Date.parse(r.expires_at) > Date.now() + 7 * 86400000);

    const big = await newOrder(stockOf().quantity_available);
    for (const r of db.getReservationsForOrder(tenantId, big.id)) r.expires_at = new Date(Date.now() - 1000).toISOString();
    db.releaseExpiredReservations();
    await newOrder(1); // someone else takes stock meanwhile
    await assert.rejects(OrderService.transitionOrderStatus(ownerCtx, big.id, "CONFIRMED"), (e: Error & { code?: string }) => e.code === "CONFLICT");
    assert.strictEqual(db.findOrderById(tenantId, big.id)?.status, "PENDING");
  });

  await runTest("FX-35: 20 concurrent orders get 20 different numbers", async () => {
    const orders = await Promise.all(Array.from({ length: 20 }, () => newOrder(1, "BKASH")));
    const numbers = orders.filter(Boolean).map((o) => (o as Order).order_number);
    assert.strictEqual(numbers.length, 20);
    assert.strictEqual(new Set(numbers).size, numbers.length);
  });

  await runTest("FX-35: a refund without a return leaves the order status alone", async () => {
    const o = await newOrder(1, "BKASH");
    db.createPayment({ id: uid("pay"), tenant_id: tenantId, order_id: o.id, provider: "BKASH", amount: o.grand_total, currency: "BDT", status: "PAID", created_at: nowIso() });
    await ReturnService.processRefund(ownerCtx, { order_id: o.id, reason: "goodwill", amount: 50 });
    const after = db.findOrderById(tenantId, o.id);
    assert.strictEqual(after?.status, "PENDING");
    assert.strictEqual(after?.payment_status, "REFUNDED");
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-34] Enforced safety controls and real impersonation${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  const operatorId = uid("usr_p3_op");
  db.createUser({ id: operatorId, email: `${operatorId}@ops.test`, name: "P3 Operator", password_hash: "!disabled", status: "ACTIVE", created_at: nowIso(), updated_at: nowIso() });
  db.savePlatformMembership({ id: `pm_${operatorId}`, user_id: operatorId, role: "SUPER_ADMIN", mfa_enabled: false, is_active: true, created_at: nowIso(), updated_at: nowIso() });
  const operatorCtx = {
    requestId: "req_p3_op", traceId: "trc_p3_op", scope: "PLATFORM" as const, platformRole: "SUPER_ADMIN" as const,
    platformUser: { id: operatorId, email: `${operatorId}@ops.test`, name: "P3 Operator", status: "ACTIVE" as const },
    permissions: PLATFORM_ROLE_PERMISSIONS.SUPER_ADMIN, mfaVerified: true, stepUpVerified: true, timestamp: nowIso(),
  };
  const platformCookie = `commerceos_platform_session=${await signPlatformSessionToken({ userId: operatorId, email: `${operatorId}@ops.test`, platformRole: "SUPER_ADMIN", mfaVerified: true, sv: 1 })}`;

  await runTest("FX-34: a tenant kill switch stops changes (503) but not reads; clearing it restores them", async () => {
    PlatformSafetyService.activateKillSwitch({ scope: "TENANT", targetId: tenantId, reason: "P3 incident containment" }, operatorCtx as never);
    const blocked = await call("POST", "autonomous/objectives", owner.token, { body: { name: "Blocked", target_value: 1, baseline_value: 0 } });
    assert.strictEqual(blocked.status, 503);
    assert.strictEqual(blocked.json.error?.code, "KILL_SWITCH_ACTIVE");
    assert.strictEqual((await call("GET", "orders", owner.token)).status, 200, "reads still work");
    PlatformSafetyService.deactivateKillSwitch(`KILL_SWITCH_TENANT_${tenantId}`, "resolved", operatorCtx as never);
    assert.strictEqual((await call("POST", "autonomous/objectives", owner.token, { body: { name: "OK", target_value: 1, baseline_value: 0 } })).status, 201);
  });

  await runTest("FX-34: provider and workflow kill switches are enforced by the model router and automations", async () => {
    const router = ModelRouter.getInstance();
    const providerName = router.getActiveProvider().provider.providerName;
    PlatformSafetyService.activateKillSwitch({ scope: "PROVIDER", targetId: providerName, reason: "P3 provider outage" }, operatorCtx as never);
    try {
      await assert.rejects(router.chatWithRouting("TIER_1_FAST", [{ role: "user", content: "hi" }]), (e: Error & { code?: string }) => e.code === "KILL_SWITCH_ACTIVE");
    } finally {
      PlatformSafetyService.deactivateKillSwitch(`KILL_SWITCH_PROVIDER_${providerName}`, "resolved", operatorCtx as never);
    }
    const wf = uid("wf_p3_kill");
    PlatformSafetyService.activateKillSwitch({ scope: "WORKFLOW", targetId: wf, reason: "P3 runaway workflow" }, operatorCtx as never);
    const result = await N8nProviderService.invokeWorkflow({
      tenantId, automationId: uid("auto"), workflowId: wf, workflowVersionId: "v1", webhookPath: "x", event: {}, correlationId: uid("c"), idempotencyKey: uid("i"), executionMode: "PRODUCTION",
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.execution.error_code, "KILL_SWITCH_HALTED");
  });

  await runTest("FX-34: plan limits count what exists (403 PLAN_LIMIT_REACHED)", async () => {
    const existing = db.getAllProducts(tenantId).filter((x) => x.status !== "ARCHIVED").length;
    db.saveTenantEntitlement({ tenant_id: tenantId, entitlement_id: "max_products", value: existing, is_override: true, updated_at: nowIso() });
    await assert.rejects(ProductService.createProduct(ownerCtx, { name: "Over", sku: uid("OVR"), base_price: 1 }), (e: Error & { code?: string }) => e.code === "PLAN_LIMIT_REACHED");
    db.saveTenantEntitlement({ tenant_id: tenantId, entitlement_id: "max_products", value: existing + 1, is_override: true, updated_at: nowIso() });
    await ProductService.createProduct(ownerCtx, { name: "Fits", sku: uid("FIT"), base_price: 1 });
  });

  await runTest("FX-34: feature flags gate modules per workspace (off, allow-list, percentage)", async () => {
    db.savePlatformFeatureFlag({ id: "flag_enterprise", key: "enterprise", description: "Enterprise module", is_enabled_globally: false, percentage_rollout: 100, scope: "TENANT", tenant_allowlist: [], rules: {}, created_at: nowIso(), updated_at: nowIso() });
    const off = await call("GET", "enterprise/stores", owner.token);
    assert.strictEqual(off.status, 403);
    assert.strictEqual(off.json.error?.code, "FEATURE_NOT_ENTITLED");
    db.savePlatformFeatureFlag({ id: "flag_enterprise", key: "enterprise", description: "Enterprise module", is_enabled_globally: false, percentage_rollout: 100, scope: "TENANT", tenant_allowlist: [tenantId], rules: {}, created_at: nowIso(), updated_at: nowIso() });
    assert.strictEqual((await call("GET", "enterprise/stores", owner.token)).status, 200, "allow-listed");
    db.savePlatformFeatureFlag({ id: "flag_enterprise", key: "enterprise", description: "Enterprise module", is_enabled_globally: true, percentage_rollout: 100, scope: "GLOBAL", tenant_allowlist: [], rules: {}, created_at: nowIso(), updated_at: nowIso() });
    // Percentage rollout is deterministic per tenant: 0% is nobody, 100% everybody, 50% the same answer every time
    const rollout = (pct: number) => db.savePlatformFeatureFlag({ id: "flag_p3_rollout", key: "p3_rollout", description: "rollout", is_enabled_globally: true, percentage_rollout: pct, scope: "GLOBAL", tenant_allowlist: [], rules: {}, created_at: nowIso(), updated_at: nowIso() });
    rollout(0);
    assert.strictEqual(isFeatureEnabled("p3_rollout", tenantId), false);
    rollout(100);
    assert.strictEqual(isFeatureEnabled("p3_rollout", tenantId), true);
    rollout(50);
    const first = isFeatureEnabled("p3_rollout", tenantId);
    assert.ok([1, 2, 3].every(() => isFeatureEnabled("p3_rollout", tenantId) === first));
    assert.strictEqual(isFeatureEnabled("no_such_flag", tenantId), true, "no flag, not gated");
  });

  await runTest("FX-34: the autonomous emergency halt stops decision execution", async () => {
    assert.strictEqual((await call("POST", "autonomous/pause", owner.token, { body: { level: "ALL", reason: "test" } })).status, 200);
    try {
      assert.throws(() => globalDecisionEngineService.executeDecision(tenantId, "dec_any"), (e: Error & { code?: string }) => e.code === "KILL_SWITCH_ACTIVE");
    } finally {
      await call("POST", "autonomous/resume", owner.token, { body: { level: "ALL" } });
    }
  });

  await runTest("FX-34: support impersonation works only with the operator's own session; read-only can't change anything", async () => {
    const { session, token } = await PlatformSupportService.startImpersonationSession(
      { targetTenantId: tenantId, targetUserId: owner.id, reason: "P3 customer ticket investigation", mode: "READ_ONLY", durationMinutes: 15 },
      operatorCtx as never
    );
    const impCookie = `commerceos_impersonation=${token}`;
    const as = async (method: "GET" | "POST", route: string, cookie: string, body?: unknown) => {
      const mod = (await import(`@/app/api/v1/${route}/route`)) as Partial<Record<"GET" | "POST", (r: Request) => Promise<Response>>>;
      const res = await (mod[method] as (r: Request) => Promise<Response>)(
        new Request(`${BASE}/${route}`, { method, headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
      );
      return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown>; error?: { code?: string } } };
    };
    const who = await as("GET", "auth/session", `${platformCookie}; ${impCookie}`);
    assert.strictEqual(who.status, 200);
    assert.strictEqual((who.json.data?.tenant as { id: string }).id, tenantId);
    assert.strictEqual((who.json.data?.user as { id: string }).id, operatorId, "the operator, not the owner");
    assert.strictEqual((who.json.data?.impersonation as { mode: string }).mode, "READ_ONLY");
    assert.ok((who.json.data?.permissions as string[]).every((perm) => perm.endsWith(".read")));

    assert.strictEqual((await as("POST", "autonomous/objectives", `${platformCookie}; ${impCookie}`, { name: "x", target_value: 1, baseline_value: 0 })).status, 403, "read-only");
    assert.strictEqual((await as("GET", "auth/session", impCookie)).status, 401, "the cookie alone isn't enough");

    PlatformSupportService.revokeSession(session.id, "done", operatorCtx as never);
    assert.strictEqual((await as("GET", "auth/session", `${platformCookie}; ${impCookie}`)).status, 401, "revoked");
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[FX-32] A real AI provider, or an honest demo label${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("FX-32: no provider configured means a clear 424, never a silent keyword mock", async () => {
    const router = ModelRouter.getInstance();
    try {
      router.configure({} as NodeJS.ProcessEnv);
      assert.strictEqual(router.getMode(), "NOT_CONFIGURED");
      await assert.rejects(router.chatWithRouting("TIER_1_FAST", [{ role: "user", content: "hi" }]), (e: Error & { code?: string }) => e.code === "AI_PROVIDER_NOT_CONFIGURED");
      const status = await call("GET", "ai/status", owner.token);
      assert.strictEqual((status.json.data as { mode: string }).mode, "NOT_CONFIGURED");

      router.configure({ AI_DEMO_MODE: "1" } as NodeJS.ProcessEnv);
      const demo = await router.chatWithRouting("TIER_1_FAST", [{ role: "user", content: "delivery charge koto?" }]);
      assert.strictEqual(demo.demo, true);
      assert.strictEqual(demo.costUsd, 0, "the demo costs nothing");
      assert.strictEqual(router.resolveModelName("TIER_1_FAST"), "demo-keyword-mock", "no gemini-1.5 names");
    } finally {
      router.configure({ AI_DEMO_MODE: "1" } as NodeJS.ProcessEnv);
    }
  });

  await runTest("FX-32: a configured OpenAI-compatible provider is called for real, tool calls round-trip, usage is priced", async () => {
    const router = ModelRouter.getInstance();
    const realFetch = globalThis.fetch;
    const requests: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
    let turn = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
      if (String(url).endsWith("/embeddings")) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 });
      }
      turn++;
      const message =
        turn === 1
          ? { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_shipping_estimate", arguments: "{\"delivery_zone\":\"INSIDE_DHAKA\"}" } }] }
          : { content: "ঢাকার ভেতরে ডেলিভারি চার্জ" };
      return new Response(JSON.stringify({ model: "m-fast", choices: [{ message }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } }), { status: 200 });
    }) as typeof fetch;
    try {
      router.configure({ LLM_BASE_URL: "https://llm.example.test/v1", LLM_API_KEY: "sk-p3-test", LLM_MODEL_FAST: "m-fast", LLM_EMBEDDING_MODEL: "m-embed" } as NodeJS.ProcessEnv);
      assert.strictEqual(router.getMode(), "LIVE");
      const tools = [{ name: "get_shipping_estimate", description: "fee", parameters: { type: "object" as const, properties: {} } }];
      const first = await router.chatWithRouting("TIER_1_FAST", [{ role: "user", content: "charge?" }], tools);
      assert.strictEqual(first.tool_calls?.[0]?.name, "get_shipping_estimate");
      assert.deepStrictEqual(first.tool_calls?.[0]?.arguments, { delivery_zone: "INSIDE_DHAKA" });
      assert.ok(first.costUsd > 0, "priced from reported usage");
      assert.strictEqual(requests[0].url, "https://llm.example.test/v1/chat/completions");
      assert.strictEqual(requests[0].auth, "Bearer sk-p3-test");
      assert.strictEqual(requests[0].body.model, "m-fast");

      // The assistant turn that called the tool goes back with its tool_calls, before the tool result
      await router.chatWithRouting("TIER_1_FAST", [
        { role: "user", content: "charge?" },
        { role: "assistant", content: "", tool_calls: first.tool_calls },
        { role: "tool", tool_call_id: "call_1", name: "get_shipping_estimate", content: "{\"delivery_charge\":60}" },
      ], tools);
      const sent = requests[1].body.messages as Array<Record<string, unknown>>;
      assert.strictEqual((sent[1].tool_calls as Array<{ id: string }>)[0].id, "call_1");
      assert.strictEqual(sent[2].tool_call_id, "call_1");

      const vector = await router.generateEmbedding("hello");
      assert.deepStrictEqual(vector, [0.1, 0.2, 0.3]);
      assert.strictEqual(requests[2].body.model, "m-embed");

      // A failing provider with no fallback configured fails; the mock never answers instead
      globalThis.fetch = (async () => new Response("down", { status: 500 })) as typeof fetch;
      await assert.rejects(router.chatWithRouting("TIER_1_FAST", [{ role: "user", content: "x" }]), (e: Error & { code?: string }) => e.code === "LLM_PROVIDER_ERROR");
    } finally {
      globalThis.fetch = realFetch;
      router.configure({ AI_DEMO_MODE: "1" } as NodeJS.ProcessEnv);
    }
  });

  // ---------------------------------------------------------------------------
  console.log(`\n${ANSI_BOLD}[Review follow-ups] Impersonation, limits, AI grounding${ANSI_RESET}`);
  // ---------------------------------------------------------------------------

  await runTest("support sessions: no self-granted MUTATION_APPROVED; demoted operators and suspended members are refused", async () => {
    await assert.rejects(
      PlatformSupportService.startImpersonationSession(
        { targetTenantId: tenantId, targetUserId: owner.id, reason: "P3 attempt to change the workspace", mode: "MUTATION_APPROVED", durationMinutes: 15 },
        operatorCtx as never
      ),
      (e: Error & { code?: string }) => e.code === "APPROVAL_REQUIRED"
    );
    const { token } = await PlatformSupportService.startImpersonationSession(
      { targetTenantId: tenantId, targetUserId: owner.id, reason: "P3 customer ticket investigation", mode: "READ_ONLY", durationMinutes: 15 },
      operatorCtx as never
    );
    const session = async () => {
      const mod = (await import("@/app/api/v1/auth/session/route")) as { GET: (r: Request) => Promise<Response> };
      return (await mod.GET(new Request(`${BASE}/auth/session`, { headers: { cookie: `${platformCookie}; commerceos_impersonation=${token}` } }))).status;
    };
    assert.strictEqual(await session(), 200);
    // The operator is demoted to a role without support.impersonate
    db.savePlatformMembership({ id: `pm_${operatorId}`, user_id: operatorId, role: "PLATFORM_ANALYST", mfa_enabled: false, is_active: true, created_at: nowIso(), updated_at: nowIso() });
    assert.strictEqual(await session(), 401, "the session ends with the operator's authority");
    db.savePlatformMembership({ id: `pm_${operatorId}`, user_id: operatorId, role: "SUPER_ADMIN", mfa_enabled: false, is_active: true, created_at: nowIso(), updated_at: nowIso() });
    // The target member is suspended
    const m = db.findMembership(tenantId, owner.id);
    assert.ok(m);
    db.data.memberships = db.data.memberships.map((x) => (x.id === m.id ? { ...x, status: "SUSPENDED" as const } : x));
    assert.strictEqual(await session(), 401, "no session into a suspended member");
    db.data.memberships = db.data.memberships.map((x) => (x.id === m.id ? { ...x, status: undefined } : x));
  });

  await runTest("bulk import respects the product plan limit", async () => {
    const existing = db.getAllProducts(tenantId).filter((x) => x.status !== "ARCHIVED").length;
    db.saveTenantEntitlement({ tenant_id: tenantId, entitlement_id: "max_products", value: existing + 1, is_override: true, updated_at: nowIso() });
    const result = await ProductService.bulkImportProducts(ownerCtx, [
      { title: "Import One", sku: uid("IMP1"), base_price: 100, stock: 1 },
      { title: "Import Two", sku: uid("IMP2"), base_price: 100, stock: 1 },
    ], { mode: "upsert", auto_create_categories: true });
    assert.strictEqual(result.imported_count, 1);
    assert.strictEqual(result.failed_count, 1);
    assert.ok(result.errors[0].reason.includes("plan allows"));
    db.saveTenantEntitlement({ tenant_id: tenantId, entitlement_id: "max_products", value: 100000, is_override: true, updated_at: nowIso() });
  });

  await runTest("a module's AI tools are off with its feature flag", async () => {
    db.savePlatformFeatureFlag({ id: "flag_enterprise", key: "enterprise", description: "Enterprise module", is_enabled_globally: false, percentage_rollout: 100, scope: "TENANT", tenant_allowlist: [], rules: {}, created_at: nowIso(), updated_at: nowIso() });
    try {
      await assert.rejects(
        toolRegistry.executeTool(ownerCtx, { toolName: new ResolveSemanticMetricTool().name, arguments: { metric_key: "gross_revenue" }, agentRunId: "run_p3", conversationId: "conv_p3" }),
        (e: Error & { code?: string }) => e.code === "FEATURE_NOT_ENTITLED"
      );
    } finally {
      db.savePlatformFeatureFlag({ id: "flag_enterprise", key: "enterprise", description: "Enterprise module", is_enabled_globally: true, percentage_rollout: 100, scope: "GLOBAL", tenant_allowlist: [], rules: {}, created_at: nowIso(), updated_at: nowIso() });
    }
  });

  await runTest("moving an order through a shipment update needs orders.update", async () => {
    const o = await newOrder();
    await OrderService.transitionOrderStatus(ownerCtx, o.id, "CONFIRMED");
    const shipment = await ShippingService.createShipment(ownerCtx, { order_id: o.id, courier_provider: "PATHAO", tracking_number: uid("PTH") });
    const shippingOnly = { ...ownerCtx, permissions: ownerCtx.permissions.filter((x) => x !== "orders.update") };
    await assert.rejects(ShippingService.updateDeliveryStatus(shippingOnly, shipment.id, "DELIVERED"), (e: Error & { code?: string }) => e.code === "FORBIDDEN");
    assert.strictEqual(db.findOrderById(tenantId, o.id)?.status, "READY_TO_SHIP");
  });

  await runTest("AI answers are grounded in the workspace's fees and real prices", async () => {
    const fees = PricingService.getDeliveryFees(tenantId);
    const prompt = ContextBuilder.formatPromptContext({ tenant_id: tenantId, conversation_id: "c", channel_type: "WHATSAPP", recent_messages: [], retrieved_knowledge: [] } as never);
    assert.ok(prompt.includes(`Outside Dhaka ৳${fees.outside_dhaka_bdt}`));
    const tool = new CalculateCheckoutTool();
    await assert.rejects(tool.execute(ownerCtx, tool.schema.parse({ items: [{ variant_id: "var_missing", quantity: 1 }], district: "Dhaka" })));
    await assert.rejects(tool.execute(ownerCtx, tool.schema.parse({ items: [{ variant_id: lcVariant, quantity: 1 }] })), "no district, no guessed zone");
    const quote = await tool.execute(ownerCtx, tool.schema.parse({ items: [{ variant_id: lcVariant, quantity: 2 }], district: "Khulna" }));
    assert.strictEqual(quote.delivery_zone, "OUTSIDE_DHAKA");
    assert.strictEqual(quote.delivery_charge, fees.outside_dhaka_bdt);
    assert.strictEqual(quote.subtotal, 1000, "the variant's real price, never a DEMO-SKU");
  });

  // Clears the store, so it runs last
  await runTest("demo seed: no made-up telemetry; old stores can be cleaned without touching user records", () => {
    db.clearAllForTesting();
    db.ensureDefaultSeed();
    assert.strictEqual(db.data.platform_health_records.length, 0);
    assert.strictEqual(db.data.provider_health.length, 0);
    assert.strictEqual(db.data.courier_performances.length, 0);
    assert.strictEqual(db.data.slo_definitions.length, 0);
    assert.ok(db.data.model_registry.every((m) => Object.keys(m.metrics).length === 0));
    assert.ok(db.data.business_objectives.every((o) => o.progress_percent === 0 && o.forecast_achievement_percent === null));

    const now = nowIso();
    const old: DemoTelemetryData = {
      provider_health: [{ id: "ph_bkash" }, { id: "ph_user_added" }],
      platform_health_records: [{ id: "ph_baseline" }],
      slo_definitions: [{ id: "slo_api_availability" } as never, { id: "slo_mine" } as never],
      courier_performances: [
        { courier_provider: "STEADFAST", tenant_id: "t", delivery_success_rate: 0.94, average_delivery_hours: 28, return_rate: 0.05, active_shipments_count: 42, cost_per_kg_bdt: 60, is_available: true, rating_score: 92, last_updated: now },
        { courier_provider: "PATHAO", tenant_id: "t", delivery_success_rate: 0.9, average_delivery_hours: 20, return_rate: 0.05, active_shipments_count: 7, cost_per_kg_bdt: 70, is_available: true, rating_score: 80, last_updated: now },
      ],
      model_registry: [{ id: "mod_rfm_segmenter_v1", metrics: { silhouette_score: 0.78 }, status: "DEPLOYED" } as never],
      business_objectives: [
        { id: "obj_increase_revenue", progress_percent: 42, baseline_value: 10, current_value: 8, forecast_achievement_percent: 78, budget_spent_bdt: 5 } as never,
        { id: "obj_delivery_success", progress_percent: 60, baseline_value: 1, current_value: 2, forecast_achievement_percent: 1, budget_spent_bdt: 1 } as never,
      ],
    };
    const dry = cleanDemoTelemetry(old, { apply: false });
    assert.deepStrictEqual(dry, { provider_health_removed: 1, platform_health_removed: 1, slos_removed: 1, courier_performances_removed: 1, model_metrics_cleared: 1, objectives_reset: 1 });
    assert.strictEqual(old.provider_health.length, 2, "a dry run changes nothing");
    cleanDemoTelemetry(old, { apply: true });
    assert.deepStrictEqual(old.provider_health.map((x) => x.id), ["ph_user_added"]);
    assert.deepStrictEqual(old.slo_definitions.map((x) => x.id), ["slo_mine"]);
    assert.deepStrictEqual(old.courier_performances.map((x) => x.courier_provider), ["PATHAO"]);
    assert.strictEqual(old.business_objectives[0].progress_percent, 0);
    assert.strictEqual(old.business_objectives[1].progress_percent, 60, "an objective the user changed is left alone");
  });

  await runTest("grep gate: known fabrication patterns are gone from src/", () => {
    const patterns: Array<[RegExp, string]> = [
      [/baselineGMV|syntheticBase/, "synthetic baselines"],
      [/period_change_pct:\s*[0-9]/, "literal period change"],
      [/\?\?\s*(4999|2450000|18420|1420|184500)\b/, "literal metric fallbacks"],
      [/Math\.random\(\)\s*\*\s*\d+\s*\+\s*\d+\)/, "random latencies"],
      [/STF-2026-PENDING|"Steadfast Courier \/ Pathao"/, "invented courier"],
      [/target_url\.includes\("fail"\)/, "URL-based fake delivery"],
      [/\(৳120\)|৳120 delivery charge|৳60-70/, "literal delivery fee in the UI"],
      [/\? "Dhaka" : "Chittagong"/, "invented outside-Dhaka district"],
      [/db\.updateOrderStatus\(/, "order status written outside the lifecycle service"],
      [/calculatedValue = 32\.5|: 94\.2;|forecast_achievement_percent: 65/, "literal metric values"],
      [/(idx|index)\s*\*\s*[0-9.]+\)*[,;]?\s*$/m, "per-position invented values"],
      [/totalRevenue \* 0\.\d+/, "fixed revenue shares"],
      [/assigned_scope:\s*\{[^}]*all_access:\s*true[^}]*\},?\s*\n\s*status:\s*"ACTIVE"/, "synthetic all-access caller"],
    ];
    const allowed = new Set([path.normalize("src/domains/enterprise/organization-access.ts")]);
    // The lifecycle service is the one writer; the dead Neon repository is rebuilt in Phase 4
    const statusWriters = new Set([path.normalize("src/domains/orders/order-lifecycle.service.ts"), path.normalize("src/domains/orders/order.repository.ts")]);
    const hits: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = fs.readFileSync(file, "utf8");
      for (const [re, label] of patterns) {
        const exempt =
          (label === "synthetic all-access caller" && allowed.has(path.normalize(file))) ||
          (label === "order status written outside the lifecycle service" && statusWriters.has(path.normalize(file)));
        if (re.test(text) && !exempt) {
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
