/**
 * Plan builder (super-admin console plan C2, C5): plans, versioned drafts → published → retired, and moving tenants
 * between versions with a computed impact preview. A published version is immutable; editing makes a new draft.
 * Plan features are validated against the entitlement catalog (only enforced limits can be set).
 */
import crypto from "crypto";
import { db } from "@/infrastructure/db";
import type { PlanRecord, PlanVersionRecord, SubscriptionRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { AppError, NotFoundError } from "@/lib/errors";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { PlatformEntitlementService } from "./platform-entitlement.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { PrivilegedActionGate } from "./privileged-action-gate";
import { ENTITLEMENT_CATALOG, featureMapErrors } from "../entitlement-catalog";
import { annualPrice, latestPublished, monthlyPrice, mrrContribution, versionStatus, type PlanVersionStatus } from "../plan-pricing";

export interface PlanVersionView extends PlanVersionRecord {
  effective_status: PlanVersionStatus;
  subscriber_count: number;
  monthly_price: number | null;
  annual_price: number | null;
  /** Stored feature keys that are not in the catalog: ignored by enforcement. */
  unknown_feature_keys: string[];
}

export interface PlanView extends PlanRecord {
  effective_visibility: "PUBLIC" | "HIDDEN" | "PRIVATE";
  versions: PlanVersionView[];
  current_version: PlanVersionView | null;
  draft_version: PlanVersionView | null;
  subscriber_count: number;
  mrr_bdt: number;
}

export interface DraftInput {
  monthly_price_bdt: number | null;
  annual_price_bdt: number | null;
  trial_days: number | null;
  setup_fee_bdt: number | null;
  features: Record<string, number | boolean | null>;
  change_note?: string;
}

export interface MigrationImpact {
  from_version: { id: string; plan_id: string; version: number };
  to_version: { id: string; plan_id: string; version: number; status: PlanVersionStatus };
  affected_tenants: number;
  /** For each limit the target version lowers: how many affected tenants already use more than the new value. */
  lowered_limits: Array<{ id: string; label: string; from: unknown; to: unknown; tenants_above_new_limit: number }>;
  mrr_before_bdt: number;
  mrr_after_bdt: number;
  approval_required: boolean;
  approval_threshold: number;
}

const PLAN_ID = /^[A-Z][A-Z0-9_]{1,39}$/;

function knownCatalogIds(): Set<string> {
  return new Set(ENTITLEMENT_CATALOG.map((e) => e.id));
}

function subscriptionsOn(versionId: string): SubscriptionRecord[] {
  return db.getSubscriptions().filter((s) => s.plan_version_id === versionId && s.status !== "CANCELLED" && s.status !== "EXPIRED");
}

function validateDraft(input: DraftInput): void {
  const problems = featureMapErrors(input.features);
  for (const [field, value] of [
    ["Monthly price", input.monthly_price_bdt],
    ["Annual price", input.annual_price_bdt],
    ["Setup fee", input.setup_fee_bdt],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 100_000_000)) problems.push(`${field} must be a whole number of taka, 0 or more.`);
  }
  if (input.trial_days !== null && (!Number.isInteger(input.trial_days) || input.trial_days < 0 || input.trial_days > 365)) {
    problems.push("Trial days must be between 0 and 365.");
  }
  if (problems.length > 0) throw new AppError("PLAN_DRAFT_INVALID", problems.join(" "), 400, { problems });
}

export class PlatformPlanService {
  private static versionView(v: PlanVersionRecord): PlanVersionView {
    const known = knownCatalogIds();
    return {
      ...v,
      effective_status: versionStatus(v),
      subscriber_count: subscriptionsOn(v.id).length,
      monthly_price: monthlyPrice(v),
      annual_price: annualPrice(v),
      unknown_feature_keys: Object.keys(v.features ?? {}).filter((k) => !known.has(k)),
    };
  }

