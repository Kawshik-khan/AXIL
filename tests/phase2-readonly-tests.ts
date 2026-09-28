/**
 * Phase 2 read-only suite (FIX_IMPLEMENTATION_PLAN FX-21, audit H8): a GET must never change the store.
 * Calls every tenant GET handler under src/app/api/v1 in-process as the workspace OWNER and fingerprints each store
 * collection before and after. Any difference is a write-on-read and fails the suite with the route and collections.
 * Run: node tests/ts-runner.cjs ./tests/phase2-readonly-tests.ts
 */
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { db } from "@/infrastructure/db";
import { AuthService } from "@/domains/auth/service";
import { hashPassword, PLATFORM_AUTH_COOKIE_NAME, signSessionToken } from "@/lib/security";
import { resetRateLimitsForTesting } from "@/lib/rate-limit";
import { mergeComputedRow } from "@/lib/computed-rows";
import { SNAPSHOT_KINDS } from "@/domains/intelligence/services/intelligence-snapshot.service";
import type { Customer, InventoryItem, Order, OrderItem, Payment, Product, ProductVariant, Shipment } from "@/types/commerce";

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

const API_ROOT = path.resolve(__dirname, "../src/app/api/v1");
const BASE = "http://localhost:3000/api/v1";

type Handler = (r: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

/** Every route directory (relative to api/v1) whose route.ts exports GET. */
function allGetRoutes(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts" && /export\s+(async\s+)?(function|const)\s+GET\b/.test(fs.readFileSync(full, "utf-8"))) {
        found.push(path.relative(API_ROOT, dir).split(path.sep).join("/"));
      }
    }
  };
  walk(API_ROOT);
  return found.sort();
}
const tenantGetRoutes = () => allGetRoutes().filter((r) => !r.startsWith("platform"));
const platformGetRoutes = () => allGetRoutes().filter((r) => r.startsWith("platform"));

/**
 * A real id for each dynamic segment, taken from the store, so `[id]` routes run past their not-found check.
 * `orders/[id]` → a row of `orders`; `growth/lifecycle/[customerId]` → a row of `customers`. Tenant rows are
 * preferred. Returns null when no collection matches.
 */
function realParams(route: string, tenantId: string): Record<string, string> | null {
  const segments = route.split("/");
  const params: Record<string, string> = {};
  const data = db.data as unknown as Record<string, Array<Record<string, unknown>>>;
  for (let i = 0; i < segments.length; i++) {
    const m = /^\[(?:\.\.\.)?([^\]]+)\]$/.exec(segments[i]);
    if (!m) continue;
    const name = m[1];
    const base = /Id$/.test(name) ? `${name.slice(0, -2)}s` : (segments[i - 1] ?? "");
    const snake = base.replace(/-/g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    const candidates = [snake, ...Object.keys(data).filter((k) => k.endsWith(`_${snake}`))];
    let id: string | undefined;
    for (const key of candidates) {
      const rows = Array.isArray(data[key]) ? data[key] : [];
      const row = rows.find((r) => r.tenant_id === tenantId) ?? rows[0];
      if (row && typeof row.id === "string") {
        id = row.id;
        break;
      }
    }
    if (!id) return null;
    params[name] = id;
  }
  return params;
}

/** Per-collection fingerprints of the store, so a diff names what changed. */
function fingerprint(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(db.data as unknown as Record<string, unknown>)) {
    out.set(key, crypto.createHash("sha1").update(JSON.stringify(value) ?? "").digest("hex"));
  }
  return out;
}

function changedCollections(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k));
}

