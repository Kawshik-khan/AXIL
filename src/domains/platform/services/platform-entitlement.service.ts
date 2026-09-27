import { db } from "@/infrastructure/db";
import { EntitlementRecord, TenantEntitlementRecord, UsageRecordRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { NotFoundError } from "@/lib/errors";

export class PlatformEntitlementService {
  /**
   * Centralized entitlement evaluator.
   * Resolves: Tenant Override -> Subscription Plan Version Feature -> Entitlement Default.
   */
  public static async can(
    tenantId: string,
    entitlementId: string,
    requiredQuantity = 1
  ): Promise<boolean> {
    // 1. Check for Tenant-specific Override
    const override = db.findTenantEntitlement(tenantId, entitlementId);
    if (override && override.is_override) {
      if (typeof override.value === "boolean") return override.value;
      if (typeof override.value === "number") {
        const usage = this.getCurrentUsage(tenantId, entitlementId);
        return usage + requiredQuantity <= override.value;
      }
    }

    // 2. Check Subscription Plan Version Features
    const sub = db.findSubscriptionByTenantId(tenantId);
    if (sub && sub.status === "ACTIVE") {
      const planVersion = db.findPlanVersionById(sub.plan_version_id);
      if (planVersion && planVersion.features && entitlementId in planVersion.features) {
        const planVal = planVersion.features[entitlementId];
        if (typeof planVal === "boolean") return planVal;
        if (typeof planVal === "number") {
          const usage = this.getCurrentUsage(tenantId, entitlementId);
          return usage + requiredQuantity <= planVal;
        }
      }
    }

    // 3. Check System-wide Entitlement Default
    const defaultEnt = db.findEntitlementById(entitlementId);
    if (defaultEnt) {
      if (defaultEnt.value_type === "BOOLEAN") {
        return Boolean(defaultEnt.default_value);
      }
      if (defaultEnt.value_type === "NUMERIC") {
        const limit = Number(defaultEnt.default_value) || 0;
        const usage = this.getCurrentUsage(tenantId, entitlementId);
        return usage + requiredQuantity <= limit;
      }
    }

    // Default to true if not strictly gated
    return true;
  }

  /**
   * Calculates current period usage for a specific entitlement and tenant.
   */
  public static getCurrentUsage(tenantId: string, entitlementId: string): number {
    const records = db.getUsageRecords(tenantId);
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const record = records.find(
      (r) => r.entitlement_id === entitlementId && r.period_start.substring(0, 7) === periodStart.substring(0, 7)
    );
    return record?.quantity_used || 0;
  }

  /**
   * Increments usage for an entitlement.
   */
  public static recordUsage(tenantId: string, entitlementId: string, delta = 1): UsageRecordRecord {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const existing = db.getUsageRecords(tenantId).find(
      (r) => r.entitlement_id === entitlementId && r.period_start.substring(0, 7) === periodStart.substring(0, 7)
    );

    const updated: UsageRecordRecord = {
      id: existing?.id || `usg_${Math.random().toString(36).substring(2, 10)}`,
      tenant_id: tenantId,
      entitlement_id: entitlementId,
      period_start: periodStart,
      period_end: periodEnd,
      quantity_used: (existing?.quantity_used || 0) + delta,
      recorded_at: now.toISOString(),
    };

    return db.saveUsageRecord(updated);
  }

  /**
   * Sets or overrides an entitlement for a specific tenant.
   */
  public static setTenantOverride(
    tenantId: string,
    entitlementId: string,
    value: unknown,
    reason: string,
    context: PlatformContext
  ): TenantEntitlementRecord {
    PlatformAuthorizationService.assertCan(context, "entitlement.manage");

    const tenant = db.findTenantById(tenantId);
    if (!tenant) throw new NotFoundError(`Tenant "${tenantId}" not found.`);

    const entitlement = db.findEntitlementById(entitlementId);
    if (!entitlement) throw new NotFoundError(`Entitlement "${entitlementId}" not found.`);

    const beforeState = db.findTenantEntitlement(tenantId, entitlementId);

    const record: TenantEntitlementRecord = {
      tenant_id: tenantId,
      entitlement_id: entitlementId,
      value,
      is_override: true,
      override_reason: reason,
      updated_at: new Date().toISOString(),
    };

    db.saveTenantEntitlement(record);

    PlatformAuditService.record(
      {
        action: "entitlement.override",
        resource_type: "tenant_entitlement",
        resource_id: `${tenantId}:${entitlementId}`,
        target_tenant_id: tenantId,
        reason,
        before_state: beforeState ? { value: beforeState.value } : null,
        after_state: { value, override_reason: reason },
        result: "SUCCESS",
      },
      context
    );

    return record;
  }

  /**
   * Lists all system entitlements.
   */
  public static listEntitlements(context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "entitlement.read");
    return db.getEntitlements();
  }

  /**
   * Lists effective entitlements and usage for a tenant.
   */
  public static getTenantEntitlementsStatus(tenantId: string, context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "entitlement.read");

    const all = db.getEntitlements();
    const overrides = db.getTenantEntitlements(tenantId);
    const sub = db.findSubscriptionByTenantId(tenantId);
    const planVersion = sub ? db.findPlanVersionById(sub.plan_version_id) : null;

    return all.map((ent) => {
      const override = overrides.find((o) => o.entitlement_id === ent.id);
      const planVal = planVersion?.features ? planVersion.features[ent.id] : undefined;
      const effectiveValue = override?.is_override ? override.value : planVal ?? ent.default_value;
      const usage = ent.value_type === "NUMERIC" ? this.getCurrentUsage(tenantId, ent.id) : null;

      return {
        id: ent.id,
        name: ent.name,
        value_type: ent.value_type,
        effective_value: effectiveValue,
        is_override: Boolean(override?.is_override),
        override_reason: override?.override_reason,
        current_usage: usage,
      };
    });
  }
}