  private static planView(plan: PlanRecord): PlanView {
    const versions = db
      .getPlanVersions(plan.id)
      .slice()
      .sort((a, b) => b.version - a.version)
      .map((v) => this.versionView(v));
    const published = latestPublished(versions);
    const subs = db.getSubscriptions().filter((s) => s.plan_id === plan.id && (s.status === "ACTIVE" || s.status === "PAST_DUE"));
    const mrr = subs.reduce((sum, s) => {
      const v = versions.find((x) => x.id === s.plan_version_id);
      return sum + (v && s.status === "ACTIVE" ? mrrContribution(s, v) : 0);
    }, 0);
    return {
      ...plan,
      effective_visibility: plan.visibility ?? "PUBLIC",
      versions,
      current_version: published ? versions.find((v) => v.id === published.id) ?? null : null,
      draft_version: versions.find((v) => v.effective_status === "DRAFT") ?? null,
      subscriber_count: versions.reduce((n, v) => n + v.subscriber_count, 0),
      mrr_bdt: Math.round(mrr),
    };
  }

  public static listPlans(context: PlatformContext): PlanView[] {
    PlatformAuthorizationService.assertCan(context, "plan.read");
    return db
      .getPlans()
      .map((p) => this.planView(p))
      .sort((a, b) => (a.display_order ?? 1_000) - (b.display_order ?? 1_000) || a.name.localeCompare(b.name));
  }

  public static getPlan(context: PlatformContext, planId: string): PlanView {
    PlatformAuthorizationService.assertCan(context, "plan.read");
    const plan = db.findPlanById(planId);
    if (!plan) throw new NotFoundError(`Plan "${planId}" not found.`);
    return this.planView(plan);
  }

  /** Creates a plan with an empty DRAFT v1 (nothing is sellable until a version is published). */
  public static createPlan(
    context: PlatformContext,
    input: { id: string; name: string; description: string; visibility: "PUBLIC" | "HIDDEN" | "PRIVATE"; display_order?: number; highlight_label?: string; reason: string }
  ): PlanView {
    const id = input.id.trim().toUpperCase();
    PrivilegedActionGate.assert(context, "plan.create", { reason: input.reason, payload: { id } });
    if (!PLAN_ID.test(id)) throw new AppError("INVALID_PLAN_ID", "Plan ids are 2–40 capital letters, digits or underscores, starting with a letter.", 400);
    if (db.findPlanById(id)) throw new AppError("PLAN_ALREADY_EXISTS", `Plan "${id}" already exists.`, 409);

    const now = new Date().toISOString();
    const plan: PlanRecord = {
      id,
      name: input.name.trim(),
      description: input.description.trim(),
      is_active: true,
      visibility: input.visibility,
      ...(input.display_order !== undefined ? { display_order: input.display_order } : {}),
      ...(input.highlight_label?.trim() ? { highlight_label: input.highlight_label.trim() } : {}),
      created_at: now,
      updated_at: now,
    };
    db.savePlan(plan);
    const draft: PlanVersionRecord = {
      id: `pv_${crypto.randomUUID().replace(/-/g, "").substring(0, 16)}`,
      plan_id: id,
      version: 1,
      billing_period: "MONTHLY",
      price_bdt: 0,
      features: {},
      is_published: false,
      status: "DRAFT",
      monthly_price_bdt: null,
      annual_price_bdt: null,
      trial_days: null,
      setup_fee_bdt: null,
      created_by: context.platformUser.id,
      created_at: now,
      updated_at: now,
    };
    db.savePlanVersion(draft);

    PlatformAuditService.record(
      { action: "plan.create", resource_type: "plan", resource_id: id, reason: input.reason.trim(), after_state: { plan }, result: "SUCCESS" },
      context
    );
    return this.planView(plan);
  }

