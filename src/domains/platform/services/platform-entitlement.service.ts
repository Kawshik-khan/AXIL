import { randomSuffix } from "@/lib/ids";
import { db } from "@/infrastructure/db";
import type { PlanVersionRecord, SubscriptionRecord, TenantEntitlementRecord, UsageRecordRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { PlatformSettingsService } from "./platform-settings.service";
import { AppError, NotFoundError } from "@/lib/errors";
import {
  ENTITLEMENT_CATALOG,
  entitlementValueError,
  findEntitlementSpec,
  type EntitlementSpec,
  type EntitlementValue,
} from "../entitlement-catalog";
import { countCurrent, isCountedLimit } from "./entitlement-usage";
import { PrivilegedActionGate } from "./privileged-action-gate";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where an effective entitlement value comes from (shown by the console's effective-value view). */
export type EntitlementSource = "OVERRIDE" | "PLAN" | "DEFAULT" | "NONE";

export interface ResolvedEntitlement {
  value: EntitlementValue;
  source: EntitlementSource;
  /** What active add-ons added on top of the plan or default value (0 when overridden or not numeric). */
  addon_increment: number;
}

/** Whether the tenant's plan version currently applies, and why (decision D7). */
export interface PlanApplicability {
  subscription: SubscriptionRecord | null;
  version: PlanVersionRecord | null;
  applies: boolean;
  reason: string;
}

export interface EffectiveEntitlement {
  id: string;
  label: string;
  description: string;
  kind: EntitlementSpec["kind"];
  unit?: string;
  enforced: boolean;
  enforced_by: string | null;
  value: EntitlementValue;
  source: EntitlementSource;
  addon_increment: number;
  /** Live count (COUNT_LIMIT) or this month's usage (PERIOD_QUOTA); null for features and unenforced entries. */
  usage: number | null;
  /** usage / limit (0..∞) when both are numbers and the limit is above 0; otherwise null. */
  usage_ratio: number | null;
  override: {
    value: unknown;
    reason?: string;
    expires_at?: string;
    granted_by?: string;
    ticket_ref?: string;
    expired: boolean;
  } | null;
  plan_value: unknown;
  default_value: unknown;
}

export interface TenantEntitlementReport {
  tenant_id: string;
  plan: {
    plan_id: string | null;
    plan_version_id: string | null;
    version: number | null;
    subscription_status: string | null;
    applies: boolean;
    reason: string;
  };
  entitlements: EffectiveEntitlement[];
  /** Keys stored on the plan version that are not in the catalog: they are ignored, never enforced. */
  unknown_plan_keys: string[];
}

function isEntitlementValue(v: unknown): v is EntitlementValue {
  return v === null || typeof v === "number" || typeof v === "boolean";
}

function monthKey(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().substring(0, 7);
}

export class PlatformEntitlementService {
  /**
   * Whether the tenant's plan version applies (decision D7): ACTIVE and TRIAL subscriptions use their plan; a TRIAL
   * past its end and a PAST_DUE subscription keep it for `billing.past_due_grace_days`; CANCELLED and EXPIRED don't.
   */
  public static planApplicability(tenantId: string, now: number = Date.now()): PlanApplicability {
    const subscription = db.findSubscriptionByTenantId(tenantId) ?? null;
    if (!subscription) return { subscription, version: null, applies: false, reason: "No subscription" };
    const version = db.findPlanVersionById(subscription.plan_version_id) ?? null;
    if (!version) return { subscription, version, applies: false, reason: "Plan version not found" };

    const graceMs = PlatformSettingsService.getEffectiveSetting<number>("billing.past_due_grace_days") * DAY_MS;
    switch (subscription.status) {
      case "ACTIVE":
        return { subscription, version, applies: true, reason: "Active subscription" };
      case "TRIAL": {
        const end = subscription.trial_ends_at ? Date.parse(subscription.trial_ends_at) : NaN;
        if (Number.isNaN(end) || now <= end) return { subscription, version, applies: true, reason: "Trial" };
        return now <= end + graceMs
          ? { subscription, version, applies: true, reason: "Trial ended; within the grace period" }
          : { subscription, version, applies: false, reason: "Trial ended; grace period over" };
      }
      case "PAST_DUE": {
        const end = Date.parse(subscription.current_period_end);
        return !Number.isNaN(end) && now <= end + graceMs
          ? { subscription, version, applies: true, reason: "Past due; within the grace period" }
          : { subscription, version, applies: false, reason: "Past due; grace period over" };
      }
      default:
        return { subscription, version, applies: false, reason: `Subscription ${subscription.status.toLowerCase()}` };
    }
  }

  private static activeOverride(tenantId: string, entitlementId: string, now: number): TenantEntitlementRecord | null {
    const override = db.findTenantEntitlement(tenantId, entitlementId);
    if (!override || !override.is_override || !isEntitlementValue(override.value)) return null;
    if (override.expires_at && Date.parse(override.expires_at) <= now) return null;
    return override;
  }

  /**
   * The value in force for a tenant: an unexpired override, then the plan version (when it applies), then the global
   * default, else not gated. A number is a cap, a boolean a feature switch, null means unlimited / not gated.
   */
  public static resolve(tenantId: string, entitlementId: string, now: number = Date.now()): ResolvedEntitlement {
    // An override is the operator's exact decision: add-ons don't stack on it
    const override = this.activeOverride(tenantId, entitlementId, now);
    if (override) return { value: override.value as EntitlementValue, source: "OVERRIDE", addon_increment: 0 };

    const withAddons = (value: EntitlementValue, source: EntitlementSource): ResolvedEntitlement => {
      if (typeof value !== "number") return { value, source, addon_increment: 0 };
      const increment = this.activeAddonIncrement(tenantId, entitlementId, now);
      return { value: value + increment, source, addon_increment: increment };
    };

    const plan = this.planApplicability(tenantId, now);
    if (plan.applies && plan.version?.features && Object.hasOwn(plan.version.features, entitlementId)) {
      const planVal = plan.version.features[entitlementId];
      if (isEntitlementValue(planVal)) return withAddons(planVal, "PLAN");
    }

    const defaultEnt = db.findEntitlementById(entitlementId);
    if (defaultEnt) {
      const value = defaultEnt.value_type === "BOOLEAN" ? Boolean(defaultEnt.default_value) : Number(defaultEnt.default_value) || 0;
      return withAddons(value, "DEFAULT");
    }
    return { value: null, source: "NONE", addon_increment: 0 };
  }

  /** Sum of active add-on increments for one entitlement (active = started, not ended, not revoked; derived on read). */
  public static activeAddonIncrement(tenantId: string, entitlementId: string, now: number = Date.now()): number {
    let total = 0;
    for (const grant of db.getTenantAddons(tenantId)) {
      if (grant.revoked_at || Date.parse(grant.starts_at) > now) continue;
      if (grant.ends_at && Date.parse(grant.ends_at) <= now) continue;
      const addon = db.findPlatformAddon(grant.addon_id);
      if (addon && addon.entitlement_id === entitlementId) total += addon.increment * grant.quantity;
    }
    return total;
  }

  /** The limit in force (see resolve). Used by the enforcement gate in src/lib/safety-gate.ts. */
  public static resolveLimit(tenantId: string, entitlementId: string): number | boolean | null {
    return this.resolve(tenantId, entitlementId).value;
  }

  /** This calendar month's recorded usage for a PERIOD_QUOTA entitlement. */
  public static getCurrentUsage(tenantId: string, entitlementId: string): number {
    const month = monthKey(new Date());
    const record = db
      .getUsageRecords(tenantId)
      .find((r) => r.entitlement_id === entitlementId && r.period_start.substring(0, 7) === month);
    return record?.quantity_used || 0;
  }

  /** Usage measured the way the entitlement is enforced: live counts for COUNT_LIMIT, monthly records otherwise. */
  public static async measureUsage(tenantId: string, entitlementId: string): Promise<number> {
    return isCountedLimit(entitlementId)
      ? await countCurrent(tenantId, entitlementId)
      : this.getCurrentUsage(tenantId, entitlementId);
  }

  /** Whether `requiredQuantity` more fits under the limit in force. Features return their switch; null = not gated. */
  public static async can(tenantId: string, entitlementId: string, requiredQuantity = 1): Promise<boolean> {
    const { value } = this.resolve(tenantId, entitlementId);
    if (value === null) return true;
    if (typeof value === "boolean") return value;
    const usage = await this.measureUsage(tenantId, entitlementId);
    return usage + requiredQuantity <= value;
  }

  /** Increments this month's usage for a PERIOD_QUOTA entitlement. */
  public static recordUsage(tenantId: string, entitlementId: string, delta = 1): UsageRecordRecord {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const existing = db.getUsageRecords(tenantId).find(
      (r) => r.entitlement_id === entitlementId && r.period_start.substring(0, 7) === periodStart.substring(0, 7)
    );

    const updated: UsageRecordRecord = {
      id: existing?.id || `usg_${randomSuffix()}`,
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
   * Sets a tenant override (HIGH: step-up). Only catalog entries that are enforced may be overridden (decision D8);
   * the value is checked against the catalog bounds. An optional `expires_at` ends the override without a write.
   */
  public static setTenantOverride(
    tenantId: string,
    entitlementId: string,
    value: unknown,
    reason: string,
    context: PlatformContext,
    options: { expiresAt?: string; ticketRef?: string } = {}
  ): TenantEntitlementRecord {
    const tenant = db.findTenantById(tenantId);
    if (!tenant) throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    const problem = entitlementValueError(entitlementId, value);
    if (problem) throw new AppError("ENTITLEMENT_REJECTED", problem, 400, { entitlement_id: entitlementId });
    // HIGH: permission, step-up, reason and ticket, enforced here rather than only asked for by the console
    PrivilegedActionGate.assert(context, "entitlement.override", {
      reason,
      ticketRef: options.ticketRef,
      payload: { tenant: tenantId, entitlement_id: entitlementId, value: value as EntitlementValue },
    });
    if (options.expiresAt !== undefined) {
      const at = Date.parse(options.expiresAt);
      if (Number.isNaN(at) || at <= Date.now()) {
        throw new AppError("INVALID_EXPIRY", "The override expiry must be a future date and time.", 400);
      }
    }

    const beforeState = db.findTenantEntitlement(tenantId, entitlementId);
    const record: TenantEntitlementRecord = {
      tenant_id: tenantId,
      entitlement_id: entitlementId,
      value,
      is_override: true,
      override_reason: reason.trim(),
      ...(options.expiresAt ? { expires_at: new Date(options.expiresAt).toISOString() } : {}),
      ...(options.ticketRef ? { ticket_ref: options.ticketRef } : {}),
      granted_by: context.platformUser.id,
      updated_at: new Date().toISOString(),
    };

    db.saveTenantEntitlement(record);

    PlatformAuditService.record(
      {
        action: "entitlement.override",
        resource_type: "tenant_entitlement",
        resource_id: `${tenantId}:${entitlementId}`,
        target_tenant_id: tenantId,
        reason: reason.trim(),
        before_state: beforeState ? { value: beforeState.value, is_override: beforeState.is_override, expires_at: beforeState.expires_at } : null,
        after_state: { value, expires_at: record.expires_at ?? null, ticket_ref: record.ticket_ref ?? null },
        result: "SUCCESS",
      },
      context
    );

    return record;
  }

  /** Removes a tenant override so the plan (or default) applies again (MEDIUM). */
  public static clearTenantOverride(
    tenantId: string,
    entitlementId: string,
    reason: string,
    context: PlatformContext
  ): TenantEntitlementRecord {
    PrivilegedActionGate.assert(context, "entitlement.clear_override", { reason, payload: { tenant: tenantId, entitlement_id: entitlementId } });
    const existing = db.findTenantEntitlement(tenantId, entitlementId);
    if (!existing || !existing.is_override) throw new NotFoundError("This tenant has no override for that entitlement.");

    const record: TenantEntitlementRecord = { ...existing, is_override: false, updated_at: new Date().toISOString() };
    db.saveTenantEntitlement(record);

    PlatformAuditService.record(
      {
        action: "entitlement.override_cleared",
        resource_type: "tenant_entitlement",
        resource_id: `${tenantId}:${entitlementId}`,
        target_tenant_id: tenantId,
        reason: reason.trim(),
        before_state: { value: existing.value, expires_at: existing.expires_at ?? null },
        after_state: { is_override: false },
        result: "SUCCESS",
      },
      context
    );
    return record;
  }

  /** The catalog with each entry's global default, for the console. */
  public static listEntitlements(context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "entitlement.read");
    return ENTITLEMENT_CATALOG.map((spec) => {
      const stored = db.findEntitlementById(spec.id);
      return {
        ...spec,
        enforced: spec.enforcedBy !== null,
        default_value: stored ? stored.default_value : null,
        has_default: Boolean(stored),
      };
    });
  }

  /** Every catalog entitlement for one tenant: the value in force, its source, usage and any override. */
  public static async getTenantEntitlementReport(tenantId: string, context: PlatformContext): Promise<TenantEntitlementReport> {
    PlatformAuthorizationService.assertCan(context, "entitlement.read");
    if (!db.findTenantById(tenantId)) throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    return this.buildReport(tenantId);
  }

  /** The report without an authorization check, for system services that already checked their caller. */
  public static async buildReport(tenantId: string, now: number = Date.now()): Promise<TenantEntitlementReport> {
    const plan = this.planApplicability(tenantId, now);
    const features = plan.version?.features ?? {};

    const entitlements = await Promise.all(
      ENTITLEMENT_CATALOG.map(async (spec): Promise<EffectiveEntitlement> => {
        const resolved = this.resolve(tenantId, spec.id, now);
        const enforced = spec.enforcedBy !== null;
        const usage = enforced && spec.kind !== "FEATURE" ? await this.measureUsage(tenantId, spec.id) : null;
        const stored = db.findTenantEntitlement(tenantId, spec.id);
        const defaultEnt = db.findEntitlementById(spec.id);
        return {
          id: spec.id,
          label: spec.label,
          description: spec.description,
          kind: spec.kind,
          unit: spec.unit,
          enforced,
          enforced_by: spec.enforcedBy,
          value: resolved.value,
          source: resolved.source,
          addon_increment: resolved.addon_increment,
          usage,
          usage_ratio: usage !== null && typeof resolved.value === "number" && resolved.value > 0 ? usage / resolved.value : null,
          override:
            stored && stored.is_override
              ? {
                  value: stored.value,
                  reason: stored.override_reason,
                  expires_at: stored.expires_at,
                  granted_by: stored.granted_by,
                  ticket_ref: stored.ticket_ref,
                  expired: Boolean(stored.expires_at && Date.parse(stored.expires_at) <= now),
                }
              : null,
          plan_value: Object.hasOwn(features, spec.id) ? features[spec.id] : null,
          default_value: defaultEnt ? defaultEnt.default_value : null,
        };
      })
    );

    return {
      tenant_id: tenantId,
      plan: {
        plan_id: plan.subscription?.plan_id ?? null,
        plan_version_id: plan.version?.id ?? null,
        version: plan.version?.version ?? null,
        subscription_status: plan.subscription?.status ?? null,
        applies: plan.applies,
        reason: plan.reason,
      },
      entitlements,
      unknown_plan_keys: Object.keys(features).filter((k) => !findEntitlementSpec(k)),
    };
  }
}
