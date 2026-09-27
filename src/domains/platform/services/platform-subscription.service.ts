import { db } from "@/infrastructure/db";
import { PlanRecord, PlanVersionRecord, SubscriptionRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { AppError, NotFoundError } from "@/lib/errors";
import crypto from "crypto";

export class PlatformSubscriptionService {
  /**
   * Lists all SaaS plans with active version metadata.
   */
  public static listPlans(context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "plan.read");
    const plans = db.getPlans();
    return plans.map((plan) => {
      const versions = db.getPlanVersions(plan.id);
      const activeVersion = versions.find((v) => v.is_published) || versions[0];
      return {
        ...plan,
        current_version: activeVersion,
        versions_count: versions.length,
      };
    });
  }

  /**
   * Creates a new SaaS plan and publishes its version 1.
   */
  public static createPlan(
    input: {
      id: string;
      name: string;
      description: string;
      price_bdt: number;
      billing_period?: "MONTHLY" | "ANNUAL";
      features?: Record<string, unknown>;
    },
    context: PlatformContext
  ) {
    PlatformAuthorizationService.assertCan(context, "plan.create");

    const existing = db.findPlanById(input.id);
    if (existing) {
      throw new AppError("PLAN_ALREADY_EXISTS", `Plan with id "${input.id}" already exists.`, 409);
    }

    const now = new Date().toISOString();
    const plan: PlanRecord = {
      id: input.id.toUpperCase(),
      name: input.name,
      description: input.description,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    db.savePlan(plan);

    const version: PlanVersionRecord = {
      id: `pv_${input.id.toLowerCase()}_v1`,
      plan_id: plan.id,
      version: 1,
      billing_period: input.billing_period || "MONTHLY",
      price_bdt: input.price_bdt,
      features: input.features || {},
      is_published: true,
      created_at: now,
    };
    db.savePlanVersion(version);

    PlatformAuditService.record(
      {
        action: "plan.create",
        resource_type: "plan",
        resource_id: plan.id,
        reason: `Created SaaS plan ${plan.name}`,
        after_state: { plan, version },
        result: "SUCCESS",
      },
      context
    );

    return { plan, version };
  }

  /**
   * Versioned plan publishing. Never silently modifies active plan behavior.
   */
  public static createPlanVersion(
    planId: string,
    input: {
      price_bdt: number;
      billing_period?: "MONTHLY" | "ANNUAL";
      features?: Record<string, unknown>;
    },
    context: PlatformContext
  ) {
    PlatformAuthorizationService.assertCan(context, "plan.update");

    const plan = db.findPlanById(planId);
    if (!plan) throw new NotFoundError(`Plan "${planId}" not found.`);

    const existingVersions = db.getPlanVersions(planId);
    const nextVersionNum = existingVersions.length + 1;
    const now = new Date().toISOString();

    const newVersion: PlanVersionRecord = {
      id: `pv_${planId.toLowerCase()}_v${nextVersionNum}`,
      plan_id: planId,
      version: nextVersionNum,
      billing_period: input.billing_period || "MONTHLY",
      price_bdt: input.price_bdt,
      features: input.features || {},
      is_published: true,
      created_at: now,
    };
    db.savePlanVersion(newVersion);

    PlatformAuditService.record(
      {
        action: "plan_version.create",
        resource_type: "plan_version",
        resource_id: newVersion.id,
        reason: `Published version ${nextVersionNum} for plan ${plan.name}`,
        after_state: { newVersion },
        result: "SUCCESS",
      },
      context
    );

    return newVersion;
  }

  /**
   * Upgrades or changes a tenant's subscription to a new plan.
   */
  public static changeTenantPlan(
    tenantId: string,
    newPlanId: string,
    reason: string,
    context: PlatformContext
  ) {
    PlatformAuthorizationService.assertCan(context, "subscription.manage");

    const tenant = db.findTenantById(tenantId);
    if (!tenant) throw new NotFoundError(`Tenant "${tenantId}" not found.`);

    const newPlan = db.findPlanById(newPlanId);
    if (!newPlan) throw new NotFoundError(`Plan "${newPlanId}" not found.`);

    const versions = db.getPlanVersions(newPlanId);
    const publishedVersion = versions.find((v) => v.is_published) || versions[0];
    if (!publishedVersion) throw new NotFoundError(`No published version found for plan "${newPlanId}".`);

    const existingSub = db.findSubscriptionByTenantId(tenantId);
    const now = new Date().toISOString();
    const nextPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const updatedSub: SubscriptionRecord = {
      id: existingSub?.id || `sub_${crypto.randomUUID().substring(0, 12)}`,
      tenant_id: tenantId,
      plan_id: newPlan.id,
      plan_version_id: publishedVersion.id,
      status: "ACTIVE",
      current_period_start: now,
      current_period_end: nextPeriodEnd,
      cancel_at_period_end: false,
      created_at: existingSub?.created_at || now,
      updated_at: now,
    };
    db.saveSubscription(updatedSub);

    // Also update tenant's plan_id field
    db.updateTenant(tenantId, { plan_id: newPlan.id, updated_at: now });

    PlatformAuditService.record(
      {
        action: "subscription.change_plan",
        resource_type: "subscription",
        resource_id: updatedSub.id,
        target_tenant_id: tenantId,
        reason: reason || `Changed subscription to ${newPlan.name}`,
        before_state: existingSub ? { plan_id: existingSub.plan_id } : null,
        after_state: { plan_id: newPlan.id, version: publishedVersion.version },
        result: "SUCCESS",
      },
      context
    );

    return updatedSub;
  }
}