/** Enough data that every detector fires: sales, low stock, dead stock, failed payments, returned parcels. */
function seedCommerce(tenantId: string) {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  for (let v = 0; v < 3; v++) {
    db.data.products.push({
      id: `prod_ro_${v}`, tenant_id: tenantId, name: `Reader Product ${v}`, slug: `reader-${v}`, description: "", sku: `RO-P${v}`,
      base_price: 1500, cost_price: 800, currency: "BDT", status: "ACTIVE", images: [], created_at: iso, updated_at: iso,
    } as unknown as Product);
    db.data.product_variants.push({
      id: `var_ro_${v}`, tenant_id: tenantId, product_id: `prod_ro_${v}`, sku: `RO-V${v}`, title: "Default", price: 1500, cost_price: 800,
      attributes: {}, status: "ACTIVE", created_at: iso, updated_at: iso,
    } as unknown as ProductVariant);
    db.data.inventory_items.push({
      id: `inv_ro_${v}`, tenant_id: tenantId, warehouse_id: "wh_ro", product_variant_id: `var_ro_${v}`,
      quantity_on_hand: v === 2 ? 500 : 1, quantity_reserved: 0, quantity_available: v === 2 ? 500 : 1, reorder_point: 10, updated_at: iso,
    } as unknown as InventoryItem);
  }
  for (let i = 0; i < 12; i++) {
    const at = new Date(now - (i % 6) * 86_400_000).toISOString();
    db.data.customers.push({
      id: `cus_ro_${i}`, tenant_id: tenantId, first_name: `Ro${i}`, last_name: "Reader", phone: `+8801900000${String(i).padStart(3, "0")}`,
      status: "ACTIVE", source: "WEBSITE", created_at: at, updated_at: at,
    } as unknown as Customer);
    db.data.orders.push({
      id: `ord_ro_${i}`, tenant_id: tenantId, order_number: `RO-${i}`, customer_id: `cus_ro_${i % 6}`, status: i % 5 === 0 ? "CANCELLED" : "DELIVERED",
      currency: "BDT", subtotal: 1500, discount_total: 0, shipping_total: 60, tax_total: 0, grand_total: 1560, payment_method: "COD",
      payment_status: "PAID", fulfillment_status: "FULFILLED", shipping_address_snapshot: { district: "Dhaka" }, source: "WEBSITE",
      created_at: at, updated_at: at,
    } as unknown as Order);
    db.data.order_items.push({
      id: `oi_ro_${i}`, tenant_id: tenantId, order_id: `ord_ro_${i}`, variant_id: `var_ro_${i % 2}`, product_variant_id: `var_ro_${i % 2}`,
      product_title: "Reader Product", variant_title: "Default", sku: `RO-V${i % 2}`, quantity: 3, unit_price: 500, total_price: 1500, created_at: at,
    } as unknown as OrderItem);
    db.data.payments.push({
      id: `pay_ro_${i}`, tenant_id: tenantId, order_id: `ord_ro_${i}`, provider: "BKASH", amount: 1560, currency: "BDT",
      status: i % 2 === 0 ? "FAILED" : "PAID", created_at: at,
    } as unknown as Payment);
    db.data.shipments.push({
      id: `shp_ro_${i}`, tenant_id: tenantId, order_id: `ord_ro_${i}`, courier_provider: "STEADFAST", tracking_number: `TRK${i}`,
      status: i % 3 === 0 ? "RETURNED" : "DELIVERED", shipping_cost: 60, created_at: at, updated_at: at,
    } as unknown as Shipment);
  }
}

/** GETs whose behaviour branches on a query parameter: each variant is swept as well as the bare route. */
const QUERY_VARIANTS: Record<string, string[]> = {
  "ai/agents": ["?view=orchestration", "?view=registry"],
  "enterprise/metrics": ["?metric_key=gross_revenue"],
};

async function sweep(
  routes: string[],
  headers: Record<string, string>,
  tenantId: string
): Promise<{ writers: string[]; errors: string[]; realIdRoutes: number }> {
  const writers: string[] = [];
  const errors: string[] = [];
  let realIdRoutes = 0;
  for (const route of routes) {
    const dynamic = route.includes("[");
    const real = dynamic ? realParams(route, tenantId) : null;
    if (real) realIdRoutes++;
    for (const query of ["", ...(QUERY_VARIANTS[route] ?? [])]) {
      await sweepOne(route, query, headers, null, writers, errors);
      if (real) await sweepOne(route, query, headers, real, writers, errors);
    }
  }
  return { writers, errors, realIdRoutes };
}

