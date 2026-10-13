/**
 * Add-ons (super-admin console plan C3): increments to one enforced, add-on-eligible entitlement. Until the billing
 * engine exists, operators grant them as COMPLIMENTARY only (decision D10); a grant is active between starts_at and
 * ends_at unless revoked, derived on read.
 */
import { db } from "@/infrastructure/db";
import type { PlatformAddonRecord, TenantAddonRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { AppError, NotFoundError } from "@/lib/errors";
import { randomSuffix } from "@/lib/ids";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { PrivilegedActionGate } from "./privileged-action-gate";
import { findEntitlementSpec } from "../entitlement-catalog";

export interface AddonView extends PlatformAddonRecord {
  entitlement_label: string;
  unit?: string;
  active_grants: number;
}

export interface TenantAddonView extends TenantAddonRecord {
  addon_name: string | null;
  entitlement_id: string | null;
  increment_total: number;
  active: boolean;
}

function isActive(grant: TenantAddonRecord, now: number): boolean {
  if (grant.revoked_at || Date.parse(grant.starts_at) > now) return false;
  return !grant.ends_at || Date.parse(grant.ends_at) > now;
}

export class PlatformAddonService {
  public static list(context: PlatformContext, now: number = Date.now()): AddonView[] {
    PlatformAuthorizationService.assertCan(context, "plan.read");
    const grants = db.data.tenant_addons || [];
    return db.getPlatformAddons().map((a) => {
      const spec = findEntitlementSpec(a.entitlement_id);
      return {
        ...a,
        entitlement_label: spec?.label ?? a.entitlement_id,
        unit: spec?.unit,
        active_grants: grants.filter((g) => g.addon_id === a.id && isActive(g, now)).length,
      };
    });
  }

  public static create(
    context: PlatformContext,
    input: { name: string; description: string; entitlement_id: string; increment: number; allowed_plan_ids: string[]; reason: string }
  ): PlatformAddonRecord {
    PrivilegedActionGate.assert(context, "addon.create", { reason: input.reason, payload: { entitlement_id: input.entitlement_id } });
    const spec = findEntitlementSpec(input.entitlement_id);
    if (!spec || !spec.enforcedBy) throw new AppError("ENTITLEMENT_NOT_ENFORCED", "Add-ons can only raise an enforced limit.", 400);
    if (!spec.addonEligible || spec.kind === "FEATURE") throw new AppError("NOT_ADDON_ELIGIBLE", `"${spec.label}" can't be raised by an add-on.`, 400);
    if (!Number.isInteger(input.increment) || input.increment < 1) throw new AppError("INVALID_INCREMENT", "The increment must be a whole number of 1 or more.", 400);
    const unknownPlans = input.allowed_plan_ids.filter((p) => !db.findPlanById(p));
    if (unknownPlans.length) throw new AppError("UNKNOWN_PLANS", `Unknown plans: ${unknownPlans.join(", ")}`, 400);

    const now = new Date().toISOString();
    const addon: PlatformAddonRecord = {
      id: `addon_${randomSuffix()}`,
      name: input.name.trim(),
      description: input.description.trim(),
      entitlement_id: spec.id,
      increment: input.increment,
      monthly_price_bdt: null,
      status: "ACTIVE",
      allowed_plan_ids: input.allowed_plan_ids,
      created_by: context.platformUser.id,
      created_at: now,
      updated_at: now,
    };
    db.savePlatformAddon(addon);
    PlatformAuditService.record(
      { action: "addon.create", resource_type: "platform_addon", resource_id: addon.id, reason: input.reason.trim(), after_state: { ...addon }, result: "SUCCESS" },
      context
    );
    return addon;
  }

  /** Stops new grants; existing grants keep applying until they end or are revoked. */
  public static retire(context: PlatformContext, addonId: string, reason: string): PlatformAddonRecord {
    PrivilegedActionGate.assert(context, "addon.retire", { reason, payload: { addon_id: addonId } });
    const addon = db.findPlatformAddon(addonId);
    if (!addon) throw new NotFoundError("Add-on not found.");
    if (addon.status === "RETIRED") throw new AppError("ADDON_RETIRED", "This add-on is already retired.", 409);
    const updated: PlatformAddonRecord = { ...addon, status: "RETIRED", updated_at: new Date().toISOString() };
    db.savePlatformAddon(updated);
    PlatformAuditService.record(
      { action: "addon.retire", resource_type: "platform_addon", resource_id: addonId, reason: reason.trim(), before_state: { status: addon.status }, after_state: { status: "RETIRED" }, result: "SUCCESS" },
      context
    );
    return updated;
  }

  public static listForTenant(context: PlatformContext, tenantId: string, now: number = Date.now()): TenantAddonView[] {
    PlatformAuthorizationService.assertCan(context, "entitlement.read");
    if (!db.findTenantById(tenantId)) throw new NotFoundError("Tenant not found.");
    return db.getTenantAddons(tenantId).map((g) => {
      const addon = db.findPlatformAddon(g.addon_id);
      return {
        ...g,
        addon_name: addon?.name ?? null,
        entitlement_id: addon?.entitlement_id ?? null,
        increment_total: addon ? addon.increment * g.quantity : 0,
        active: isActive(g, now),
      };
    });
  }

  /** Grants an add-on to a tenant as COMPLIMENTARY (PURCHASED arrives with the billing engine). */
  public static grant(
    context: PlatformContext,
    tenantId: string,
    input: { addon_id: string; quantity: number; starts_at?: string; ends_at?: string; reason: string; ticket_ref?: string }
  ): TenantAddonRecord {
    PrivilegedActionGate.assert(context, "addon.grant", {
      reason: input.reason,
      ticketRef: input.ticket_ref,
      payload: { tenant: tenantId, addon_id: input.addon_id, quantity: input.quantity },
    });
    const tenant = db.findTenantById(tenantId);
    if (!tenant) throw new NotFoundError("Tenant not found.");
    const addon = db.findPlatformAddon(input.addon_id);
    if (!addon) throw new NotFoundError("Add-on not found.");
    if (addon.status !== "ACTIVE") throw new AppError("ADDON_RETIRED", "A retired add-on can't be granted.", 409);
    if (addon.allowed_plan_ids.length > 0) {
      const sub = db.findSubscriptionByTenantId(tenantId);
      if (!sub || !addon.allowed_plan_ids.includes(sub.plan_id)) {
        throw new AppError("ADDON_NOT_ALLOWED", "This add-on isn't available on the tenant's plan.", 409);
      }
    }
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10_000) {
      throw new AppError("INVALID_QUANTITY", "Quantity must be a whole number from 1 to 10,000.", 400);
    }
    const now = Date.now();
    const startsAt = input.starts_at ? Date.parse(input.starts_at) : now;
    const endsAt = input.ends_at ? Date.parse(input.ends_at) : undefined;
    if (Number.isNaN(startsAt) || (endsAt !== undefined && (Number.isNaN(endsAt) || endsAt <= Math.max(startsAt, now)))) {
      throw new AppError("INVALID_DATES", "The end must be a valid date after the start and after now.", 400);
    }

    const grant: TenantAddonRecord = {
      id: `tad_${randomSuffix()}`,
      tenant_id: tenantId,
      addon_id: addon.id,
      quantity: input.quantity,
      source: "COMPLIMENTARY",
      starts_at: new Date(startsAt).toISOString(),
      ...(endsAt !== undefined ? { ends_at: new Date(endsAt).toISOString() } : {}),
      granted_by: context.platformUser.id,
      reason: input.reason.trim(),
      ...(input.ticket_ref?.trim() ? { ticket_ref: input.ticket_ref.trim() } : {}),
      created_at: new Date(now).toISOString(),
    };
    db.saveTenantAddon(grant);
    PlatformAuditService.record(
      {
        action: "addon.grant",
        resource_type: "tenant_addon",
        resource_id: grant.id,
        target_tenant_id: tenantId,
        reason: grant.reason,
        after_state: { addon_id: addon.id, entitlement_id: addon.entitlement_id, increment_total: addon.increment * grant.quantity, starts_at: grant.starts_at, ends_at: grant.ends_at ?? null },
        result: "SUCCESS",
      },
      context
    );
    return grant;
  }

  public static revoke(context: PlatformContext, tenantId: string, grantId: string, reason: string): TenantAddonRecord {
    PrivilegedActionGate.assert(context, "addon.revoke", { reason, payload: { tenant: tenantId, grant_id: grantId } });
    const grant = db.findTenantAddon(tenantId, grantId);
    if (!grant) throw new NotFoundError("Add-on grant not found.");
    if (grant.revoked_at) throw new AppError("ALREADY_REVOKED", "This grant is already revoked.", 409);
    const updated: TenantAddonRecord = { ...grant, revoked_at: new Date().toISOString(), revoked_by: context.platformUser.id };
    db.saveTenantAddon(updated);
    PlatformAuditService.record(
      {
        action: "addon.revoke",
        resource_type: "tenant_addon",
        resource_id: grantId,
        target_tenant_id: tenantId,
        reason: reason.trim(),
        before_state: { revoked_at: null },
        after_state: { revoked_at: updated.revoked_at },
        result: "SUCCESS",
      },
      context
    );
    return updated;
  }
}
