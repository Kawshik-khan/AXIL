import { z } from "zod";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { PERMISSIONS } from "@/lib/permissions";
import { NotFoundError, ValidationError, ForbiddenError } from "@/lib/errors";
import { parseOrThrow, readJson } from "@/lib/validation";

const ROLES = ["OWNER", "ADMIN", "DEV", "MANAGER", "SALES", "SUPPORT", "MARKETING", "INVENTORY", "FINANCE", "ANALYST"] as const;

/**
 * Changes a member's role or their access to THIS workspace (FX-12, STATUS N5).
 * `status` suspends or restores the membership only; it never touches the account (users.status), which other
 * workspaces and the platform also rely on.
 */
const MemberPatch = z
  .object({
    role: z.enum(ROLES),
    status: z.enum(["ACTIVE", "SUSPENDED"]),
  })
  .partial()
  .strict()
  .refine((patch) => patch.role !== undefined || patch.status !== undefined, { message: "Nothing to update." });

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.USER_UPDATE);

    const targetUserId = params.id;
    const patch = parseOrThrow(MemberPatch, await readJson(request));

    // Verify target user is a member of this tenant
    const membership = db.findMembership(context.tenant.id, targetUserId);
    if (!membership) {
      throw new NotFoundError("Team member", targetUserId);
    }

    // Owners are managed by owners only: nobody else can change, suspend or create an OWNER.
    if ((membership.role === "OWNER" || patch.role === "OWNER") && context.role !== "OWNER") {
      throw new ForbiddenError("Only workspace owners can grant or change owner access.");
    }

    if (patch.role && patch.role !== membership.role) {
      RbacService.assertCan(context, PERMISSIONS.ROLE_MANAGE);
      db.updateMembershipRole(context.tenant.id, targetUserId, patch.role);

      AuditService.log({
        tenantId: context.tenant.id,
        actorUserId: context.user.id,
        action: "USER_ROLE_UPDATED",
        resourceType: "membership",
        resourceId: targetUserId,
        metadata: { old_role: membership.role, new_role: patch.role },
      });
    }

    if (patch.status) {
      if (targetUserId === context.user.id) {
        throw new ValidationError("You cannot suspend or restore your own access.");
      }

      db.updateMembershipStatus(context.tenant.id, targetUserId, patch.status);

      AuditService.log({
        tenantId: context.tenant.id,
        actorUserId: context.user.id,
        action: "MEMBERSHIP_STATUS_UPDATED",
        resourceType: "membership",
        resourceId: targetUserId,
        metadata: { new_status: patch.status },
      });
    }

    return apiSuccess({ message: "User updated successfully." });
  } catch (err) {
    return apiError(err);
  }
}
