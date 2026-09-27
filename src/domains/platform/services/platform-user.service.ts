import { db } from "@/infrastructure/db";
import { PlatformMembershipRecord } from "@/types/platform";
import { PlatformContext, PlatformRole } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { AppError, NotFoundError } from "@/lib/errors";
import crypto from "crypto";

export class PlatformUserService {
  /**
   * Lists all platform operators with their roles and status.
   * Invariant: Never returns password hashes or credentials.
   */
  public static listPlatformUsers(context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "platform.read");

    const memberships = db.getPlatformMemberships();
    return memberships.map((pm) => {
      const user = db.findUserById(pm.user_id);
      return {
        id: pm.id,
        user_id: pm.user_id,
        name: user?.name || "Unknown",
        email: user?.email || "Unknown",
        role: pm.role,
        mfa_enabled: pm.mfa_enabled,
        is_active: pm.is_active,
        status: user?.status || "UNKNOWN",
        created_at: pm.created_at,
        updated_at: pm.updated_at,
      };
    });
  }

  /**
   * Grants platform operator membership to an authenticated user.
   */
  public static assignPlatformRole(
    input: { userId: string; role: PlatformRole; reason: string },
    context: PlatformContext
  ): PlatformMembershipRecord {
    PlatformAuthorizationService.assertCan(context, "security.manage");
    PlatformAuthorizationService.assertStepUp(context, "security.manage");

    const user = db.findUserById(input.userId);
    if (!user) throw new NotFoundError(`User "${input.userId}" not found.`);

    const existing = db.findPlatformMembershipByUserId(input.userId);
    const now = new Date().toISOString();

    // Keep everything the operator already has (notably the enrolled TOTP secret and last used step); only the role
    // and active flag change. Rebuilding the record used to silently switch MFA off (Phase 1 security review).
    const membership: PlatformMembershipRecord = existing
      ? { ...existing, role: input.role, is_active: true, updated_at: now }
      : {
          id: `pm_${crypto.randomUUID().substring(0, 10)}`,
          user_id: user.id,
          role: input.role,
          mfa_enabled: false, // only TOTP enrollment turns MFA on (FX-15)
          is_active: true,
          created_at: now,
          updated_at: now,
        };

    db.savePlatformMembership(membership);

    PlatformAuditService.record(
      {
        action: "platform_user.assign_role",
        resource_type: "platform_membership",
        resource_id: membership.id,
        reason: input.reason || `Assigned platform role ${input.role}`,
        before_state: existing ? { role: existing.role } : null,
        after_state: { role: input.role, user_email: user.email },
        result: "SUCCESS",
      },
      context
    );

    return membership;
  }

  /**
   * Inspects staff members of a specific tenant.
   * Invariant: Never displays passwords.
   */
  public static inspectTenantStaff(tenantId: string, context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "tenant.users.read");

    const memberships = db.findMembershipsByTenantId(tenantId);
    return memberships.map((m) => {
      const user = db.findUserById(m.user_id);
      return {
        membership_id: m.id,
        user_id: m.user_id,
        tenant_id: m.tenant_id,
        name: user?.name || "Unknown",
        email: user?.email || "Unknown",
        role: m.role,
        status: user?.status || "UNKNOWN",
        created_at: m.created_at,
        updated_at: m.updated_at,
      };
    });
  }
}