  public static updatePlan(
    context: PlatformContext,
    planId: string,
    input: {
      name?: string;
      description?: string;
      visibility?: "PUBLIC" | "HIDDEN" | "PRIVATE";
      private_tenant_ids?: string[];
      display_order?: number | null;
      highlight_label?: string | null;
      is_active?: boolean;
      reason: string;
    }
  ): PlanView {
    PrivilegedActionGate.assert(context, "plan.update", { reason: input.reason, payload: { plan_id: planId } });
    const plan = db.findPlanById(planId);
    if (!plan) throw new NotFoundError(`Plan "${planId}" not found.`);
    if (input.private_tenant_ids) {
      const missing = input.private_tenant_ids.filter((t) => !db.findTenantById(t));
      if (missing.length) throw new AppError("UNKNOWN_TENANTS", `Unknown tenants: ${missing.join(", ")}`, 400);
    }

    const updated: PlanRecord = {
      ...plan,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.private_tenant_ids !== undefined ? { private_tenant_ids: input.private_tenant_ids } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
      updated_at: new Date().toISOString(),
    };
    if (input.display_order === null) delete updated.display_order;
    else if (input.display_order !== undefined) updated.display_order = input.display_order;
    if (input.highlight_label === null || input.highlight_label === "") delete updated.highlight_label;
    else if (input.highlight_label !== undefined) updated.highlight_label = input.highlight_label.trim();
    db.savePlan(updated);

    PlatformAuditService.record(
      {
        action: "plan.update",
        resource_type: "plan",
        resource_id: planId,
        reason: input.reason.trim(),
        before_state: { ...plan },
        after_state: { ...updated },
        result: "SUCCESS",
      },
      context
    );
    return this.planView(updated);
  }

  /**
   * Saves the plan's draft. With no draft, starts one copied from nothing (the caller sends the full terms).
   * Published and retired versions are never edited (SA-9).
   */
  public static saveDraft(context: PlatformContext, planId: string, input: DraftInput): PlanVersionView {
    PrivilegedActionGate.assert(context, "plan.version_draft", { payload: { plan_id: planId } });
    const plan = db.findPlanById(planId);
    if (!plan) throw new NotFoundError(`Plan "${planId}" not found.`);
    validateDraft(input);

    const versions = db.getPlanVersions(planId);
    const draft = versions.find((v) => versionStatus(v) === "DRAFT");
    const now = new Date().toISOString();
    const legacyPrice = input.monthly_price_bdt ?? input.annual_price_bdt ?? 0;
    const legacyPeriod: "MONTHLY" | "ANNUAL" = input.monthly_price_bdt !== null ? "MONTHLY" : input.annual_price_bdt !== null ? "ANNUAL" : "MONTHLY";

    const record: PlanVersionRecord = {
      id: draft?.id ?? `pv_${crypto.randomUUID().replace(/-/g, "").substring(0, 16)}`,
      plan_id: planId,
      version: draft?.version ?? Math.max(0, ...versions.map((v) => v.version)) + 1,
      billing_period: legacyPeriod,
      price_bdt: legacyPrice,
      features: { ...input.features },
      is_published: false,
      status: "DRAFT",
      monthly_price_bdt: input.monthly_price_bdt,
      annual_price_bdt: input.annual_price_bdt,
      trial_days: input.trial_days,
      setup_fee_bdt: input.setup_fee_bdt,
      ...(input.change_note?.trim() ? { change_note: input.change_note.trim() } : {}),
      created_by: draft?.created_by ?? context.platformUser.id,
      created_at: draft?.created_at ?? now,
      updated_at: now,
    };
    db.savePlanVersion(record);

    PlatformAuditService.record(
      {
        action: draft ? "plan_version.draft_updated" : "plan_version.draft_created",
        resource_type: "plan_version",
        resource_id: record.id,
        reason: input.change_note?.trim() || `Draft v${record.version} of ${plan.name}`,
        before_state: draft ? { features: draft.features, monthly_price_bdt: draft.monthly_price_bdt ?? null, annual_price_bdt: draft.annual_price_bdt ?? null } : null,
        after_state: { features: record.features, monthly_price_bdt: record.monthly_price_bdt, annual_price_bdt: record.annual_price_bdt, trial_days: record.trial_days },
        result: "SUCCESS",
      },
      context
    );
    return this.versionView(record);
  }

