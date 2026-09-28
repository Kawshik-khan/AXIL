import { db } from "@/infrastructure/db";
import { ImpersonationSessionRecord } from "@/types/platform";
import { PlatformContext } from "@/lib/context";
import { PlatformAuthorizationService } from "./platform-authorization.service";
import { PlatformAuditService } from "./platform-audit.service";
import { signImpersonationToken } from "@/lib/security";
import {
  AppError,
  NotFoundError,
  ImpersonationNotAllowedError,
  ImpersonationExpiredError,
} from "@/lib/errors";
import crypto from "crypto";

export interface RequestImpersonationInput {
  targetTenantId: string;
  targetUserId: string;
  reason: string;
  ticketReference?: string;
  mode?: "READ_ONLY" | "MUTATION_APPROVED";
  durationMinutes?: number;
}

export class PlatformSupportService {
  /**
   * Authoritatively starts a governed support impersonation session.
   * Enforces: Step-Up verification, target existence, short TTL, and audit trail.
   */
  public static async startImpersonationSession(
    input: RequestImpersonationInput,
    context: PlatformContext
  ): Promise<{ session: ImpersonationSessionRecord; token: string }> {
    PlatformAuthorizationService.assertCan(context, "support.impersonate");
    PlatformAuthorizationService.assertStepUp(context, "support.impersonate");

    if (!input.reason || input.reason.trim().length < 10) {
      throw new AppError(
        "REASON_REQUIRED",
        "Support impersonation requires a descriptive customer ticket or operational reason (min 10 chars).",
        400
      );
    }

    const tenant = db.findTenantById(input.targetTenantId);
    if (!tenant) throw new NotFoundError(`Target tenant "${input.targetTenantId}" not found.`);

    const user = db.findUserById(input.targetUserId);
    if (!user) throw new NotFoundError(`Target user "${input.targetUserId}" not found.`);

    // Target user must belong to target tenant
    const membership = db.findMembership(input.targetTenantId, input.targetUserId);
    if (!membership) {
      throw new ImpersonationNotAllowedError(
        `Target user "${user.email}" does not hold a membership in tenant "${tenant.name}".`
      );
    }

    // Invariant: Cannot impersonate other platform administrators via tenant impersonation!
    const targetIsPlatformAdmin = db.findPlatformMembershipByUserId(user.id);
    if (targetIsPlatformAdmin && targetIsPlatformAdmin.role === "SUPER_ADMIN") {
      throw new ImpersonationNotAllowedError("Security violation: Cannot impersonate another Super Admin.");
    }

    const duration = Math.min(Math.max(input.durationMinutes || 30, 5), 120); // between 5 and 120 minutes max
    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration * 60 * 1000).toISOString();
    const sessionId = `imp_${crypto.randomUUID().substring(0, 12)}`;
    const mode = input.mode || "READ_ONLY";

    const session: ImpersonationSessionRecord = {
      id: sessionId,
      operator_user_id: context.platformUser.id,
      target_tenant_id: tenant.id,
      target_user_id: user.id,
      reason: input.reason,
      ticket_reference: input.ticketReference,
      mode,
      step_up_verified_at: now.toISOString(),
      expires_at: expiresAt,
      created_at: now.toISOString(),
    };

    db.saveImpersonationSession(session);

    // Generate signed JWT token carrying dual-actor context
    const token = await signImpersonationToken(
      {
        sessionId,
        operatorUserId: context.platformUser.id,
        targetTenantId: tenant.id,
        targetUserId: user.id,
        mode,
        expiresAt,
      },
      `${duration}m`
    );

    PlatformAuditService.record(
      {
        action: "support.impersonate_start",
        resource_type: "impersonation_session",
        resource_id: sessionId,
        target_tenant_id: tenant.id,
        reason: input.reason,
        impersonation_session_id: sessionId,
        after_state: {
          operator_user_id: context.platformUser.id,
          target_user_id: user.id,
          target_tenant_id: tenant.id,
          mode,
          expires_at: expiresAt,
        },
        result: "SUCCESS",
      },
      context
    );

    return { session, token };
  }

  /**
   * Revokes an active impersonation session immediately.
   */
  public static revokeSession(sessionId: string, reason: string, context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "support.impersonate");

    const session = db.findImpersonationSessionById(sessionId);
    if (!session) throw new NotFoundError(`Impersonation session "${sessionId}" not found.`);

    if (session.revoked_at) {
      return session;
    }

    const now = new Date().toISOString();
    session.revoked_at = now;
    session.revoked_by_user_id = context.platformUser.id;

    db.saveImpersonationSession(session);

    PlatformAuditService.record(
      {
        action: "support.impersonate_revoke",
        resource_type: "impersonation_session",
        resource_id: sessionId,
        target_tenant_id: session.target_tenant_id,
        reason: reason || "Impersonation session explicitly revoked by operator",
        impersonation_session_id: sessionId,
        after_state: { revoked_at: now, revoked_by: context.platformUser.id },
        result: "SUCCESS",
      },
      context
    );

    return session;
  }

  /**
   * Lists active or recent impersonation sessions.
   */
  public static listSessions(context: PlatformContext) {
    PlatformAuthorizationService.assertCan(context, "support.read");
    return db.getImpersonationSessions();
  }
}
