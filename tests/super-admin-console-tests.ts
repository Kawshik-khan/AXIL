/**
 * Super-admin console suite (docs/super-admin-console-implementation-plan.md §9).
 * Static checks on the console code (no fabricated values, tokens only, permission map) and behaviour of the new
 * platform services: privileged-action gate, two-person approvals, plan versions, entitlements, add-ons, trials,
 * migration, purge scheduling, attention inbox, impact preview, notices, settings and flag registries.
 * Run: node tests/ts-runner.cjs ./tests/super-admin-console-tests.ts
 */
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db } from "@/infrastructure/db";
import type { PlatformContext, PlatformRole } from "@/lib/context";
import { PLATFORM_PERMISSIONS, PLATFORM_ROLE_PERMISSIONS } from "@/lib/permissions";
import { PlatformTenantService } from "@/domains/platform/services/platform-tenant.service";
import { PlatformPlanService } from "@/domains/platform/services/platform-plan.service";
import { PlatformSubscriptionService } from "@/domains/platform/services/platform-subscription.service";
import { PlatformEntitlementService } from "@/domains/platform/services/platform-entitlement.service";
import { PlatformAddonService } from "@/domains/platform/services/platform-addon.service";
import { PlatformApprovalService } from "@/domains/platform/services/platform-approval.service";
import { PlatformSettingsService } from "@/domains/platform/services/platform-settings.service";
import { PlatformAttentionService } from "@/domains/platform/services/platform-attention.service";
import { PlatformImpactService } from "@/domains/platform/services/platform-impact.service";
import { PlatformCommunicationsService } from "@/domains/platform/services/platform-communications.service";
import { PlatformFeatureFlagService } from "@/domains/platform/services/platform-feature-flag.service";
import { PlatformIncidentService } from "@/domains/platform/services/platform-incident.service";
import { PRIVILEGED_ACTIONS } from "@/domains/platform/privileged-actions";
import { ENTITLEMENT_CATALOG } from "@/domains/platform/entitlement-catalog";
import { SETTINGS_REGISTRY } from "@/domains/platform/settings-registry";
import { mrrContribution } from "@/domains/platform/plan-pricing";
import { CONSOLE_MODULES, SETTINGS_PATH, visibleModules } from "@/app/super-admin/_lib/console-modules";
import { requiredPlatformPermission } from "@/app/super-admin/_lib/platform-module-access";
import type { PlanVersionRecord } from "@/types/platform";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ${GREEN}✓ PASS${RESET} - ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ${RED}✗ FAIL${RESET} - ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

const ROOT = path.resolve(__dirname, "..");
const uid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
const nowIso = () => new Date().toISOString();
const DAY = 24 * 60 * 60 * 1000;

function ctx(role: PlatformRole, options: { id?: string; stepUp?: boolean } = {}): PlatformContext {
  const id = options.id ?? uid("usr_console");
  return {
    requestId: uid("req"),
    traceId: uid("trc"),
    scope: "PLATFORM",
    platformUser: { id, email: `${id}@ops.test`, name: id, status: "ACTIVE" },
    platformRole: role,
    permissions: PLATFORM_ROLE_PERMISSIONS[role],
    mfaVerified: true,
    stepUpVerified: options.stepUp ?? true,
    timestamp: nowIso(),
  };
}

/** The error code a call throws, or null. */
async function codeOf(fn: () => unknown): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? (err as Error).message;
  }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function ensureOperator(c: PlatformContext): PlatformContext {
  const id = c.platformUser.id;
  if (!db.findUserById(id)) {
    db.createUser({ id, email: c.platformUser.email, name: id, password_hash: "!disabled", status: "ACTIVE", created_at: nowIso(), updated_at: nowIso() });
  }
  if (!db.findPlatformMembershipByUserId(id)) {
    db.savePlatformMembership({ id: `pm_${id}`, user_id: id, role: c.platformRole, mfa_enabled: true, is_active: true, created_at: nowIso(), updated_at: nowIso() });
  }
  return c;
}

function addMembers(tenantId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = uid("usr_member");
    db.createUser({ id, email: `${id}@member.test`, name: id, password_hash: "!disabled", status: "ACTIVE", created_at: nowIso(), updated_at: nowIso() });
    db.createMembership({ id: `mem_${id}`, tenant_id: tenantId, user_id: id, role: "SALES", created_at: nowIso(), updated_at: nowIso() });
  }
}

