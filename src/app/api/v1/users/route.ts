import { z } from "zod";
import { parseOrThrow, readJson } from "@/lib/validation";
import { ASSIGNABLE_ROLES } from "@/lib/permissions";
import { ForbiddenError } from "@/lib/errors";

const InviteBody = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(ASSIGNABLE_ROLES).default("SALES"),
  })
  .strict();

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
          membership_status: m.status ?? "ACTIVE",
          account_status: user.status,
          role: m.role,
          last_login_at: user.last_login_at,
          joined_at: m.created_at,
        };
      })
      .filter(Boolean);

    // Also fetch pending invitations for this tenant
    const pendingInvitations = InvitationService.getInvitationsForTenant(context.tenant.id)
      .filter((i) => i.status === "PENDING")
      .map(InvitationService.toPublic); // never the token (FX-37)

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

    const body = parseOrThrow(InviteBody, await readJson(request));
    // Only an OWNER can invite another OWNER (the same rule as PATCH /users/[id]); otherwise an ADMIN could invite a
    // second address they control as OWNER and accept it (Phase 1 security review).
    if (body.role === "OWNER" && context.role !== "OWNER") {
      throw new ForbiddenError("Only workspace owners can invite an owner.");
    }
    const invitation = InvitationService.createInvitation(context.tenant.id, body.email, body.role, context.user.id);

    // The accept link is shown once, to the person who created it (no email delivery yet)
    return apiSuccess(
      { invitation: InvitationService.toPublic(invitation), invite_path: InvitationService.acceptPath(invitation) },
      undefined,
      201
    );
  } catch (err) {
    return apiError(err);
  }
}