  /** Publishes a draft: it becomes the version new subscribers get. Existing subscribers keep theirs. */
  public static publishVersion(context: PlatformContext, versionId: string, reason: string): PlanVersionView {
    PrivilegedActionGate.assert(context, "plan.version_publish", { reason, payload: { version_id: versionId } });
    const version = db.findPlanVersionById(versionId);
    if (!version) throw new NotFoundError("Plan version not found.");
    if (versionStatus(version) !== "DRAFT") throw new AppError("VERSION_NOT_DRAFT", "Only a draft can be published.", 409);
    if (monthlyPrice(version) === null && annualPrice(version) === null) {
      throw new AppError("PRICE_REQUIRED", "Set a monthly or an annual price before publishing.", 400);
    }
    const problems = featureMapErrors(version.features ?? {});
    if (problems.length) throw new AppError("PLAN_DRAFT_INVALID", problems.join(" "), 400, { problems });

    const now = new Date().toISOString();
    const published: PlanVersionRecord = {
      ...version,
      status: "PUBLISHED",
      is_published: true,
      published_by: context.platformUser.id,
      published_at: now,
      updated_at: now,
    };
    db.savePlanVersion(published);
    PlatformAuditService.record(
      {
        action: "plan_version.publish",
        resource_type: "plan_version",
        resource_id: versionId,
        reason: reason.trim(),
        before_state: { status: "DRAFT" },
        after_state: { status: "PUBLISHED", version: published.version, features: published.features, monthly_price_bdt: monthlyPrice(published), annual_price_bdt: annualPrice(published) },
        result: "SUCCESS",
      },
      context
    );
    return this.versionView(published);
  }

  /** Stops new sign-ups on a version; current subscribers keep it. */
  public static retireVersion(context: PlatformContext, versionId: string, reason: string): PlanVersionView {
    PrivilegedActionGate.assert(context, "plan.version_retire", { reason, payload: { version_id: versionId } });
    const version = db.findPlanVersionById(versionId);
    if (!version) throw new NotFoundError("Plan version not found.");
    if (versionStatus(version) !== "PUBLISHED") throw new AppError("VERSION_NOT_PUBLISHED", "Only a published version can be retired.", 409);

    const now = new Date().toISOString();
    const retired: PlanVersionRecord = { ...version, status: "RETIRED", is_published: false, retired_at: now, updated_at: now };
    db.savePlanVersion(retired);
    PlatformAuditService.record(
      {
        action: "plan_version.retire",
        resource_type: "plan_version",
        resource_id: versionId,
        reason: reason.trim(),
        before_state: { status: "PUBLISHED" },
        after_state: { status: "RETIRED", subscribers_kept: subscriptionsOn(versionId).length },
        result: "SUCCESS",
      },
      context
    );
    return this.versionView(retired);
  }

  /** Tenants moved off a version in the last 24 hours, by migration or one-by-one plan changes (audit ledger). */
  private static recentlyMigratedFrom(fromVersionId: string, now: number = Date.now()): number {
    const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const moved = (action: string) =>
      db
        .getPlatformAuditLogs({ action, limit: 100_000 })
        .logs.filter((l) => l.created_at >= since && l.result === "SUCCESS" && l.before_state?.plan_version_id === fromVersionId && l.after_state?.plan_version_id !== fromVersionId).length;
    return moved("subscription.migrated") + moved("subscription.change_plan");
  }

  private static affectedSubscriptions(fromVersionId: string, tenantIds?: string[]): SubscriptionRecord[] {
    const subs = subscriptionsOn(fromVersionId);
    return tenantIds ? subs.filter((s) => tenantIds.includes(s.tenant_id)) : subs;
  }

  /** What moving tenants from one version to another would change, computed from current counts (read-only). */
  public static async migrationImpact(
    context: PlatformContext,
    fromVersionId: string,
    toVersionId: string,
    tenantIds?: string[]
  ): Promise<MigrationImpact> {
    PlatformAuthorizationService.assertCan(context, "subscription.read");
    const from = db.findPlanVersionById(fromVersionId);
    const to = db.findPlanVersionById(toVersionId);
    if (!from || !to) throw new NotFoundError("Plan version not found.");

    const subs = this.affectedSubscriptions(fromVersionId, tenantIds);
    const lowered: MigrationImpact["lowered_limits"] = [];
    for (const spec of ENTITLEMENT_CATALOG) {
      if (!spec.enforcedBy || spec.kind === "FEATURE") continue;
      const before = from.features?.[spec.id];
      const after = to.features?.[spec.id];
      const lowers =
        typeof after === "number" && (before === null || before === undefined ? false : typeof before !== "number" || after < before);
      const newlyCapped = typeof after === "number" && before === null;
      if (!lowers && !newlyCapped) continue;
      let above = 0;
      for (const s of subs) {
        if ((await PlatformEntitlementService.measureUsage(s.tenant_id, spec.id)) > (after as number)) above++;
      }
      lowered.push({ id: spec.id, label: spec.label, from: before ?? null, to: after, tenants_above_new_limit: above });
    }

    const threshold = PlatformSettingsService.getEffectiveSetting<number>("plans.migration_approval_threshold");
    const mrrBefore = subs.reduce((n, s) => n + (s.status === "ACTIVE" ? mrrContribution(s, from) : 0), 0);
    const mrrAfter = subs.reduce((n, s) => n + (s.status === "ACTIVE" ? mrrContribution(s, to) : 0), 0);
    return {
      from_version: { id: from.id, plan_id: from.plan_id, version: from.version },
      to_version: { id: to.id, plan_id: to.plan_id, version: to.version, status: versionStatus(to) },
      affected_tenants: subs.length,
      lowered_limits: lowered,
      mrr_before_bdt: Math.round(mrrBefore),
      mrr_after_bdt: Math.round(mrrAfter),
      approval_required: subs.length + this.recentlyMigratedFrom(fromVersionId) > threshold,
      approval_threshold: threshold,
    };
  }