async function main() {
  console.log(`\n${BOLD}Super-admin console${RESET}`);
  await db.ready?.();

  const opA = ensureOperator(ctx("SUPER_ADMIN"));
  const opB = ensureOperator(ctx("SUPER_ADMIN"));
  const analyst = ctx("PLATFORM_ANALYST");
  const noStepUp = ctx("SUPER_ADMIN", { stepUp: false });

  // ---------------------------------------------------------------- static checks
  const consoleFiles = [
    ...walk(path.join(ROOT, "src/app/super-admin")),
    ...walk(path.join(ROOT, "src/components/motion")),
    path.join(ROOT, "src/components/navigation/Dock.tsx"),
    path.join(ROOT, "src/components/navigation/ProgressiveBlur.tsx"),
    path.join(ROOT, "src/components/navigation/PlatformNotices.tsx"),
    path.join(ROOT, "src/components/navigation/PlatformNotices.module.css"),
  ].filter((f) => /\.(tsx?|css)$/.test(f));

  await runTest("console code has no hex colours (tokens only)", () => {
    const offenders = consoleFiles.filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(fs.readFileSync(f, "utf8").replace(/&#\d+;/g, "")));
    assert.deepStrictEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });

  await runTest("console code has no fallback identities or metric fallbacks", () => {
    const patterns: Array<[RegExp, string]> = [
      [/(\|\||\?\?)\s*["'`]SUPER_ADMIN/, "role fallback"],
      [/admin@commerceos/, "fallback operator email"],
      [/\?\?\s*0\s*\}/, "?? 0 in JSX"],
      [/["'`]100%["'`]/, "literal 100%"],
      [/["'`]৳0["'`]/, "literal ৳0"],
      [/["'`]Unknown["'`]/, "Unknown placeholder"],
      [/All microservices operational|Zero uncontained/, "hard-coded health claim"],
    ];
    const hits: string[] = [];
    for (const f of consoleFiles.filter((x) => x.endsWith(".tsx") || x.endsWith(".ts"))) {
      const src = fs.readFileSync(f, "utf8");
      for (const [re, what] of patterns) if (re.test(src)) hits.push(`${path.relative(ROOT, f)}: ${what}`);
    }
    assert.deepStrictEqual(hits, []);
  });

  await runTest("every console page renders through ResourceView (six UX states)", () => {
    const pages = walk(path.join(ROOT, "src/app/super-admin/(console)")).filter((f) => f.endsWith("page.tsx"));
    assert.ok(pages.length >= 10, `expected the 10 console pages, found ${pages.length}`);
    const missing = pages.filter((f) => !fs.readFileSync(f, "utf8").includes("ResourceView"));
    assert.deepStrictEqual(missing.map((f) => path.relative(ROOT, f)), []);
  });

  await runTest("Hairline figures are only given a kind, surface, size or class (never data)", () => {
    const bad: string[] = [];
    for (const f of consoleFiles.filter((x) => x.endsWith(".tsx"))) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/<HairlineFigure([^>]*)\/>/g)) {
        const props = [...m[1].matchAll(/(\w+)=/g)].map((p) => p[1]);
        if (props.some((p) => !["kind", "surface", "size", "className"].includes(p))) bad.push(`${path.relative(ROOT, f)}: ${props.join(",")}`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  await runTest("the old super-admin page with fabricated KPIs is gone", () => {
    assert.ok(!fs.existsSync(path.join(ROOT, "src/app/super-admin/page.tsx")), "src/app/super-admin/page.tsx must not exist (the console lives in (console)/)");
    assert.ok(!fs.existsSync(path.join(ROOT, "src/app/api/v1/platform/compliance/purge/route.ts")), "the purge route that reported a fake purge must be gone");
  });

  // ---------------------------------------------------------------- permission map and registries
  await runTest("every dock module (and settings) maps to an existing platform permission", () => {
    const all = new Set<string>(Object.values(PLATFORM_PERMISSIONS));
    for (const href of [...CONSOLE_MODULES.map((m) => m.href), SETTINGS_PATH]) {
      const perm = requiredPlatformPermission(href);
      assert.ok(perm, `${href} has no permission`);
      assert.ok(all.has(perm!), `${href} → ${perm} is not a platform permission`);
    }
  });

  await runTest("an analyst's dock hides modules their role can't open", () => {
    const labels = visibleModules(PLATFORM_ROLE_PERMISSIONS.PLATFORM_ANALYST).map((m) => m.label);
    assert.ok(labels.includes("Control Tower") && labels.includes("Insights"));
    assert.ok(!labels.includes("Safety & Releases") && !labels.includes("Security") && !labels.includes("Audit"), labels.join(", "));
  });

  await runTest("privileged-action registry: permissions exist; HIGH/CRITICAL need step-up; CRITICAL needs approval, reason and ticket", () => {
    const all = new Set<string>(Object.values(PLATFORM_PERMISSIONS));
    for (const a of PRIVILEGED_ACTIONS) {
      assert.ok(all.has(a.permission), `${a.key}: unknown permission ${a.permission}`);
      if (a.risk === "HIGH" || a.risk === "CRITICAL") assert.ok(a.stepUp, `${a.key} must require step-up`);
      if (a.risk === "CRITICAL") {
        assert.notStrictEqual(a.approval, "never", `${a.key} must require approval`);
        assert.ok(a.reasonMin >= 10 && a.ticketRequired, `${a.key} must require a reason and a ticket`);
      }
    }
  });

  await runTest("entitlement catalog: enforced entries name their gate; settings registry entries have defaults that pass their schema", () => {
    const enforced = ENTITLEMENT_CATALOG.filter((e) => e.enforcedBy).map((e) => e.id).sort();
    assert.deepStrictEqual(enforced, ["ai_monthly_runs", "max_channels", "max_products", "max_users"]);
    for (const s of SETTINGS_REGISTRY) assert.ok(s.schema.safeParse(s.default).success, `${s.key} default fails its schema`);
  });

  // ---------------------------------------------------------------- settings
  await runTest("settings: unknown, unread and out-of-range values are refused; a valid change applies and needs step-up", async () => {
    assert.strictEqual(await codeOf(() => PlatformSettingsService.updateSetting("nope.key", 1, "testing the registry gate", opA)), "SETTING_REJECTED");
    assert.strictEqual(await codeOf(() => PlatformSettingsService.updateSetting("security.mfa_enforced", false, "testing an unread setting", opA)), "SETTING_REJECTED");
    assert.strictEqual(await codeOf(() => PlatformSettingsService.updateSetting("billing.past_due_grace_days", 999, "testing the upper bound", opA)), "SETTING_REJECTED");
    assert.strictEqual(await codeOf(() => PlatformSettingsService.updateSetting("attention.entitlement_threshold_pct", 85, "testing without step-up", noStepUp)), "STEP_UP_REQUIRED");
    const before = PlatformSettingsService.getEffectiveSetting<number>("attention.entitlement_threshold_pct");
    PlatformSettingsService.updateSetting("attention.entitlement_threshold_pct", 85, "console suite: change the warning threshold", opA);
    assert.strictEqual(PlatformSettingsService.getEffectiveSetting<number>("attention.entitlement_threshold_pct"), 85);
    PlatformSettingsService.updateSetting("attention.entitlement_threshold_pct", before, "console suite: restore the warning threshold", opA);
    // Settings that govern approvals or billing (HIGH) need a second operator (security review M5)
    assert.strictEqual(
      await codeOf(() => PlatformSettingsService.updateSetting("plans.migration_approval_threshold", 100000, "raise the threshold alone", opA, { ticketRef: "SEC-1" })),
      "APPROVAL_REQUIRED"
    );
  });

  await runTest("feature flags: a key no code reads can't be saved", async () => {
    assert.strictEqual(
      await codeOf(() => PlatformFeatureFlagService.saveFlag({ key: "made.up.flag", description: "x", is_enabled_globally: true }, "testing the flag registry", opA)),
      "UNKNOWN_FLAG"
    );
  });

  // ---------------------------------------------------------------- plans
  const planId = `CONSOLE_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  let v1: string;
  let v2: string;

  await runTest("plans: a new plan has only a draft and can't be subscribed to", async () => {
    const plan = PlatformPlanService.createPlan(opA, { id: planId, name: "Console Test", description: "", visibility: "HIDDEN", reason: "console suite creates a plan" });
    assert.strictEqual(plan.current_version, null);
    assert.strictEqual(plan.draft_version?.effective_status, "DRAFT");
    assert.strictEqual(
      await codeOf(() => PlatformTenantService.provisionTenant({ name: "No Plan", slug: uid("noplan").replace(/_/g, "-"), plan_id: planId, owner_email: `${uid("o")}@x.test`, owner_name: "O" }, opA)),
      "PLAN_NOT_PUBLISHED"
    );
  });

  await runTest("plans: drafts refuse unknown keys, unenforced limits and out-of-range values; publishing needs a price", async () => {
    const base = { monthly_price_bdt: null, annual_price_bdt: null, trial_days: null, setup_fee_bdt: null };
    assert.strictEqual(await codeOf(() => PlatformPlanService.saveDraft(opA, planId, { ...base, features: { max_orders: 100 } })), "PLAN_DRAFT_INVALID");
    assert.strictEqual(await codeOf(() => PlatformPlanService.saveDraft(opA, planId, { ...base, features: { max_storage_gb: 5 } })), "PLAN_DRAFT_INVALID");
    assert.strictEqual(await codeOf(() => PlatformPlanService.saveDraft(opA, planId, { ...base, features: { max_users: -1 } })), "PLAN_DRAFT_INVALID");
    const draft = PlatformPlanService.saveDraft(opA, planId, { ...base, features: { max_users: 3 } });
    assert.strictEqual(await codeOf(() => PlatformPlanService.publishVersion(opA, draft.id, "publishing without a price")), "PRICE_REQUIRED");
  });

  await runTest("plans: publishing makes the version immutable; the next edit starts v2", () => {
    const draft = PlatformPlanService.saveDraft(opA, planId, {
      monthly_price_bdt: 1000,
      annual_price_bdt: 10000,
      trial_days: 7,
      setup_fee_bdt: null,
      features: { max_users: 3, ai_monthly_runs: 100 },
    });
    v1 = PlatformPlanService.publishVersion(opA, draft.id, "console suite publishes v1").id;
    const next = PlatformPlanService.saveDraft(opA, planId, { monthly_price_bdt: 1500, annual_price_bdt: null, trial_days: 7, setup_fee_bdt: null, features: { max_users: 5 } });
    assert.notStrictEqual(next.id, v1);
    assert.strictEqual(next.version, 2);
    assert.strictEqual(db.findPlanVersionById(v1)?.features.max_users, 3, "v1 unchanged");
    v2 = PlatformPlanService.publishVersion(opA, next.id, "console suite publishes v2").id;
  });

  await runTest("MRR counts an annual subscription at a twelfth of its annual price (SA-11)", () => {
    const version = db.findPlanVersionById(v1) as PlanVersionRecord;
    assert.strictEqual(mrrContribution({ billing_period: "ANNUAL" }, version), 10000 / 12);
    assert.strictEqual(mrrContribution({ billing_period: "MONTHLY" }, version), 1000);
  });

  // ---------------------------------------------------------------- tenants on the plan
  const slug = uid("console").replace(/_/g, "-");
  let tenantId = "";

  await runTest("provisioning and plan changes use the latest published version (SA-10); a trial gets its plan's limits (SA-12)", () => {
    const res = PlatformTenantService.provisionTenant({ name: "Console Tenant", slug, plan_id: planId, owner_email: `${uid("own")}@x.test`, owner_name: "Owner", start_trial: true }, opA);
    tenantId = res.tenant.id;
    const sub = db.findSubscriptionByTenantId(tenantId)!;
    assert.strictEqual(sub.plan_version_id, v2);
    assert.strictEqual(sub.status, "TRIAL");
    assert.ok(sub.trial_ends_at && Math.abs(Date.parse(sub.trial_ends_at) - (Date.now() + 7 * DAY)) < 60_000, "trial length from the version");
    assert.deepStrictEqual(PlatformEntitlementService.resolve(tenantId, "max_users"), { value: 5, source: "PLAN", addon_increment: 0 });
    const changed = PlatformSubscriptionService.changeTenantPlan(tenantId, planId, "console suite re-applies the plan", opA, { endTrial: true });
    assert.strictEqual(changed.plan_version_id, v2);
    assert.strictEqual(changed.status, "ACTIVE");
  });

  await runTest("past due: the plan applies during the grace period, then global defaults", () => {
    const sub = db.findSubscriptionByTenantId(tenantId)!;
    const grace = PlatformSettingsService.getEffectiveSetting<number>("billing.past_due_grace_days");
    db.saveSubscription({ ...sub, status: "PAST_DUE", current_period_end: new Date(Date.now() - (grace - 1) * DAY).toISOString() });
    assert.strictEqual(PlatformEntitlementService.resolve(tenantId, "max_users").source, "PLAN");
    db.saveSubscription({ ...sub, status: "PAST_DUE", current_period_end: new Date(Date.now() - (grace + 1) * DAY).toISOString() });
    assert.notStrictEqual(PlatformEntitlementService.resolve(tenantId, "max_users").source, "PLAN");
    db.saveSubscription({ ...sub, status: "ACTIVE" });
  });

  await runTest("overrides: refused for unenforced limits, need step-up and a reason; an expired one stops applying without a write", async () => {
    assert.strictEqual(await codeOf(() => PlatformEntitlementService.setTenantOverride(tenantId, "max_storage_gb", 9, "unenforced limit override", opA)), "ENTITLEMENT_REJECTED");
    assert.strictEqual(await codeOf(() => PlatformEntitlementService.setTenantOverride(tenantId, "max_users", 9, "needs step-up first", noStepUp, { ticketRef: "D-1" })), "STEP_UP_REQUIRED");
    assert.strictEqual(await codeOf(() => PlatformEntitlementService.setTenantOverride(tenantId, "max_users", 9, "short", opA, { ticketRef: "D-1" })), "REASON_REQUIRED");
    assert.strictEqual(await codeOf(() => PlatformEntitlementService.setTenantOverride(tenantId, "max_users", 9, "console suite: temporary deal", opA)), "TICKET_REQUIRED");
    PlatformEntitlementService.setTenantOverride(tenantId, "max_users", 9, "console suite: temporary deal", opA, { expiresAt: new Date(Date.now() + DAY).toISOString(), ticketRef: "D-1" });
    assert.strictEqual(PlatformEntitlementService.resolveLimit(tenantId, "max_users"), 9);
    const rec = db.findTenantEntitlement(tenantId, "max_users")!;
    db.saveTenantEntitlement({ ...rec, expires_at: new Date(Date.now() - 1000).toISOString() });
    assert.strictEqual(PlatformEntitlementService.resolveLimit(tenantId, "max_users"), 5, "expired override ignored");
    PlatformEntitlementService.clearTenantOverride(tenantId, "max_users", "console suite: clean up the override", opA);
  });

  await runTest("add-ons raise the plan limit while active; revoking lowers it again", () => {
    const addon = PlatformAddonService.create(opA, { name: "+2 staff", description: "", entitlement_id: "max_users", increment: 2, allowed_plan_ids: [], reason: "console suite add-on" });
    const grant = PlatformAddonService.grant(opA, tenantId, { addon_id: addon.id, quantity: 2, reason: "console suite complimentary grant" });
    assert.deepStrictEqual(PlatformEntitlementService.resolve(tenantId, "max_users"), { value: 9, source: "PLAN", addon_increment: 4 });
    PlatformAddonService.revoke(opA, tenantId, grant.id, "console suite revokes the grant");
    assert.strictEqual(PlatformEntitlementService.resolveLimit(tenantId, "max_users"), 5);
  });

  await runTest("migration impact counts tenants already above a lowered limit; migrating moves them", async () => {
    addMembers(tenantId, 4); // owner + 4 = 5 members; v1 allows 3
    const impact = await PlatformPlanService.migrationImpact(opA, v2, v1, [tenantId]);
    assert.strictEqual(impact.affected_tenants, 1);
    const users = impact.lowered_limits.find((l) => l.id === "max_users");
    assert.ok(users && users.tenants_above_new_limit === 1, JSON.stringify(impact.lowered_limits));
    assert.strictEqual(await codeOf(() => PlatformPlanService.migrate(opA, { from_version_id: v2, to_version_id: v1, target_tenant_ids: [tenantId], reason: "console suite migration" })), "TICKET_REQUIRED");
    const res = PlatformPlanService.migrate(opA, { from_version_id: v2, to_version_id: v1, target_tenant_ids: [tenantId], reason: "console suite migration", ticket_ref: "BILL-1" });
    assert.deepStrictEqual(res, { migrated: 1, tenant_ids: [tenantId] });
    assert.strictEqual(db.findSubscriptionByTenantId(tenantId)?.plan_version_id, v1);
  });

  // ---------------------------------------------------------------- attention and impact
  await runTest("attention inbox: an open SEV1 and a tenant above its limit appear; resolving the incident removes it", async () => {
    const incident = PlatformIncidentService.declareIncident({ title: "Console suite outage", severity: "SEV1", affected_components: ["api"] }, opA);
    const items = await PlatformAttentionService.list(opA);
    assert.ok(items.some((i) => i.id === `incident:${incident.id}` && i.severity === "CRITICAL"));
    assert.ok(items.some((i) => i.id === `limit:${tenantId}:max_users` && i.severity === "HIGH"), "tenant at/over its user limit");
    PlatformIncidentService.updateIncidentStatus(incident.id, "RESOLVED", "", opA);
    assert.ok(!(await PlatformAttentionService.list(opA)).some((i) => i.id === `incident:${incident.id}`));
  });

  await runTest("impact preview counts the tenant's staff for a suspension", () => {
    const preview = PlatformImpactService.preview(opA, "tenant.suspend", null, tenantId);
    assert.strictEqual(preview.lines.find((l) => l.label.startsWith("Staff"))?.value, 5);
  });

  // ---------------------------------------------------------------- gate and approvals
  const oldTenant = PlatformTenantService.provisionTenant({ name: "Old Tenant", slug: uid("old").replace(/_/g, "-"), plan_id: planId, owner_email: `${uid("own")}@x.test`, owner_name: "Owner" }, opA).tenant;
  db.findTenantById(oldTenant.id)!.created_at = new Date(Date.now() - 60 * DAY).toISOString(); // updateTenant protects created_at
  const otherOld = PlatformTenantService.provisionTenant({ name: "Other Old", slug: uid("old2").replace(/_/g, "-"), plan_id: planId, owner_email: `${uid("own")}@x.test`, owner_name: "Owner" }, opA).tenant;
  db.findTenantById(otherOld.id)!.created_at = new Date(Date.now() - 60 * DAY).toISOString();

  await runTest("gate: permission, step-up, reason and ticket are checked before anything else", async () => {
    const denied = await (async () => {
      try {
        PlatformTenantService.suspendTenant(oldTenant.id, "analyst should be refused", analyst, { ticketRef: "T-1" });
        return null;
      } catch (e) {
        return e as { code?: string; details?: Record<string, unknown> };
      }
    })();
    assert.strictEqual(denied?.code, "PLATFORM_PERMISSION_DENIED");
    assert.strictEqual(denied?.details?.permission, "tenant.suspend", "the 403 names the permission (not a sentence)");
    assert.strictEqual(await codeOf(() => PlatformTenantService.suspendTenant(oldTenant.id, "needs step-up first", noStepUp, { ticketRef: "T-1" })), "STEP_UP_REQUIRED");
    assert.strictEqual(await codeOf(() => PlatformTenantService.suspendTenant(oldTenant.id, "short", opA, { ticketRef: "T-1" })), "REASON_REQUIRED");
    assert.strictEqual(await codeOf(() => PlatformTenantService.suspendTenant(oldTenant.id, "missing the ticket ref", opA)), "TICKET_REQUIRED");
  });

  await runTest("two-person: suspending a tenant older than 30 days needs an approval bound to that tenant", async () => {
    const first = await (async () => {
      try {
        PlatformTenantService.suspendTenant(oldTenant.id, "unpaid for two months", opA, { ticketRef: "BILL-9" });
        return null;
      } catch (e) {
        return e as { code?: string; details?: Record<string, unknown> };
      }
    })();
    assert.strictEqual(first?.code, "APPROVAL_REQUIRED");
    assert.deepStrictEqual(first?.details?.payload, { tenant: oldTenant.id }, "the server returns the exact input to approve");

    const req = PlatformApprovalService.request(opA, { actionKey: "tenant.suspend", payload: { tenant: oldTenant.id }, reason: "unpaid for two months", ticketRef: "BILL-9" });
    assert.strictEqual(req.target_label, oldTenant.name, "the label comes from the store, not the client");
    assert.strictEqual(req.target_tenant_id, oldTenant.id);
    assert.strictEqual(await codeOf(() => PlatformApprovalService.decide(opA, req.id, "APPROVE", undefined)), "FORBIDDEN");
    assert.strictEqual(await codeOf(() => PlatformApprovalService.decide(analyst, req.id, "APPROVE", undefined)), "PLATFORM_PERMISSION_DENIED");
    assert.strictEqual(await codeOf(() => PlatformApprovalService.decide(ctx("SUPER_ADMIN", { id: opB.platformUser.id, stepUp: false }), req.id, "APPROVE", undefined)), "STEP_UP_REQUIRED");
    assert.strictEqual(await codeOf(() => PlatformApprovalService.decide(opB, req.id, "REJECT", "no")), "REASON_REQUIRED");
    PlatformApprovalService.decide(opB, req.id, "APPROVE", "billing confirmed the arrears");

    assert.strictEqual(
      await codeOf(() => PlatformTenantService.suspendTenant(otherOld.id, "unpaid for two months", opA, { ticketRef: "BILL-9", approvalId: req.id })),
      "APPROVAL_INVALID",
      "an approval for one tenant can't suspend another"
    );
    assert.strictEqual(
      await codeOf(() => PlatformTenantService.suspendTenant(oldTenant.id, "unpaid for two months", opB, { ticketRef: "BILL-9", approvalId: req.id })),
      "APPROVAL_INVALID",
      "only the requester runs it"
    );
    const suspended = PlatformTenantService.suspendTenant(oldTenant.id, "unpaid for two months", opA, { ticketRef: "BILL-9", approvalId: req.id });
    assert.strictEqual(suspended?.status, "SUSPENDED");
    PlatformTenantService.activateTenant(oldTenant.id, "console suite reactivates", opA);
    assert.strictEqual(
      await codeOf(() => PlatformTenantService.suspendTenant(oldTenant.id, "unpaid for two months", opA, { ticketRef: "BILL-9", approvalId: req.id })),
      "APPROVAL_INVALID",
      "single use"
    );
    const refused = db.getPlatformAuditLogs({ action: "approval.refused" }).logs.filter((l) => l.resource_id === req.id);
    assert.ok(refused.length >= 3 && refused.every((l) => l.result === "BLOCKED"), "refusals are audited");
  });

  await runTest("approvals expire on read (no write) and can't be decided once expired", async () => {
    const req = PlatformApprovalService.request(opA, { actionKey: "tenant.suspend", payload: { tenant: otherOld.id }, reason: "will expire in this test", ticketRef: "T-2" });
    db.savePlatformApprovalRequest({ ...req, expires_at: new Date(Date.now() - 1000).toISOString() });
    const view = PlatformApprovalService.get(opA, req.id);
    assert.strictEqual(view.effective_status, "EXPIRED");
    assert.strictEqual(db.findPlatformApprovalRequest(req.id)?.status, "PENDING", "stored status untouched");
    assert.strictEqual(await codeOf(() => PlatformApprovalService.decide(opB, req.id, "APPROVE", undefined)), "APPROVAL_NOT_PENDING");
  });

  await runTest("purge: two operators and the typed slug; archives and keeps data 14 days; says nothing was deleted", async () => {
    const t = PlatformTenantService.provisionTenant({ name: "Purge Me", slug: uid("purge").replace(/_/g, "-"), plan_id: planId, owner_email: `${uid("own")}@x.test`, owner_name: "Owner" }, opA).tenant;
    const input = { reason: "customer asked for erasure", ticketRef: "DPA-1" };
    assert.strictEqual(await codeOf(() => PlatformTenantService.schedulePurge(t.id, { ...input, confirmation: `CONFIRM_PURGE_${t.slug.toUpperCase()}` }, opA)), "APPROVAL_REQUIRED");
    const req = PlatformApprovalService.request(opA, { actionKey: "tenant.purge", payload: { tenant: t.id }, reason: input.reason, ticketRef: input.ticketRef });
    PlatformApprovalService.decide(opB, req.id, "APPROVE", "erasure request verified");
    assert.strictEqual(await codeOf(() => PlatformTenantService.schedulePurge(t.id, { ...input, approvalId: req.id, confirmation: "CONFIRM" }, opA)), "CONFIRMATION_REQUIRED");
    const res = PlatformTenantService.schedulePurge(t.id, { ...input, approvalId: req.id, confirmation: `CONFIRM_PURGE_${t.slug.toUpperCase()}` }, opA);
    assert.strictEqual(res.data_deleted, false);
    assert.ok(Math.abs(Date.parse(res.purge_after) - (Date.now() + 14 * DAY)) < 60_000);
    assert.strictEqual(db.findTenantById(t.id)?.status, "ARCHIVED");
    PlatformTenantService.cancelPurge(t.id, { reason: "erasure request withdrawn", ticketRef: "DPA-1" }, opA);
    assert.strictEqual(db.findTenantById(t.id)?.purge_after, undefined);
  });

  // ---------------------------------------------------------------- security review fixes
  await runTest("H1: archiving a tenant older than 30 days needs a second operator; an archived tenant can't be archived again", async () => {
    assert.strictEqual(await codeOf(() => PlatformTenantService.archiveTenant(otherOld.id, "closing the old workspace", opA, { ticketRef: "OPS-9" })), "APPROVAL_REQUIRED");
    const fresh = PlatformTenantService.provisionTenant({ name: "Fresh", slug: uid("fresh").replace(/_/g, "-"), plan_id: planId, owner_email: `${uid("own")}@x.test`, owner_name: "O" }, opA).tenant;
    PlatformTenantService.archiveTenant(fresh.id, "closing a new workspace", opA, { ticketRef: "OPS-10" });
    assert.strictEqual(await codeOf(() => PlatformTenantService.archiveTenant(fresh.id, "closing it twice", opA, { ticketRef: "OPS-10" })), "TENANT_STATE_INVALID");
  });

  await runTest("M2: an archived or purge-scheduled tenant can't be suspended (no suspend → activate un-archive)", async () => {
    const fresh = PlatformTenantService.provisionTenant({ name: "Archived", slug: uid("arch").replace(/_/g, "-"), plan_id: planId, owner_email: `${uid("own")}@x.test`, owner_name: "O" }, opA).tenant;
    PlatformTenantService.archiveTenant(fresh.id, "closing a new workspace", opA, { ticketRef: "OPS-11" });
    assert.strictEqual(await codeOf(() => PlatformTenantService.suspendTenant(fresh.id, "try to resurrect it", opA, { ticketRef: "OPS-11" })), "TENANT_STATE_INVALID");
  });

  await runTest("M3: an approval request for a missing target is refused; its label is derived server-side", async () => {
    assert.strictEqual(await codeOf(() => PlatformApprovalService.request(opA, { actionKey: "tenant.suspend", payload: { tenant: "ten_does_not_exist" }, reason: "nonexistent tenant", ticketRef: "T-3" })), "APPROVAL_PAYLOAD_INVALID");
  });

  await runTest("M4: the operator being promoted can't approve it; nobody grants permissions they don't hold", async () => {
    const security = ensureOperator(ctx("PLATFORM_SECURITY"));
    const target = ensureOperator(ctx("PLATFORM_SECURITY"));
    assert.strictEqual(
      await codeOf(() => PlatformApprovalService.request(security, { actionKey: "operator.assign_role", payload: { user_id: target.platformUser.id, role: "SUPER_ADMIN" }, reason: "promote my colleague", ticketRef: "SEC-2" })),
      "FORBIDDEN",
      "PLATFORM_SECURITY can't request SUPER_ADMIN"
    );
    const req = PlatformApprovalService.request(opA, { actionKey: "operator.assign_role", payload: { user_id: target.platformUser.id, role: "PLATFORM_ANALYST" }, reason: "move to analytics duty", ticketRef: "SEC-3" });
    assert.strictEqual(await codeOf(() => PlatformApprovalService.decide(target, req.id, "APPROVE", undefined)), "FORBIDDEN", "the subject of the change can't approve it");
  });

  await runTest("M5: migration batches count toward the approval threshold", async () => {
    const x = PlatformTenantService.provisionTenant({ name: "Batch X", slug: uid("bx").replace(/_/g, "-"), plan_id: planId, owner_email: `${uid("own")}@x.test`, owner_name: "O" }, opA).tenant;
    const y = PlatformTenantService.provisionTenant({ name: "Batch Y", slug: uid("by").replace(/_/g, "-"), plan_id: planId, owner_email: `${uid("own")}@x.test`, owner_name: "O" }, opA).tenant;
    const stored = db.findPlatformSetting("plans.migration_approval_threshold");
    db.savePlatformSetting({ key: "plans.migration_approval_threshold", value: 2, category: "BILLING", description: "test", is_sensitive: false, updated_at: nowIso() });
    try {
      const from = db.findSubscriptionByTenantId(x.id)!.plan_version_id;
      // One tenant already moved off this version earlier in the suite: 1 + 1 = 2 fits the threshold, the next batch does not
      PlatformPlanService.migrate(opA, { from_version_id: from, to_version_id: v1, target_tenant_ids: [x.id], reason: "first batch of one", ticket_ref: "B-1" });
      assert.strictEqual(
        await codeOf(() => PlatformPlanService.migrate(opA, { from_version_id: from, to_version_id: v1, target_tenant_ids: [y.id], reason: "second batch of one", ticket_ref: "B-1" })),
        "APPROVAL_REQUIRED"
      );
    } finally {
      if (stored) db.savePlatformSetting(stored);
      else db.savePlatformSetting({ key: "plans.migration_approval_threshold", value: 10, category: "BILLING", description: "test", is_sensitive: false, updated_at: nowIso() });
    }
  });

  await runTest("M4: operators can't demote someone whose permissions they don't hold", async () => {
    const security = ensureOperator(ctx("PLATFORM_SECURITY"));
    const senior = ensureOperator(ctx("SUPER_ADMIN"));
    assert.strictEqual(
      await codeOf(() => PlatformApprovalService.request(security, { actionKey: "operator.assign_role", payload: { user_id: senior.platformUser.id, role: "PLATFORM_SECURITY" }, reason: "demote the super admin", ticketRef: "SEC-4" })),
      "FORBIDDEN"
    );
  });

  await runTest("M5: one-by-one plan changes off a version count toward the migration threshold", async () => {
    const mk = (name: string) =>
      PlatformTenantService.provisionTenant({ name, slug: uid("one").replace(/_/g, "-"), plan_id: planId, owner_email: `${uid("own")}@x.test`, owner_name: "O" }, opA).tenant;
    const a = mk("One A");
    const b = mk("One B");
    const from = db.findSubscriptionByTenantId(a.id)!.plan_version_id;
    const other = PlatformPlanService.createPlan(opA, { id: `${planId}_B`, name: "Other", description: "", visibility: "HIDDEN", reason: "console suite second plan" });
    const d = PlatformPlanService.saveDraft(opA, other.id, { monthly_price_bdt: 10, annual_price_bdt: null, trial_days: null, setup_fee_bdt: null, features: {} });
    PlatformPlanService.publishVersion(opA, d.id, "console suite publishes the other plan");
    const stored = db.findPlatformSetting("plans.migration_approval_threshold");
    const setThreshold = (value: number) =>
      db.savePlatformSetting({ key: "plans.migration_approval_threshold", value, category: "BILLING", description: "test", is_sensitive: false, updated_at: nowIso() });
    try {
      // The smallest threshold at which moving B alone needs no approval
      for (let threshold = 0; threshold < 100; threshold++) {
        setThreshold(threshold);
        if (!(await PlatformPlanService.migrationImpact(opA, from, v1, [b.id])).approval_required) break;
      }
      PlatformSubscriptionService.changeTenantPlan(a.id, other.id, "console suite moves A by hand", opA);
      assert.strictEqual((await PlatformPlanService.migrationImpact(opA, from, v1, [b.id])).approval_required, true, "the manual move counts");
    } finally {
      db.savePlatformSetting(stored ?? { key: "plans.migration_approval_threshold", value: 10, category: "BILLING", description: "test", is_sensitive: false, updated_at: nowIso() });
    }
  });

  await runTest("LOW 10: an approval stops working once its approver loses the right to approve", async () => {
    const approver = ensureOperator(ctx("SUPER_ADMIN"));
    const req = PlatformApprovalService.request(opA, { actionKey: "tenant.suspend", payload: { tenant: otherOld.id }, reason: "approver will be demoted", ticketRef: "T-4" });
    PlatformApprovalService.decide(approver, req.id, "APPROVE", "looks right to me");
    const m = db.findPlatformMembershipByUserId(approver.platformUser.id)!;
    db.savePlatformMembership({ ...m, role: "PLATFORM_ANALYST" });
    assert.strictEqual(
      await codeOf(() => PlatformTenantService.suspendTenant(otherOld.id, "approver will be demoted", opA, { ticketRef: "T-4", approvalId: req.id })),
      "APPROVAL_INVALID"
    );
  });

  // ---------------------------------------------------------------- notices
  await runTest("announcements reach only targeted workspaces once published; maintenance in progress is shown", () => {
    const ann = PlatformCommunicationsService.saveAnnouncement(opA, { title: "Console notice", message: "Hello", announcement_type: "INFO", target_scope: "TENANT_LIST", target_tenant_ids: [tenantId] });
    assert.ok(!PlatformCommunicationsService.noticesForTenant(tenantId).some((n) => n.id === ann.id), "drafts are not shown");
    PlatformCommunicationsService.setPublished(opA, ann.id, true);
    assert.ok(PlatformCommunicationsService.noticesForTenant(tenantId).some((n) => n.id === ann.id));
    assert.ok(!PlatformCommunicationsService.noticesForTenant(oldTenant.id).some((n) => n.id === ann.id), "other workspaces don't see it");
    PlatformCommunicationsService.setPublished(opA, ann.id, false);
    const mw = PlatformCommunicationsService.scheduleMaintenance(opA, {
      title: "DB upgrade",
      description: "Brief pauses",
      scheduled_start: new Date(Date.now() - 60_000).toISOString(),
      scheduled_end: new Date(Date.now() + 60 * 60_000).toISOString(),
      reason: "console suite maintenance",
    });
    assert.ok(PlatformCommunicationsService.noticesForTenant(oldTenant.id).some((n) => n.id === mw.id && n.type === "IN_PROGRESS"));
    PlatformCommunicationsService.cancelMaintenance(opA, mw.id, "console suite cleanup");
  });

  console.log(`\n  Tests Passed: ${passed} | Tests Failed: ${failed}`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
