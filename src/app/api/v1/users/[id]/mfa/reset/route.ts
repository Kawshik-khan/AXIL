import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { WorkspaceMfaService } from "@/domains/auth/workspace-mfa.service";
import { db } from "@/infrastructure/db";
import { PERMISSIONS } from "@/lib/permissions";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { requireStepUpAlways } from "@/lib/step-up";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ reason: z.string().trim().min(10).max(300) }).strict(); // privileged actions: a real reason

/**
 * An owner removes a team member's authenticator (lost phone, no recovery codes left): the member is signed out
 * everywhere and sets one up again (Stage 1 security review: "no admin reset").
 *
 * - Owners only, never on themselves (their own recovery codes are for that), with a reason, and always with a fresh
 *   authenticator code of their own (no grace period: a stolen owner session alone can't sign every member out).
 * - The authenticator belongs to the account, which can be in several workspaces or be a platform operator's. An owner
 *   of this workspace must not weaken it anywhere else, so such members are refused, with one neutral message that
 *   doesn't say why (no hint about memberships elsewhere).
 * - Never through a support session: the operator isn't the owner.
 */
async function handlePOST(request: Request, { params: rawParams }: { params: Promise<{ id: string }> }) {
  const { id: targetUserId } = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.USER_UPDATE);
    if (context.role !== "OWNER" || context.impersonation) {
      throw new ForbiddenError("Only a workspace owner can reset a member's authenticator.");
    }
    const { reason } = parseOrThrow(Body, await readJson(request));
    if (targetUserId === context.user.id) {
      throw new ValidationError("You can't reset your own authenticator here. Use one of your recovery codes instead.");
    }
    if (!db.findMembership(context.tenant.id, targetUserId)) throw new NotFoundError("Team member", targetUserId);
    await requireStepUpAlways(context, "RESET_MEMBER_MFA");
    const elsewhere =
      db.findMembershipsByUserId(targetUserId).some((m) => m.tenant_id !== context.tenant.id) ||
      Boolean(db.findPlatformMembershipByUserId(targetUserId));
    if (elsewhere || !WorkspaceMfaService.isEnrolled(targetUserId)) {
      throw new ConflictError("This member's authenticator can't be reset from here. Contact support.");
    }

    const before = db.findUserById(targetUserId);
    const codesLeftBefore = WorkspaceMfaService.recoveryCodesLeft(targetUserId);
    WorkspaceMfaService.reset(targetUserId);
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "MFA_RESET_BY_OWNER",
      resourceType: "user",
      resourceId: targetUserId,
      metadata: { reason, enrolled_at: before?.mfa_enrolled_at ?? null, recovery_codes_left: codesLeftBefore },
    });
    return apiSuccess({ user_id: targetUserId, mfa_enabled: false, signed_out: true });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
