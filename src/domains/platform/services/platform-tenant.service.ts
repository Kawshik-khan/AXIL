import { db, TenantRecord, UserRecord, MembershipRecord } from "@/infrastructure/db";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { DISABLED_PASSWORD_HASH } from "@/lib/security";
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
}

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
        name: u?.name || "Unknown",
        email: u?.email || "Unknown",
        status: u?.status || "UNKNOWN",
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
    PlatformAuthorizationService.assertCan(context, "tenant.create");

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

    // 4. Create Initial Subscription
    const plan = db.findPlanById(input.plan_id) || db.getPlans()[0];
    const planVersion = db.getPlanVersions(plan.id)[0] || { id: "pv_default_v1" };
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    db.saveSubscription({
      id: `sub_${crypto.randomUUID().substring(0, 12)}`,
      tenant_id: tenantId,
      plan_id: plan.id,
      plan_version_id: planVersion.id,
      status: "ACTIVE",
      current_period_start: now,
      current_period_end: nextMonth,
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

    return {
      tenant: newTenant,
      owner: { id: owner.id, email: owner.email, name: owner.name },
      owner_setup_required: ownerSetupRequired,
      plan: { id: plan.id, name: plan.name },
    };
  }

  /**
   * Suspends a tenant with mandatory reason, policy validation, and audit recording.
   */
  public static suspendTenant(tenantId: string, reason: string, context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "tenant.suspend");
    PlatformAuthorizationService.assertStepUp(context, "tenant.suspend");

    if (!reason || reason.trim().length < 5) {
      throw new AppError("REASON_REQUIRED", "Suspension requires a descriptive operational reason (min 5 chars).", 400);
    }

    const tenant = db.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    }

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
    PlatformAuthorizationService.assertCan(context, "tenant.activate");

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
        reason: reason || "Reactivated via Platform Control Plane",
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
  public static archiveTenant(tenantId: string, reason: string, context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "tenant.delete");
    PlatformAuthorizationService.assertStepUp(context, "tenant.delete");

    const tenant = db.findTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant "${tenantId}" not found.`);
    }

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
        reason: reason || "Archived for compliance / deletion grace period",
        before_state: beforeState,
        after_state: { status: "ARCHIVED", archived_at: now },
        result: "SUCCESS",
      },
      context
    );

    return updated;
  }
}
