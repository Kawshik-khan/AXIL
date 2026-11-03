import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { WorkspaceMfaService } from "@/domains/auth/workspace-mfa.service";
import { db } from "@/infrastructure/db";
import { PERMISSIONS } from "@/lib/permissions";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";
import { requireStepUp } from "@/lib/step-up";
import { withStore } from "@/lib/store-unit";

const Body = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/**
 * An owner removes a team member's authenticator (lost phone, no recovery codes left): the member is signed out
 * everywhere and sets one up again (Stage 1 security review: "no admin reset").
 *
 * - Owners only, never on themselves (their own recovery codes are for that), with a reason, and with a fresh
 *   authenticator code of their own once step-up is enforced.
 * - The authenticator belongs to the account, which can be in several workspaces. An owner of this workspace must not
 *   weaken the account's protection in another one, so a member who also belongs elsewhere is refused (409).
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
    const elsewhere = db.findMembershipsByUserId(targetUserId).some((m) => m.tenant_id !== context.tenant.id);
    if (elsewhere) {
      throw new ConflictError("This person also belongs to another workspace, so their authenticator can't be reset from here. Contact support.");
    }
    if (!WorkspaceMfaService.isEnrolled(targetUserId)) {
      throw new ConflictError("This member has no authenticator set up.");
    }
    requireStepUp(context, "RESET_MEMBER_MFA");

    WorkspaceMfaService.reset(targetUserId);
    AuditService.log({
      tenantId: context.tenant.id,
      actorUserId: context.user.id,
      action: "MFA_RESET_BY_OWNER",
      resourceType: "user",
      resourceId: targetUserId,
      metadata: { reason, step_up: Boolean(context.stepUpVerified) },
    });
    return apiSuccess({ user_id: targetUserId, mfa_enabled: false, signed_out: true });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