  /**
   * Moves tenants from one version to a PUBLISHED version, effective now (HIGH, step-up; two-person above the
   * threshold). The approval binds the exact version pair and tenant list.
   */
  public static migrate(
    context: PlatformContext,
    input: { from_version_id: string; to_version_id: string; target_tenant_ids?: string[]; reason: string; ticket_ref?: string; approval_id?: string }
  ): { migrated: number; tenant_ids: string[] } {
    const subs = this.affectedSubscriptions(input.from_version_id, input.target_tenant_ids);
    const tenantIds = subs.map((s) => s.tenant_id).sort();
    const threshold = PlatformSettingsService.getEffectiveSetting<number>("plans.migration_approval_threshold");
    // Batches count together: tenants already moved off this version in the last 24 h add to this call (security review M5)
    const recentlyMoved = this.recentlyMigratedFrom(input.from_version_id);
    PrivilegedActionGate.assert(context, "plan.migrate", {
      reason: input.reason,
      ticketRef: input.ticket_ref,
      approvalId: input.approval_id,
      payload: { from_version_id: input.from_version_id, to_version_id: input.to_version_id, tenants: tenantIds },
      facts: { affectedCount: subs.length + recentlyMoved, countThreshold: threshold },
    });

    const from = db.findPlanVersionById(input.from_version_id);
    const to = db.findPlanVersionById(input.to_version_id);
    if (!from || !to) throw new NotFoundError("Plan version not found.");
    if (from.id === to.id) throw new AppError("SAME_VERSION", "Choose a different target version.", 400);
    if (versionStatus(to) !== "PUBLISHED") throw new AppError("VERSION_NOT_PUBLISHED", "Tenants can only move to a published version.", 409);
    if (subs.length === 0) throw new AppError("NOTHING_TO_MIGRATE", "No tenants are on the source version.", 400);

    const now = new Date().toISOString();
    for (const s of subs) {
      const updated: SubscriptionRecord = { ...s, plan_id: to.plan_id, plan_version_id: to.id, updated_at: now };
      if (!updated.billing_period) updated.billing_period = monthlyPrice(to) !== null ? "MONTHLY" : "ANNUAL";
      db.saveSubscription(updated);
      db.updateTenant(s.tenant_id, { plan_id: to.plan_id, updated_at: now });
      PlatformAuditService.record(
        {
          action: "subscription.migrated",
          resource_type: "subscription",
          resource_id: s.id,
          target_tenant_id: s.tenant_id,
          reason: input.reason.trim(),
          before_state: { plan_id: s.plan_id, plan_version_id: s.plan_version_id },
          after_state: { plan_id: to.plan_id, plan_version_id: to.id },
          result: "SUCCESS",
        },
        context
      );
    }
    PlatformAuditService.record(
      {
        action: "plan.migrate",
        resource_type: "plan_version",
        resource_id: to.id,
        reason: input.reason.trim(),
        before_state: { from_version_id: from.id },
        after_state: { to_version_id: to.id, migrated: subs.length, ticket_ref: input.ticket_ref ?? null },
        result: "SUCCESS",
      },
      context
    );
    return { migrated: subs.length, tenant_ids: tenantIds };
  }
}
