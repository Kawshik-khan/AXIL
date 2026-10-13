import { db, TenantRecord, UserRecord, MembershipRecord } from "@/infrastructure/db";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { PrivilegedActionGate } from "./privileged-action-gate";
import { PlatformSettingsService } from "./platform-settings.service";
import { latestPublished, monthlyPrice } from "../plan-pricing";
import { DISABLED_PASSWORD_HASH } from "@/lib/security";
import { InvitationService } from "@/domains/invitations/service";
import {
  AppError,
  TenantStateInvalidError,
  NotFoundError,
} from "@/lib/errors";
import crypto from "crypto";

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  legal_name?: string;
  plan_id: string;
  owner_email: string;
  owner_name: string;
  currency?: string;
  timezone?: string;
  country?: string;
  /** Start on a trial of the plan instead of an active subscription. */
  start_trial?: boolean;
}

/** Options for HIGH tenant actions: the ticket the rules require, and an approval when one applies. */
export interface TenantActionOptions {
  ticketRef?: string;
  approvalId?: string;
}

/** Minimum days an archived tenant's data is kept after a purge is approved (rules/privileged-actions.md §3.5). */
export const PURGE_TOMBSTONE_DAYS = 14;

export interface TenantFilterParams {
  search?: string;
  status?: string;
  plan_id?: string;
  limit?: number;
  offset?: number;
}

export class PlatformTenantService {
  /**
   * Retrieves a paginated list of tenants with filters.
   */
  public static listTenants(params: TenantFilterParams = {}, context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "tenant.read");

    let tenants = db.getTenants();

