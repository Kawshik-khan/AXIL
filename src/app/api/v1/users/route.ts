import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { RbacService } from "@/domains/rbac/service";
import { InvitationService } from "@/domains/invitations/service";
import { PERMISSIONS } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.USER_READ);

    // Get all memberships for this tenant
    const memberships = db.findMembershipsByTenantId(context.tenant.id);
    const usersWithRoles = memberships
      .map((m) => {
        const user = db.findUserById(m.user_id);
        if (!user) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          // Access to this workspace: a suspended membership, or a suspended/deactivated account, shows as not active.
          status: user.status !== "ACTIVE" ? user.status : m.status ?? "ACTIVE",
          role: m.role,
          last_login_at: user.last_login_at,
          joined_at: m.created_at,
        };
      })
      .filter(Boolean);

    // Also fetch pending invitations for this tenant
    const pendingInvitations = InvitationService.getInvitationsForTenant(context.tenant.id).filter(
      (i) => i.status === "PENDING"
    );

    return apiSuccess({
      users: usersWithRoles,
      pending_invitations: pendingInvitations,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.USER_INVITE);

    const body = await request.json();
    const invitation = InvitationService.createInvitation(
      context.tenant.id,
      body.email,
      body.role || "SALES",
      context.user.id
    );

    return apiSuccess({ invitation }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
