/**
 * Phase 1 RBAC matrix (FIX_IMPLEMENTATION_PLAN FX-10 / FX-61, audit H2).
 * Every handler from Appendix A is called through its real route module:
 *   - a SUPPORT member (no access to these modules) must get 403;
 *   - an ADMIN member must never get 401/403 (a 2xx or a domain error such as 400/404 is fine).
 * Plus: approver identity comes from the session, and high-risk campaigns need a second person.
 * Run: node tests/ts-runner.cjs ./tests/rbac-matrix-tests.ts
 */
import assert from "assert";
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import { signSessionToken } from "@/lib/security";
import { PERMISSIONS, ROLE_PERMISSIONS, RoleName } from "@/lib/permissions";
import type { GrowthCampaign } from "@/types/growth";

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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type PermissionKey = keyof typeof PERMISSIONS;

// Generated from FIX_IMPLEMENTATION_PLAN.md Appendix A: [route under /api/v1, method, required permission].
const MATRIX: Array<[string, Method, PermissionKey]> = [
  ["autonomous/cost", "GET", "AUTONOMOUS_READ"],
  ["autonomous/decisions", "GET", "DECISIONS_READ"],
  ["autonomous/decisions/[id]", "GET", "DECISIONS_READ"],
  ["autonomous/decisions/[id]/approve", "POST", "DECISIONS_APPROVE"],
  ["autonomous/decisions/[id]/reject", "POST", "DECISIONS_APPROVE"],
  ["autonomous/health", "GET", "AUTONOMOUS_READ"],
  ["autonomous/learning", "GET", "LEARNING_READ"],
  ["autonomous/objectives", "GET", "OBJECTIVES_READ"],
  ["autonomous/objectives", "POST", "OBJECTIVES_MANAGE"],
  ["autonomous/objectives/[id]", "GET", "OBJECTIVES_READ"],
  ["autonomous/objectives/[id]/simulate", "POST", "STRATEGY_MANAGE"],
  ["autonomous/overview", "GET", "AUTONOMOUS_READ"],
  ["autonomous/pause", "POST", "AUTONOMOUS_MANAGE"],
  ["autonomous/resume", "POST", "AUTONOMOUS_MANAGE"],
  ["autonomous/strategies", "GET", "STRATEGY_READ"],
  ["enterprise/ai-governance", "GET", "GOVERNANCE_READ"],
  ["enterprise/ai-governance", "POST", "GOVERNANCE_MANAGE"],
  ["enterprise/analytics", "GET", "ENTERPRISE_READ"],
  ["enterprise/benchmarks", "GET", "BENCHMARKS_READ"],
  ["enterprise/brands", "GET", "BRAND_READ"],
  ["enterprise/brands", "POST", "BRAND_MANAGE"],
  ["enterprise/business-units", "GET", "BUSINESS_UNIT_READ"],
  ["enterprise/business-units", "POST", "BUSINESS_UNIT_MANAGE"],
  ["enterprise/data-lineage", "GET", "DATA_LINEAGE_READ"],
  ["enterprise/data-quality", "GET", "DATA_QUALITY_READ"],
  ["enterprise/developer", "GET", "DEVELOPER_READ"],
  ["enterprise/developer", "POST", "DEVELOPER_MANAGE"],
  ["enterprise/governance", "GET", "GOVERNANCE_READ"],
  ["enterprise/incidents", "GET", "INCIDENTS_READ"],
  ["enterprise/incidents", "POST", "INCIDENTS_MANAGE"],
  ["enterprise/integrations", "GET", "INTEGRATIONS_READ"],
  ["enterprise/integrations", "POST", "INTEGRATIONS_MANAGE"],
  ["enterprise/integrations/[id]/sync", "POST", "INTEGRATIONS_SYNC"],
  ["enterprise/integrations/[id]/test", "POST", "INTEGRATIONS_MANAGE"],
  ["enterprise/metrics", "GET", "METRICS_READ"],
  ["enterprise/metrics", "POST", "METRICS_MANAGE"],
  ["enterprise/organizations", "GET", "ORGANIZATION_READ"],
  ["enterprise/organizations", "POST", "ORGANIZATION_MANAGE"],
  ["enterprise/overview", "GET", "ENTERPRISE_READ"],
  ["enterprise/reports", "GET", "EXPORTS_READ"],
  ["enterprise/reports", "POST", "EXPORTS_CREATE"],
  ["enterprise/stores", "GET", "STORE_READ"],
  ["enterprise/stores", "POST", "STORE_MANAGE"],
  ["enterprise/webhooks", "GET", "DEVELOPER_READ"],
  ["enterprise/webhooks", "POST", "DEVELOPER_MANAGE"],
  ["growth/attribution", "GET", "MARKETING_READ"],
  ["growth/audiences", "GET", "MARKETING_READ"],
  ["growth/audiences", "POST", "MARKETING_WRITE"],
  ["growth/audiences/[id]", "GET", "MARKETING_READ"],
  ["growth/audiences/[id]", "PUT", "MARKETING_WRITE"],
  ["growth/audiences/[id]/refresh", "POST", "MARKETING_WRITE"],
  ["growth/campaigns", "GET", "MARKETING_READ"],
  ["growth/campaigns", "POST", "MARKETING_WRITE"],
  ["growth/campaigns/[id]", "GET", "MARKETING_READ"],
  ["growth/campaigns/[id]", "PUT", "MARKETING_WRITE"],
  ["growth/campaigns/[id]/approve", "POST", "MARKETING_APPROVE"],
  ["growth/campaigns/[id]/execute", "POST", "MARKETING_WRITE"],
  ["growth/campaigns/[id]/pause", "POST", "MARKETING_WRITE"],
  ["growth/campaigns/[id]/reject", "POST", "MARKETING_APPROVE"],
  ["growth/campaigns/[id]/resume", "POST", "MARKETING_WRITE"],
  ["growth/campaigns/[id]/schedule", "POST", "MARKETING_WRITE"],
  ["growth/campaigns/[id]/simulate", "POST", "MARKETING_READ"],
  ["growth/content/generate", "POST", "MARKETING_WRITE"],
  ["growth/content/verify", "POST", "MARKETING_WRITE"],
  ["growth/experiments", "GET", "MARKETING_READ"],
  ["growth/experiments", "POST", "MARKETING_WRITE"],
  ["growth/experiments/[id]/evaluate", "POST", "MARKETING_WRITE"],
  ["growth/insights", "GET", "MARKETING_READ"],
  ["growth/journeys", "GET", "MARKETING_READ"],
  ["growth/journeys", "POST", "MARKETING_WRITE"],
  ["growth/journeys/[id]", "GET", "MARKETING_READ"],
  ["growth/journeys/[id]", "PUT", "MARKETING_WRITE"],
  ["growth/journeys/[id]/pause", "POST", "MARKETING_WRITE"],
  ["growth/journeys/[id]/resume", "POST", "MARKETING_WRITE"],
  ["growth/lifecycle", "GET", "MARKETING_READ"],
  ["growth/lifecycle/[customerId]", "GET", "MARKETING_READ"],
  ["growth/offers", "GET", "MARKETING_READ"],
  ["growth/offers", "POST", "MARKETING_WRITE"],
  ["growth/overview", "GET", "MARKETING_READ"],
  ["growth/preferences/[customerId]", "GET", "MARKETING_READ"],
  ["growth/preferences/[customerId]", "POST", "MARKETING_WRITE"],
  ["growth/recommendations", "GET", "MARKETING_READ"],
  ["intelligence/anomalies", "GET", "ANALYTICS_READ"],
  ["intelligence/cohorts", "GET", "ANALYTICS_READ"],
  ["intelligence/customers", "GET", "ANALYTICS_READ"],
  ["intelligence/data-quality", "GET", "ANALYTICS_READ"],
  ["intelligence/forecasts", "POST", "ANALYTICS_READ"],
  ["intelligence/metrics", "GET", "ANALYTICS_READ"],
  ["intelligence/models", "GET", "ANALYTICS_READ"],
  ["intelligence/nl-query", "POST", "ANALYTICS_READ"],
  ["intelligence/opportunities", "GET", "ANALYTICS_READ"],
  ["intelligence/overview", "GET", "ANALYTICS_READ"],
  ["intelligence/query", "POST", "ANALYTICS_READ"],
  ["intelligence/recommendations", "GET", "ANALYTICS_READ"],
  ["intelligence/recommendations/[id]/propose-decision", "POST", "OPERATIONS_EXECUTE"],
  ["intelligence/risks", "GET", "ANALYTICS_READ"],
  ["intelligence/simulations", "POST", "ANALYTICS_READ"],
  ["marketing/abandoned-carts", "GET", "MARKETING_READ"],
  ["marketing/abandoned-carts", "POST", "MARKETING_WRITE"],
  ["marketing/abandoned-carts/[id]/nudge", "POST", "MARKETING_WRITE"],
  ["marketing/abandoned-carts/[id]/recover", "POST", "MARKETING_WRITE"],
  ["marketing/attribution", "GET", "MARKETING_READ"],
  ["marketing/audiences", "GET", "MARKETING_READ"],
  ["marketing/audiences", "POST", "MARKETING_WRITE"],
  ["marketing/audiences/[id]/members", "GET", "MARKETING_READ"],
  ["marketing/broadcasts", "GET", "MARKETING_READ"],
  ["marketing/broadcasts", "POST", "MARKETING_WRITE"],
  ["marketing/broadcasts/[id]/approve", "POST", "MARKETING_APPROVE"],
  ["marketing/broadcasts/[id]/dispatch", "POST", "MARKETING_WRITE"],
  ["marketing/broadcasts/[id]/reject", "POST", "MARKETING_APPROVE"],
  ["marketing/broadcasts/[id]/simulate", "POST", "MARKETING_READ"],
  ["marketing/broadcasts/kill-switch", "POST", "MARKETING_APPROVE"],
  ["marketing/overview", "GET", "MARKETING_READ"],
  ["operations/actions", "GET", "OPERATIONS_READ"],
  ["operations/actions/[id]/approve", "POST", "OPERATIONS_APPROVE"],
  ["operations/actions/[id]/simulate", "POST", "OPERATIONS_READ"],
  ["operations/autonomy", "GET", "OPERATIONS_READ"],
  ["operations/autonomy", "PUT", "OPERATIONS_APPROVE"],
  ["operations/autonomy/kill-switch", "POST", "OPERATIONS_APPROVE"],
  ["operations/digital-twin", "GET", "OPERATIONS_READ"],
  ["operations/exceptions", "GET", "EXCEPTIONS_READ"],
  ["operations/exceptions", "POST", "EXCEPTIONS_MANAGE"],
  ["operations/exceptions/[id]/resolve", "POST", "EXCEPTIONS_MANAGE"],
  ["operations/finance", "GET", "FINANCE_READ"],
  ["operations/finance", "POST", "OPERATIONS_EXECUTE"],
  ["operations/fulfillment", "GET", "OPERATIONS_READ"],
  ["operations/fulfillment", "POST", "OPERATIONS_EXECUTE"],
  ["operations/inventory", "GET", "OPERATIONS_READ"],
  ["operations/overview", "GET", "OPERATIONS_READ"],
  ["operations/payments", "GET", "FINANCE_READ"],
  ["operations/payments", "POST", "PAYMENTS_VERIFY"],
  ["operations/pricing", "GET", "PRICING_READ"],
  ["operations/pricing", "POST", "PRICING_MANAGE"],
  ["operations/procurement", "GET", "PROCUREMENT_READ"],
  ["operations/procurement", "POST", "PROCUREMENT_MANAGE"],
  ["operations/providers", "GET", "OPERATIONS_READ"],
  ["operations/receipts", "GET", "OPERATIONS_READ"],
  ["operations/sla", "GET", "OPERATIONS_READ"],
  ["operations/tasks", "GET", "OPERATIONS_READ"],
  ["operations/tasks", "POST", "OPERATIONS_EXECUTE"],
];