async function sweepOne(
  route: string,
  query: string,
  headers: Record<string, string>,
  real: Record<string, string> | null,
  writers: string[],
  errors: string[]
): Promise<void> {
  const params: Record<string, string> = {};
  const url = route.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_m, _rest, name: string) => {
    params[name] = real?.[name] ?? `missing_${name}`;
    return params[name];
  });
  const label = `GET /api/v1/${url}${query}`;
  let mod: { GET?: Handler };
  try {
    mod = (await import(`@/app/api/v1/${route}/route`)) as { GET?: Handler };
  } catch (err) {
    errors.push(`${route}: import failed (${(err as Error).message.slice(0, 80)})`);
    return;
  }
  if (!mod.GET) return;
  // Twice: the first call may legitimately warm in-memory caches; neither call may write.
  for (let pass = 0; pass < 2; pass++) {
    const before = fingerprint();
    const signalsBefore = db.getWriteSignalCount();
    try {
      await mod.GET(new NextRequest(`${BASE}/${url}${query}`, { headers }), { params });
    } catch (err) {
      errors.push(`${label}: threw ${(err as Error).message.slice(0, 80)}`);
    }
    const changed = changedCollections(before, fingerprint());
    // Content unchanged is not enough: a request that asks for a flush still rewrites the file.
    const signals = db.getWriteSignalCount() - signalsBefore;
    if (changed.length > 0 || signals > 0) {
      writers.push(`${label} (pass ${pass + 1}) wrote: ${changed.join(", ") || "-"}; write requests: ${signals}`);
      return;
    }
  }
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 2: GET REQUESTS ARE WRITE-FREE (FX-21)   ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);

  const password = "Phase2-Reader-Pass-8812!";
  const shop = await AuthService.registerTenantWithOwner({
    email: `owner_${crypto.randomUUID().slice(0, 8)}@phase2.test`,
    password,
    name: "Phase 2 Owner",
    workspaceName: "Phase 2 Read-Only Shop",
  });
  const tenantId = shop.tenant.id;
  seedCommerce(tenantId);
  const token = (await AuthService.login(shop.user.email, password, tenantId)).token;

  // An organization, so enterprise GETs get past organization resolution instead of answering 404.
  const { POST: createOrg } = (await import("@/app/api/v1/enterprise/organizations/route")) as { POST: (r: Request) => Promise<Response> };
  const orgRes = await createOrg(
    new NextRequest(`${BASE}/enterprise/organizations`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Phase Two Group" }),
    })
  );
  assert.strictEqual(orgRes.status, 201, "organization created for the enterprise routes");

  const routes = tenantGetRoutes();

  // 1. Before any recompute: every intelligence GET computes LIVE.
  const live = await sweep(routes, { authorization: `Bearer ${token}` }, tenantId);
  console.log(`      swept ${routes.length} tenant GET routes (${live.realIdRoutes} [id] routes also with real ids)`);
  if (live.errors.length) console.log(`      (${live.errors.length} handler errors, not failures of this suite)`);
  await runTest(`no tenant GET route changes the store (${routes.length} routes, 2 passes each, live compute)`, () => {
    assert.deepStrictEqual(live.writers, [], `\n        ${live.writers.join("\n        ")}`);
  });

  await runTest("a recommendation shown live (never stored) can still be proposed as a decision", async () => {
    const { GET } = (await import("@/app/api/v1/intelligence/recommendations/route")) as { GET: Handler };
    const listed = (await (
      await GET(new NextRequest(`${BASE}/intelligence/recommendations`, { headers: { authorization: `Bearer ${token}` } }), { params: {} })
    ).json()) as { data: { recommendations: Array<{ id: string }> }; meta: { snapshot: { source: string } } };
    assert.strictEqual(listed.meta.snapshot.source, "LIVE");
    const id = listed.data.recommendations[0]?.id;
    assert.ok(id, "a recommendation is shown");
    assert.strictEqual(db.getRecommendationById(tenantId, id), undefined, "it isn't stored yet");
    type IdPost = (r: Request, ctx: { params: { id: string } }) => Promise<Response>;
    const { POST } = (await import("@/app/api/v1/intelligence/recommendations/[id]/propose-decision/route")) as { POST: IdPost };
    const res = await POST(
      new NextRequest(`${BASE}/intelligence/recommendations/${id}/propose-decision`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      }),
      { params: { id } }
    );
    assert.strictEqual(res.status, 201, `propose-decision answered ${res.status}`);
    assert.ok(db.getRecommendationById(tenantId, id), "proposing stored it");
  });

  // 2. The explicit write path.
  type PostHandler = (r: Request) => Promise<Response>;
  const { POST: recompute } = (await import("@/app/api/v1/intelligence/recompute/route")) as { POST: PostHandler };
  const postOnce = (bearer: string) =>
    recompute(new NextRequest(`${BASE}/intelligence/recompute`, { method: "POST", headers: { authorization: `Bearer ${bearer}` } }));
  // Most tests recompute several times a minute; the limit itself is tested separately.
  const post = (bearer: string) => {
    resetRateLimitsForTesting();
    return postOnce(bearer);
  };
  const tenantRows = (collection: string) =>
    ((db.data as unknown as Record<string, Array<{ tenant_id: string }>>)[collection] ?? []).filter((r) => r.tenant_id === tenantId).length;

  await runTest("POST /intelligence/recompute needs analytics.manage (SALES → 403, nothing stored)", async () => {
    const salesId = `usr_p2_sales_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.createUser({ id: salesId, email: `${salesId}@phase2.test`, name: "P2 Sales", password_hash: "!disabled", status: "ACTIVE", created_at: now, updated_at: now });
    db.createMembership({ id: `mem_${salesId}`, tenant_id: tenantId, user_id: salesId, role: "SALES", created_at: now, updated_at: now });
    const salesToken = await signSessionToken({ userId: salesId, tenantId, role: "SALES", email: `${salesId}@phase2.test`, name: "P2 Sales" });
    const res = await post(salesToken);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(db.getIntelligenceRun(tenantId, "anomalies"), undefined);
  });

  const COLLECTIONS = ["anomalies", "opportunities", "risks", "recommendations", "customer_intelligence", "cohort_records", "growth_recommendations"];
  await runTest("recompute stores every kind once, and a second recompute adds no duplicate rows", async () => {
    const res = await post(token);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { data: { kinds: Array<{ kind: string; rows: number }> } };
    assert.ok(body.data.kinds.length >= 12, `kinds: ${body.data.kinds.map((k) => k.kind).join(",")}`);
    const firstCounts = Object.fromEntries(COLLECTIONS.map((c) => [c, tenantRows(c)]));
    for (const c of ["anomalies", "opportunities", "risks", "recommendations"]) assert.ok(firstCounts[c] > 0, `${c} detected`);
    assert.strictEqual((await post(token)).status, 200);
    assert.deepStrictEqual(Object.fromEntries(COLLECTIONS.map((c) => [c, tenantRows(c)])), firstCounts);
    assert.ok(db.getAuditLogsByTenant(tenantId, 50, 0).logs.some((l) => l.action === "INTELLIGENCE_RECOMPUTED"));
  });

  await runTest("a recompute keeps a user's decision on a recommendation, and so does a live read", async () => {
    const rec = db.getRecommendations(tenantId)[0];
    db.updateRecommendation(tenantId, rec.id, { status: "REJECTED", rejection_reason: "not now" });
    assert.strictEqual((await post(token)).status, 200);
    assert.strictEqual(db.getRecommendationById(tenantId, rec.id)?.status, "REJECTED");
    const { GET } = (await import("@/app/api/v1/intelligence/recommendations/route")) as { GET: Handler };
    const read = async () =>
      (await (
        await GET(new NextRequest(`${BASE}/intelligence/recommendations`, { headers: { authorization: `Bearer ${token}` } }), { params: {} })
      ).json()) as { data: { recommendations: Array<{ id: string; status: string }> }; meta: { snapshot: { source: string } } };
    const fresh = await read();
    assert.strictEqual(fresh.meta.snapshot.source, "SNAPSHOT");
    assert.strictEqual(fresh.data.recommendations.find((r) => r.id === rec.id)?.status, "REJECTED");
    // Age the snapshot past 15 minutes: the GET computes live, still write-free, still shows the decision.
    const run = db.data.intelligence_runs.find((r) => r.tenant_id === tenantId && r.kind === "recommendations");
    assert.ok(run);
    run.computed_at = new Date(Date.now() - 16 * 60_000).toISOString();
    const before = fingerprint();
    const stale = await read();
    assert.strictEqual(stale.meta.snapshot.source, "LIVE");
    assert.strictEqual(stale.data.recommendations.find((r) => r.id === rec.id)?.status, "REJECTED");
    assert.deepStrictEqual(changedCollections(before, fingerprint()), []);
  });

  // Phase 2 security review M-1: a decision stays attached to what was decided.
  const recs = () => db.getRecommendations(tenantId);
  await runTest("a decision doesn't carry over to a different set of entities (new proposal, old decision kept as history)", async () => {
    resetRateLimitsForTesting();
    assert.strictEqual((await post(token)).status, 200);
    const clearance = recs().find((r) => r.type === "DISCOUNT_DEAD_STOCK");
    assert.ok(clearance, "a dead-stock clearance is proposed");
    db.updateRecommendation(tenantId, clearance.id, { status: "REJECTED", rejection_reason: "not these items" });
    // A new dead-stock SKU changes the set the clearance is about.
    const iso = new Date().toISOString();
    db.data.products.push({ id: "prod_ro_dead2", tenant_id: tenantId, name: "Idle Item", slug: "idle", description: "", sku: "RO-IDLE",
      base_price: 900, currency: "BDT", status: "ACTIVE", images: [], created_at: iso, updated_at: iso } as unknown as Product);
    db.data.product_variants.push({ id: "var_ro_dead2", tenant_id: tenantId, product_id: "prod_ro_dead2", sku: "RO-IDLE", title: "Default",
      price: 900, attributes: {}, status: "ACTIVE", created_at: iso, updated_at: iso } as unknown as ProductVariant);
    db.data.inventory_items.push({ id: "inv_ro_dead2", tenant_id: tenantId, warehouse_id: "wh_ro", product_variant_id: "var_ro_dead2",
      quantity_on_hand: 300, quantity_reserved: 0, quantity_available: 300, reorder_point: 10, updated_at: iso } as unknown as InventoryItem);
    assert.strictEqual((await post(token)).status, 200);
    const next = recs().filter((r) => r.type === "DISCOUNT_DEAD_STOCK" && r.id !== clearance.id);
    assert.strictEqual(next.length, 1, "the changed set is a new recommendation");
    assert.strictEqual(next[0].status, "PROPOSED");
    assert.strictEqual(db.getRecommendationById(tenantId, clearance.id)?.status, "REJECTED", "the old decision stays on the old row");
  });

  await runTest("a recommendation under review is not changed by a recompute", async () => {
    const rec = recs().find((r) => r.status === "PROPOSED");
    assert.ok(rec);
    db.updateRecommendation(tenantId, rec.id, { status: "REVIEWING", description: "text the approver is looking at" });
    assert.strictEqual((await post(token)).status, 200);
    const after = db.getRecommendationById(tenantId, rec.id);
    assert.strictEqual(after?.status, "REVIEWING");
    assert.strictEqual(after?.description, "text the approver is looking at");
    db.updateRecommendation(tenantId, rec.id, { status: "PROPOSED" });
  });

  await runTest("an expired decision doesn't suppress the same recommendation when it is needed again", async () => {
    const rec = recs().find((r) => r.type === "REORDER_STOCK");
    assert.ok(rec, "a restock is proposed");
    db.updateRecommendation(tenantId, rec.id, { status: "APPROVED", dispatched_workflow_id: "wf_old", expires_at: new Date(Date.now() - 60_000).toISOString() });
    assert.strictEqual((await post(token)).status, 200);
    const after = db.getRecommendationById(tenantId, rec.id);
    assert.strictEqual(after?.status, "PROPOSED");
    assert.strictEqual(after?.dispatched_workflow_id, undefined);
  });

  await runTest("a decision lapses at its original expiry even when recomputes run every few days", () => {
    const day = 86_400_000;
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    const row = (at: number, extra: Record<string, unknown> = {}) => ({
      id: "rec_t_restock_v1", tenant_id: "t", type: "REORDER_STOCK", status: "PROPOSED",
      affected_entities: [{ type: "INVENTORY_VARIANT", id: "v1" }], expires_at: new Date(at + 5 * day).toISOString(), ...extra,
    });
    let stored: Record<string, unknown> = { ...row(t0), status: "REJECTED", rejection_reason: "not now" };
    const seen: string[] = [];
    for (let d = 4; d <= 12; d += 4) {
      const now = t0 + d * day;
      stored = mergeComputedRow(stored, row(now), SNAPSHOT_KINDS.recommendations, now);
      seen.push(`day${d}:${stored.status}`);
    }
    assert.deepStrictEqual(seen, ["day4:REJECTED", "day8:PROPOSED", "day12:PROPOSED"]);
  });

  await runTest("proposing an unknown recommendation id is a 404 and writes nothing", async () => {
    type IdPost = (r: Request, ctx: { params: { id: string } }) => Promise<Response>;
    const { POST } = (await import("@/app/api/v1/intelligence/recommendations/[id]/propose-decision/route")) as { POST: IdPost };
    const signals = db.getWriteSignalCount();
    const res = await POST(
      new NextRequest(`${BASE}/intelligence/recommendations/rec_does_not_exist/propose-decision`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      }),
      { params: { id: "rec_does_not_exist" } }
    );
    assert.strictEqual(res.status, 404);
    assert.strictEqual(db.getWriteSignalCount(), signals, "no recompute was stored");
  });

  await runTest("POST /intelligence/recompute is rate-limited per workspace (429 on the third call in a minute)", async () => {
    resetRateLimitsForTesting();
    assert.strictEqual((await postOnce(token)).status, 200);
    assert.strictEqual((await postOnce(token)).status, 200);
    assert.strictEqual((await postOnce(token)).status, 429);
    resetRateLimitsForTesting();
  });

  // Negative tenant-isolation checks for the new store accessors (Phase 2 security review).
  await runTest("another tenant can't drop, read or count this tenant's snapshot, cohort or message rows", () => {
    const other = "ten_p2_other_tenant";
    const before = db.getCustomerIntelligence(tenantId).length;
    assert.ok(before > 0);
    db.upsertComputedRows("customer_intelligence", other, "customers", [], { replace: true });
    assert.strictEqual(db.getCustomerIntelligence(tenantId).length, before, "replace for another tenant leaves these rows");

    const cohorts = db.getCohortRecords(tenantId).length;
    assert.ok(cohorts > 0);
    db.data.cohort_records.push({ cohort_month: "2020-01", initial_size: 1, periods: [] } as never); // pre-Phase-2 row without tenant
    assert.strictEqual(db.getCohortRecords(other).length, 0);
    assert.strictEqual(db.getCohortRecords(tenantId).length, cohorts, "legacy rows without a tenant are never returned");

    const iso = new Date().toISOString();
    db.data.conversations.push({ id: "conv_ro_1", tenant_id: tenantId, customer_id: "cus_ro_0", channel_id: "ch", channel_type: "WHATSAPP",
      status: "OPEN", priority: "NORMAL", unread_count: 0, tags: [], external_conversation_id: "x", last_message_at: iso, created_at: iso, updated_at: iso } as never);
    db.data.messages.push({ id: "msg_ro_1", tenant_id: tenantId, conversation_id: "conv_ro_1", sender_type: "BOT", content: "hi", created_at: iso } as never);
    assert.strictEqual(db.getCustomerMessages(tenantId, "cus_ro_0").length, 1);
    assert.strictEqual(db.getCustomerMessages(other, "cus_ro_0").length, 0);
  });

  // 3. After a recompute: intelligence GETs serve SNAPSHOTs; still no writes anywhere.
  assert.strictEqual((await post(token)).status, 200);
  const snap = await sweep(routes, { authorization: `Bearer ${token}` }, tenantId);
  await runTest(`no tenant GET route changes the store with fresh snapshots (${routes.length} routes)`, () => {
    assert.deepStrictEqual(snap.writers, [], `\n        ${snap.writers.join("\n        ")}`);
  });

  // 4. Platform GETs, as a signed-in operator.
  const opPassword = "Phase2-Operator-Pass-5519!";
  const opId = `usr_p2_op_${crypto.randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  db.createUser({ id: opId, email: `${opId}@operators.test`, name: "P2 Operator", password_hash: await hashPassword(opPassword), status: "ACTIVE", created_at: nowIso, updated_at: nowIso });
  db.savePlatformMembership({ id: `pm_${opId}`, user_id: opId, role: "SUPER_ADMIN", mfa_enabled: false, is_active: true, created_at: nowIso, updated_at: nowIso });
  const { POST: platformLogin } = (await import("@/app/api/v1/platform/auth/login/route")) as { POST: (r: Request) => Promise<Response> };
  const opLogin = await platformLogin(
    new NextRequest(`${BASE}/platform/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${opId}@operators.test`, password: opPassword }),
    })
  );
  const opCookie = opLogin.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${PLATFORM_AUTH_COOKIE_NAME}=`));
  const platformRoutes = platformGetRoutes();
  await runTest(`no platform GET route changes the store (${platformRoutes.length} routes, as an operator)`, async () => {
    assert.strictEqual(opLogin.status, 200, "operator signed in");
    assert.ok(opCookie, "operator session cookie");
    const platform = await sweep(platformRoutes, { cookie: opCookie }, tenantId);
    console.log(`      swept ${platformRoutes.length} platform GET routes (${platform.realIdRoutes} [id] routes also with real ids)`);
    assert.deepStrictEqual(platform.writers, [], `\n        ${platform.writers.join("\n        ")}`);
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Phase 2 read-only suite crashed:", err);
  process.exit(1);
});