    if (params.search) {
      const q = params.search.toLowerCase();
      tenants = tenants.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          (t.legal_name && t.legal_name.toLowerCase().includes(q))
      );
    }

    if (params.status) {
      tenants = tenants.filter((t) => t.status === params.status);
    }

    if (params.plan_id) {
      tenants = tenants.filter((t) => t.plan_id === params.plan_id);
    }

    const total = tenants.length;
    const offset = params.offset || 0;
    const limit = params.limit || 50;
    const paginated = tenants.slice(offset, offset + limit);

    // Attach high-level subscription, user count and automation usage metadata without leaking business data
    const enriched = paginated.map((tenant) => {
      const sub = db.findSubscriptionByTenantId(tenant.id);
      const userCount = db.findMembershipsByTenantId(tenant.id).length;
      const automationsCount = (db.data.automations || []).filter((a) => a.tenant_id === tenant.id).length;
      return {
        ...tenant,
        subscription: sub ? { plan_id: sub.plan_id, status: sub.status, current_period_end: sub.current_period_end } : null,
        metrics: {
          user_count: userCount,
          automation_count: automationsCount,
        },
      };
    });

    return { tenants: enriched, total };
  }

  /**
   * Retrieves tenant operational detail and health telemetry.
   */
  public static getTenantDetail(tenantId: string, context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "tenant.read");

    const tenant = db.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with id "${tenantId}" not found.`);
    }

    const subscription = db.findSubscriptionByTenantId(tenantId);
    const plan = subscription ? db.findPlanById(subscription.plan_id) : null;
    const planVersion = subscription ? db.findPlanVersionById(subscription.plan_version_id) : null;
    const entitlements = db.getTenantEntitlements(tenantId);
    const memberships = db.findMembershipsByTenantId(tenantId);
    const users = memberships.map((m) => {
      const u = db.findUserById(m.user_id);
      return {
        membership_id: m.id,
        user_id: m.user_id,
        role: m.role,
        name: u?.name ?? null,
        email: u?.email ?? null,
        status: u?.status ?? null,
        created_at: m.created_at,
      };
    });

    const automations = (db.data.automations || []).filter((a) => a.tenant_id === tenantId);
    const executions = (db.data.automation_executions || []).filter((e) => e.tenant_id === tenantId);
    const deadLetters = (db.data.automation_dead_letters || []).filter((d) => d.tenant_id === tenantId);

    return {
      tenant,
      subscription: subscription ? { ...subscription, plan_name: plan?.name, plan_version: planVersion?.version } : null,
      entitlements,
      staff: users,
      automation_telemetry: {
        total_automations: automations.length,
        recent_executions: executions.slice(0, 10),
        dead_letter_count: deadLetters.length,
      },
    };
  }

  /**
   * Idempotently provisions a brand new tenant with initial owner and subscription.
   */
  public static provisionTenant(input: ProvisionTenantInput, context: PlatformContext) {
    PrivilegedActionGate.assert(context, "tenant.create", { payload: { slug: input.slug } });

    // The plan must have a published version: never subscribe to a missing or draft one
    const plan = db.findPlanById(input.plan_id);
    if (!plan) throw new NotFoundError(`Plan "${input.plan_id}" not found.`);
    const planVersion = latestPublished(db.getPlanVersions(plan.id));
    if (!planVersion) throw new AppError("PLAN_NOT_PUBLISHED", `Plan "${plan.name}" has no published version.`, 409);

    // Check slug uniqueness
    const existing = db.findTenantBySlug(input.slug);
    if (existing) {
      throw new AppError("TENANT_SLUG_CONFLICT", `Tenant slug "${input.slug}" is already in use.`, 409);
    }

    const now = new Date().toISOString();
    const tenantId = `ten_${crypto.randomUUID().substring(0, 12)}`;

    // 1. Create Tenant in PROVISIONING state
    const newTenant: TenantRecord = {
      id: tenantId,
      name: input.name,
      slug: input.slug,
      legal_name: input.legal_name,
      currency: input.currency || "BDT",
      timezone: input.timezone || "Asia/Dhaka",
      language: "en",
      country: input.country || "BD",
      settings: {
        allow_overselling: false,
        delivery_charge_inside_dhaka: 60,
        delivery_charge_outside_dhaka: 120,
      },
      status: "ACTIVE", // transitions to active once provisioned
      plan_id: input.plan_id,
      billing_status: "ACTIVE",
      created_at: now,
      updated_at: now,
    };
    db.createTenant(newTenant);
    db.ensureDefaultWarehouse(tenantId); // FX-36 M11

    // 2. Create or associate Initial Owner User.
    // A new owner gets no usable password (audit C1-b): the account stays INVITED until an owner onboarding
    // flow sets a password (FIX_IMPLEMENTATION_PLAN FX-37). Previously it shared a hard-coded demo hash.
    let owner = db.findUserByEmail(input.owner_email);
    const ownerSetupRequired = !owner;
    if (!owner) {
      owner = {
        id: `usr_${crypto.randomUUID().substring(0, 12)}`,
        email: input.owner_email,
        name: input.owner_name,
        password_hash: DISABLED_PASSWORD_HASH,
        status: "INVITED",
        created_at: now,
        updated_at: now,
      };
      db.createUser(owner);
    }

    // 3. Create Tenant Owner Membership (TENANT SCOPE ONLY)
    const membership: MembershipRecord = {
      id: `mem_${crypto.randomUUID().substring(0, 12)}`,
      tenant_id: tenantId,
      user_id: owner.id,
      role: "OWNER",
      created_at: now,
      updated_at: now,
    };
    db.createMembership(membership);

    // 4. Create the initial subscription on the plan's latest published version (SA-10), active or as a trial
    const billingPeriod: "MONTHLY" | "ANNUAL" = monthlyPrice(planVersion) !== null ? "MONTHLY" : "ANNUAL";
    const trialDays = input.start_trial
      ? planVersion.trial_days ?? PlatformSettingsService.getEffectiveSetting<number>("billing.trial_default_days")
      : 0;
    const periodStart = new Date(now);
    const periodEndDate = new Date(periodStart);
    if (trialDays > 0) periodEndDate.setDate(periodEndDate.getDate() + trialDays);
    else if (billingPeriod === "ANNUAL") periodEndDate.setFullYear(periodEndDate.getFullYear() + 1);
    else periodEndDate.setMonth(periodEndDate.getMonth() + 1);

    db.saveSubscription({
      id: `sub_${crypto.randomUUID().substring(0, 12)}`,
      tenant_id: tenantId,
      plan_id: plan.id,
      plan_version_id: planVersion.id,
      status: trialDays > 0 ? "TRIAL" : "ACTIVE",
      billing_period: billingPeriod,
      ...(trialDays > 0 ? { trial_ends_at: periodEndDate.toISOString() } : {}),
      current_period_start: now,
      current_period_end: periodEndDate.toISOString(),
      cancel_at_period_end: false,
      created_at: now,
      updated_at: now,
    });

    // 5. Audit tenant creation
    PlatformAuditService.record(
      {
        action: "tenant.create",
        resource_type: "tenant",
        resource_id: tenantId,
        target_tenant_id: tenantId,
        reason: "Provisioned via Platform Control Plane",
        after_state: { name: newTenant.name, slug: newTenant.slug, plan_id: plan.id, owner_email: owner.email },
        result: "SUCCESS",
      },
      context
    );

    // A new owner sets their password through a one-time link, shown once to the operator (audit N8, FX-37)
    const setup = ownerSetupRequired ? InvitationService.createOwnerSetupInvitation(tenantId, owner.email) : null;

    return {
      tenant: newTenant,
      owner: { id: owner.id, email: owner.email, name: owner.name },
      owner_setup_required: ownerSetupRequired,
      owner_setup_path: setup ? InvitationService.acceptPath(setup) : null,
      plan: { id: plan.id, name: plan.name },
    };
  }

  /**
   * Suspends a tenant with mandatory reason, policy validation, and audit recording.
   */
  public static suspendTenant(tenantId: string, reason: string, context: PlatformContext, options: TenantActionOptions = {}) {
    const tenant = db.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    }
    if (tenant.status === "ARCHIVED" || tenant.purge_after) {
      // Suspend → activate would otherwise un-archive a tenant (and leave its purge scheduled)
      throw new TenantStateInvalidError("An archived or purge-scheduled tenant can't be suspended.");
    }
    // HIGH: step-up and a ticket; two-person approval once the tenant is older than 30 days
    PrivilegedActionGate.assert(context, "tenant.suspend", {
      reason,
      ticketRef: options.ticketRef,
      approvalId: options.approvalId,
      payload: { tenant: tenantId },
      facts: { tenantCreatedAt: tenant.created_at },
    });

    if (tenant.status === "SUSPENDED") {
      throw new TenantStateInvalidError(`Tenant "${tenantId}" is already suspended.`);
    }

    const beforeState = { status: tenant.status, suspended_at: tenant.suspended_at };
    const now = new Date().toISOString();

    const updated = db.updateTenant(tenantId, {
      status: "SUSPENDED",
      suspended_at: now,
      suspension_reason: reason,
      updated_at: now,
    });

    PlatformAuditService.record(
      {
        action: "tenant.suspend",
        resource_type: "tenant",
        resource_id: tenantId,
        target_tenant_id: tenantId,
        reason,
        before_state: beforeState,
        after_state: { status: "SUSPENDED", suspension_reason: reason, suspended_at: now },
        result: "SUCCESS",
      },
      context
    );

    return updated;
  }

  /**
   * Activates a suspended or past-due tenant.
   */
  public static activateTenant(tenantId: string, reason: string, context: PlatformContext) {
    PrivilegedActionGate.assert(context, "tenant.activate", { reason, payload: { tenant: tenantId } });

    const tenant = db.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    }

    if (tenant.status === "ACTIVE") {
      throw new TenantStateInvalidError(`Tenant "${tenantId}" is already active.`);
    }

    if (tenant.status === "ARCHIVED") {
      throw new TenantStateInvalidError(`Cannot directly activate an ARCHIVED tenant.`);
    }

    const beforeState = { status: tenant.status, suspension_reason: tenant.suspension_reason };
    const now = new Date().toISOString();

    const updated = db.updateTenant(tenantId, {
      status: "ACTIVE",
      suspension_reason: undefined,
      suspended_at: undefined,
      updated_at: now,
    });

    PlatformAuditService.record(
      {
        action: "tenant.activate",
        resource_type: "tenant",
        resource_id: tenantId,
        target_tenant_id: tenantId,
        reason: reason.trim(),
        before_state: beforeState,
        after_state: { status: "ACTIVE" },
        result: "SUCCESS",
      },
      context
    );

    return updated;
  }

  /**
   * Initiates governed tenant deletion workflow with grace period.
   * Invariant: Permanent hard delete is NEVER immediate.
   */
  public static archiveTenant(tenantId: string, reason: string, context: PlatformContext, options: TenantActionOptions = {}) {
    const tenant = db.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    }
    if (tenant.status === "ARCHIVED") throw new TenantStateInvalidError("The tenant is already archived.");
    // Same approval rule as suspending: archiving also takes the workspace offline
    PrivilegedActionGate.assert(context, "tenant.archive", {
      reason,
      ticketRef: options.ticketRef,
      approvalId: options.approvalId,
      payload: { tenant: tenantId },
      facts: { tenantCreatedAt: tenant.created_at },
    });

    const beforeState = { status: tenant.status };
    const now = new Date().toISOString();

    const updated = db.updateTenant(tenantId, {
      status: "ARCHIVED",
      archived_at: now,
      updated_at: now,
    });

    PlatformAuditService.record(
      {
        action: "tenant.archive",
        resource_type: "tenant",
        resource_id: tenantId,
        target_tenant_id: tenantId,
        reason: reason.trim(),
        before_state: beforeState,
        after_state: { status: "ARCHIVED", archived_at: now },
        result: "SUCCESS",
      },
      context
    );

    return updated;
  }

  /**
   * Schedules a tenant purge (CRITICAL: two-person approval and the typed slug). The tenant is archived and its
   * data kept for the 14-day tombstone (rules/privileged-actions.md §3.5). Nothing deletes data yet: the response
   * says so instead of claiming a purge happened.
   */
  public static schedulePurge(
    tenantId: string,
    input: { reason: string; ticketRef?: string; approvalId?: string; confirmation?: string },
    context: PlatformContext
  ) {
    const tenant = db.findTenantById(tenantId);
    if (!tenant) throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    if (tenant.purge_after) throw new TenantStateInvalidError("A purge is already scheduled for this tenant.");
    PrivilegedActionGate.assert(context, "tenant.purge", {
      reason: input.reason,
      ticketRef: input.ticketRef,
      approvalId: input.approvalId,
      confirmation: input.confirmation,
      confirmTarget: { id: tenant.id, slug: tenant.slug },
      payload: { tenant: tenant.id },
    });

    const now = new Date();
    const purgeAfter = new Date(now.getTime() + PURGE_TOMBSTONE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    db.updateTenant(tenantId, {
      status: "ARCHIVED",
      archived_at: tenant.archived_at ?? now.toISOString(),
      purge_requested_at: now.toISOString(),
      purge_after: purgeAfter,
      updated_at: now.toISOString(),
    });
    PlatformAuditService.record(
      {
        action: "tenant.purge_scheduled",
        resource_type: "tenant",
        resource_id: tenantId,
        target_tenant_id: tenantId,
        reason: input.reason.trim(),
        before_state: { status: tenant.status },
        after_state: { status: "ARCHIVED", purge_after: purgeAfter, data_deleted: false },
        result: "SUCCESS",
      },
      context
    );
    return {
      tenant_id: tenantId,
      status: "PURGE_SCHEDULED" as const,
      purge_after: purgeAfter,
      data_deleted: false,
      note: "The workspace is archived and its data is retained until purge_after. Physical deletion is not implemented yet.",
    };
  }

  /** Cancels a scheduled purge during the tombstone period; the tenant stays archived. */
  public static cancelPurge(tenantId: string, input: { reason: string; ticketRef?: string }, context: PlatformContext) {
    const tenant = db.findTenantById(tenantId);
    if (!tenant) throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    if (!tenant.purge_after) throw new TenantStateInvalidError("No purge is scheduled for this tenant.");
    PrivilegedActionGate.assert(context, "tenant.purge_cancel", { reason: input.reason, ticketRef: input.ticketRef, payload: { tenant: tenantId } });
    db.updateTenant(tenantId, { purge_requested_at: undefined, purge_after: undefined, updated_at: new Date().toISOString() });
    PlatformAuditService.record(
      {
        action: "tenant.purge_cancelled",
        resource_type: "tenant",
        resource_id: tenantId,
        target_tenant_id: tenantId,
        reason: input.reason.trim(),
        before_state: { purge_after: tenant.purge_after },
        after_state: { purge_after: null },
        result: "SUCCESS",
      },
      context
    );
    return { tenant_id: tenantId, status: "ARCHIVED" as const, purge_after: null };
  }
}