const BASE = "http://localhost:3000/api/v1";
const TENANT_ID = "ten_default_dhaka";

async function member(role: RoleName): Promise<{ id: string; token: string }> {
  const id = `usr_rbac_${role.toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`;
  const email = `${id}@rbac.test`;
  const now = new Date().toISOString();
  db.createUser({ id, email, name: `RBAC ${role}`, password_hash: "!disabled", status: "ACTIVE", created_at: now, updated_at: now });
  db.createMembership({ id: `mem_${id}`, tenant_id: TENANT_ID, user_id: id, role, created_at: now, updated_at: now });
  const token = await signSessionToken({ userId: id, tenantId: TENANT_ID, role, email, name: `RBAC ${role}` });
  return { id, token };
}

type Handler = (request: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

async function callRoute(route: string, method: Method, token: string, body: unknown = {}): Promise<number> {
  const mod = (await import(`@/app/api/v1/${route}/route`)) as Partial<Record<Method, Handler>>;
  const handler = mod[method];
  if (!handler) throw new Error(`${method} ${route} is not exported`);
  const concrete = route.replace("[id]", "rbac_missing_id").replace("[customerId]", "rbac_missing_customer");
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
  if (method !== "GET") init.body = JSON.stringify(body);
  const res = await handler(new Request(`${BASE}/${concrete}`, init), {
    params: { id: "rbac_missing_id", customerId: "rbac_missing_customer" },
  });
  return res.status;
}

async function callById(route: string, id: string, method: Method, token: string, body: unknown = {}): Promise<number> {
  const mod = (await import(`@/app/api/v1/${route}/route`)) as Partial<Record<Method, Handler>>;
  const handler = mod[method];
  if (!handler) throw new Error(`${method} ${route} is not exported`);
  const res = await handler(
    new Request(`${BASE}/${route.replace("[id]", id)}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id } }
  );
  return res.status;
}

async function main() {
  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}   COMMERCEOS PHASE 1: RBAC MATRIX (FX-10 / FX-61)   ${ANSI_RESET}`);
  console.log(`${ANSI_BOLD}====================================================\n${ANSI_RESET}`);
  db.clearAllForTesting();

  const support = await member("SUPPORT");
  const admin = await member("ADMIN");

  await runTest(`the matrix covers all 140 guarded handlers`, () => {
    assert.strictEqual(MATRIX.length, 140);
  });

  await runTest("ADMIN holds every permission the matrix requires; SUPPORT holds none of them", () => {
    const needed = Array.from(new Set(MATRIX.map(([, , perm]) => PERMISSIONS[perm])));
    const adminMissing = needed.filter((p) => !ROLE_PERMISSIONS.ADMIN.includes(p));
    assert.deepStrictEqual(adminMissing, [], "ADMIN is missing permissions");
    const supportHas = needed.filter((p) => ROLE_PERMISSIONS.SUPPORT.includes(p));
    assert.deepStrictEqual(supportHas, [], "SUPPORT unexpectedly holds matrix permissions");
  });

  console.log(`\n${ANSI_BOLD}[SUPPORT → 403 on every handler]${ANSI_RESET}`);
  for (const [route, method, perm] of MATRIX) {
    await runTest(`SUPPORT ${method} /${route} → 403 (${perm})`, async () => {
      assert.strictEqual(await callRoute(route, method, support.token), 403);
    });
  }

  console.log(`\n${ANSI_BOLD}[ADMIN is never refused]${ANSI_RESET}`);
  for (const [route, method] of MATRIX) {
    await runTest(`ADMIN ${method} /${route} → not 401/403`, async () => {
      const status = await callRoute(route, method, admin.token);
      assert.ok(status !== 401 && status !== 403, `got ${status}`);
    });
  }

  console.log(`\n${ANSI_BOLD}[Approvals and forged health]${ANSI_RESET}`);

  await runTest("operations/providers no longer accepts client-reported health (no POST export)", async () => {
    const mod = (await import("@/app/api/v1/operations/providers/route")) as Record<string, unknown>;
    assert.strictEqual(mod.POST, undefined);
  });

  const now = new Date().toISOString();
  const campaign = (createdBy: string, riskClass: GrowthCampaign["risk_class"]): string => {
    const id = `camp_rbac_${crypto.randomUUID().slice(0, 8)}`;
    db.insertCampaign({
      id,
      tenant_id: TENANT_ID,
      name: `RBAC ${id}`,
      objective: "ENGAGEMENT",
      status: "PENDING_APPROVAL",
      audience_id: "aud_none",
      channel: "WHATSAPP",
      variants: [],
      action_risk_level: "HIGH",
      required_approval: true,
      risk_class: riskClass,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    } as unknown as GrowthCampaign);
    return id;
  };
  const approveRoute = "growth/campaigns/[id]/approve";

  await runTest("a high-risk campaign cannot be approved by its own creator (four-eyes)", async () => {
    const id = campaign(admin.id, "HIGH");
    assert.strictEqual(await callById(approveRoute, id, "POST", admin.token), 403);
    assert.notStrictEqual(db.getCampaignById(TENANT_ID, id)?.status, "APPROVED");
  });

  await runTest("a body-supplied approved_by is ignored: the approver is the signed-in user", async () => {
    const id = campaign(admin.id, "CRITICAL");
    assert.strictEqual(await callById(approveRoute, id, "POST", admin.token, { approved_by: "usr_someone_else" }), 403);
  });

  await runTest("another ADMIN can approve a high-risk campaign", async () => {
    const creator = await member("MARKETING");
    const id = campaign(creator.id, "HIGH");
    assert.strictEqual(await callById(approveRoute, id, "POST", admin.token), 200);
    assert.strictEqual(db.getCampaignById(TENANT_ID, id)?.status, "APPROVED");
  });

  await runTest("MARKETING can create campaigns but cannot approve them", async () => {
    const creator = await member("MARKETING");
    const id = campaign(admin.id, "LOW");
    assert.strictEqual(await callById(approveRoute, id, "POST", creator.token), 403);
  });

  console.log(`\n${ANSI_BOLD}====================================================${ANSI_RESET}`);
  console.log(`  Tests Passed: ${passedCount} | Tests Failed: ${failedCount}`);
  console.log(`${ANSI_BOLD}====================================================${ANSI_RESET}\n`);
  if (failedCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("RBAC matrix suite crashed:", err);
  process.exit(1);
});
