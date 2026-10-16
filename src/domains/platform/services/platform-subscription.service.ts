import { db } from "@/infrastructure/db";
import type { PlanVersionRecord, SubscriptionRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuditService } from "./platform-audit.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { PlatformPlanService } from "./platform-plan.service";
import { PrivilegedActionGate } from "./privileged-action-gate";
import { AppError, NotFoundError } from "@/lib/errors";
import { annualPrice, latestPublished, monthlyPrice } from "../plan-pricing";
import crypto from "crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The end of one billing period starting at `start` (calendar month or year). */
export function periodEnd(start: Date, period: "MONTHLY" | "ANNUAL"): Date {
  const end = new Date(start);
  if (period === "ANNUAL") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

function sellablePeriod(version: PlanVersionRecord, requested?: "MONTHLY" | "ANNUAL"): "MONTHLY" | "ANNUAL" {
  if (requested === "ANNUAL" && annualPrice(version) === null) {
    throw new AppError("PERIOD_NOT_OFFERED", "This plan version has no annual price.", 400);
  }
  if (requested === "MONTHLY" && monthlyPrice(version) === null) {
    throw new AppError("PERIOD_NOT_OFFERED", "This plan version has no monthly price.", 400);
  }
  return requested ?? (monthlyPrice(version) !== null ? "MONTHLY" : "ANNUAL");
}

export class PlatformSubscriptionService {
  /** Plans with their latest published version (kept for older callers; the console uses PlatformPlanService). */
  public static listPlans(context: PlatformContext) {
    return PlatformPlanService.listPlans(context).map((p) => ({
      ...p,
      current_version: p.current_version,
      versions_count: p.versions.length,
    }));
  }

  /** The latest PUBLISHED version of a plan; a plan without one can't be subscribed to. */
  public static subscribableVersion(planId: string): PlanVersionRecord {
    const plan = db.findPlanById(planId);
    if (!plan) throw new NotFoundError(`Plan "${planId}" not found.`);
    const version = latestPublished(db.getPlanVersions(planId));
    if (!version) throw new AppError("PLAN_NOT_PUBLISHED", `Plan "${plan.name}" has no published version.`, 409);
    return version;
  }

  /**
   * Moves a tenant to the latest published version of a plan (SA-10: previously the oldest). The period restarts
   * now for the chosen billing period; a TRIAL stays a trial unless `endTrial` is set.
   */
  public static changeTenantPlan(
    tenantId: string,
    newPlanId: string,
    reason: string,
    context: PlatformContext,
    options: { billingPeriod?: "MONTHLY" | "ANNUAL"; endTrial?: boolean } = {}
  ): SubscriptionRecord {
    const payload = { tenant_id: tenantId, plan_id: newPlanId, billing_period: options.billingPeriod ?? null, end_trial: Boolean(options.endTrial) };
    PrivilegedActionGate.assert(context, "subscription.change_plan", { reason, payload });

    const tenant = db.findTenantById(tenantId);
    if (!tenant) throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    const version = this.subscribableVersion(newPlanId);
    const period = sellablePeriod(version, options.billingPeriod);

    const existing = db.findSubscriptionByTenantId(tenantId);
    const now = new Date();
    const stayTrial = existing?.status === "TRIAL" && !options.endTrial;
    const updated: SubscriptionRecord = {
      id: existing?.id || `sub_${crypto.randomUUID().substring(0, 12)}`,
      tenant_id: tenantId,
      plan_id: version.plan_id,
      plan_version_id: version.id,
      status: stayTrial ? "TRIAL" : "ACTIVE",
      billing_period: period,
      ...(stayTrial && existing?.trial_ends_at ? { trial_ends_at: existing.trial_ends_at } : {}),
      current_period_start: now.toISOString(),
      current_period_end: periodEnd(now, period).toISOString(),
      cancel_at_period_end: false,
      created_at: existing?.created_at || now.toISOString(),
      updated_at: now.toISOString(),
    };
    db.saveSubscription(updated);
    db.updateTenant(tenantId, { plan_id: version.plan_id, updated_at: now.toISOString() });

    PlatformAuditService.record(
      {
        action: "subscription.change_plan",
        resource_type: "subscription",
        resource_id: updated.id,
        target_tenant_id: tenantId,
        reason: reason.trim(),
        before_state: existing
          ? { plan_id: existing.plan_id, plan_version_id: existing.plan_version_id, status: existing.status, billing_period: existing.billing_period ?? null }
          : null,
        after_state: { plan_id: updated.plan_id, plan_version_id: updated.plan_version_id, version: version.version, status: updated.status, billing_period: period },
        result: "SUCCESS",
      },
      context
    );
    return updated;
  }

  /**
   * Starts a TRIAL on the latest published version of a plan. Trial length: the version's trial_days, else the
   * `billing.trial_default_days` setting. Refused while the tenant has an ACTIVE or TRIAL subscription.
   */
  public static startTrial(context: PlatformContext, tenantId: string, planId: string, reason: string): SubscriptionRecord {
    PrivilegedActionGate.assert(context, "subscription.change_plan", { reason, payload: { tenant: tenantId, plan_id: planId, trial: true } });
    const tenant = db.findTenantById(tenantId);
    if (!tenant) throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    const existing = db.findSubscriptionByTenantId(tenantId);
    if (existing && (existing.status === "ACTIVE" || existing.status === "TRIAL")) {
      throw new AppError("SUBSCRIPTION_EXISTS", `The tenant already has a ${existing.status.toLowerCase()} subscription.`, 409);
    }
    const version = this.subscribableVersion(planId);
    const days = version.trial_days ?? PlatformSettingsService.getEffectiveSetting<number>("billing.trial_default_days");
    if (days <= 0) throw new AppError("TRIAL_NOT_OFFERED", "This plan version has no trial.", 400);

    const now = new Date();
    const trialEnd = new Date(now.getTime() + days * DAY_MS);
    const sub: SubscriptionRecord = {
      id: existing?.id || `sub_${crypto.randomUUID().substring(0, 12)}`,
      tenant_id: tenantId,
      plan_id: version.plan_id,
      plan_version_id: version.id,
      status: "TRIAL",
      billing_period: sellablePeriod(version),
      trial_ends_at: trialEnd.toISOString(),
      current_period_start: now.toISOString(),
      current_period_end: trialEnd.toISOString(),
      cancel_at_period_end: false,
      created_at: existing?.created_at || now.toISOString(),
      updated_at: now.toISOString(),
    };
    db.saveSubscription(sub);
    db.updateTenant(tenantId, { plan_id: version.plan_id, updated_at: now.toISOString() });

    PlatformAuditService.record(
      {
        action: "subscription.trial_started",
        resource_type: "subscription",
        resource_id: sub.id,
        target_tenant_id: tenantId,
        reason: reason.trim(),
        before_state: existing ? { status: existing.status, plan_id: existing.plan_id } : null,
        after_state: { plan_id: sub.plan_id, plan_version_id: sub.plan_version_id, trial_ends_at: sub.trial_ends_at, trial_days: days },
        result: "SUCCESS",
      },
      context
    );
    return sub;
  }

  /** Moves a trial's end date later, by at most `billing.trial_max_extension_days` in one step. */
  public static extendTrial(context: PlatformContext, tenantId: string, newEndIso: string, reason: string): SubscriptionRecord {
    PrivilegedActionGate.assert(context, "subscription.extend_trial", { reason, payload: { tenant: tenantId, trial_ends_at: newEndIso } });
    const sub = db.findSubscriptionByTenantId(tenantId);
    if (!sub || sub.status !== "TRIAL") throw new AppError("NOT_IN_TRIAL", "The tenant is not on a trial.", 409);

    const newEnd = Date.parse(newEndIso);
    const now = Date.now();
    const currentEnd = sub.trial_ends_at ? Date.parse(sub.trial_ends_at) : now;
    const from = Math.max(currentEnd, now);
    if (Number.isNaN(newEnd) || newEnd <= from) {
      throw new AppError("INVALID_TRIAL_END", "The new trial end must be later than the current one.", 400);
    }
    const maxDays = PlatformSettingsService.getEffectiveSetting<number>("billing.trial_max_extension_days");
    if (newEnd - from > maxDays * DAY_MS) {
      throw new AppError("TRIAL_EXTENSION_TOO_LONG", `One extension can add at most ${maxDays} days.`, 400, { max_days: maxDays });
    }

    const updated: SubscriptionRecord = {
      ...sub,
      trial_ends_at: new Date(newEnd).toISOString(),
      current_period_end: new Date(newEnd).toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.saveSubscription(updated);
    PlatformAuditService.record(
      {
        action: "subscription.trial_extended",
        resource_type: "subscription",
        resource_id: sub.id,
        target_tenant_id: tenantId,
        reason: reason.trim(),
        before_state: { trial_ends_at: sub.trial_ends_at ?? null },
        after_state: { trial_ends_at: updated.trial_ends_at },
        result: "SUCCESS",
      },
      context
    );
    return updated;
  }
}
