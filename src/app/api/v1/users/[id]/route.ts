import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { PERMISSIONS, RoleName } from "@/lib/permissions";
import { NotFoundError, ValidationError, ForbiddenError } from "@/lib/errors";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.USER_UPDATE);

    const targetUserId = params.id;
    const body = await request.json();

    // Verify target user is a member of this tenant
    const membership = db.findMembership(context.tenant.id, targetUserId);
    if (!membership) {
      throw new NotFoundError("Team member", targetUserId);
    }

    // Role update
    if (body.role) {
      RbacService.assertCan(context, PERMISSIONS.ROLE_MANAGE);
      const newRole = body.role as RoleName;

      // Prevent non-owners from modifying owner roles
      if (membership.role === "OWNER" && context.role !== "OWNER") {
        throw new ForbiddenError("Only workspace owners can alter owner privileges.");
      }

      db.updateMembershipRole(context.tenant.id, targetUserId, newRole);

      AuditService.log({
        tenantId: context.tenant.id,
        actorUserId: context.user.id,
        action: "USER_ROLE_UPDATED",
        resourceType: "membership",
        resourceId: targetUserId,
        metadata: { old_role: membership.role, new_role: newRole },
      });
    }

    // Status update (ACTIVE, SUSPENDED, DEACTIVATED)
    if (body.status) {
      if (targetUserId === context.user.id) {
        throw new ValidationError("You cannot suspend or deactivate your own account.");
      }

      db.updateUser(targetUserId, { status: body.status });

      AuditService.log({
        tenantId: context.tenant.id,
        actorUserId: context.user.id,
        action: "USER_STATUS_UPDATED",
        resourceType: "user",
        resourceId: targetUserId,
        metadata: { new_status: body.status },
      });
    }

    return apiSuccess({ message: "User updated successfully." });
  } catch (err) {
    return apiError(err);
  }
}
