import { randomSuffix } from "@/lib/ids";
import { db, InvitationRecord } from "@/infrastructure/db";
import { ASSIGNABLE_ROLES, RoleName } from "@/lib/permissions";
import { generateSecureToken } from "@/lib/security";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors";
import { AuditService } from "@/domains/audit/service";

export class InvitationService {
  public static createInvitation(
    tenantId: string,
    email: string,
    role: RoleName,
    actorUserId: string
  ): InvitationRecord {
    if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
      throw new ValidationError(`'${role}' is not a role that can be assigned.`);
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      throw new ValidationError("Invalid email address provided.");
    }

    // Check if user is already a member of this tenant
    const existingUser = db.findUserByEmail(normalizedEmail);
    if (existingUser) {
      const existingMembership = db.findMembership(tenantId, existingUser.id);
      if (existingMembership) {
        throw new ConflictError(`User ${normalizedEmail} is already a member of this workspace.`);
      }
    }

    const token = generateSecureToken(48);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    const invitation: InvitationRecord = {
      id: `inv_${randomSuffix()}`,
      tenant_id: tenantId,
      email: normalizedEmail,
      role,
      token,
      status: "PENDING",
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    };

    const created = db.createInvitation(invitation);

    AuditService.log({
      tenantId,
      actorUserId,
      action: "USER_INVITED",
      resourceType: "invitation",
      resourceId: created.id,
      metadata: { email: normalizedEmail, role },
    });

    return created;
  }

  public static getInvitationByToken(token: string): InvitationRecord {
    const inv = db.findInvitationByToken(token);
    if (!inv) {
      throw new NotFoundError("Invitation", token);
    }
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      db.updateInvitationStatus(token, "EXPIRED");
      throw new ValidationError("Invitation token has expired.");
    }
    if (inv.status !== "PENDING") {
      throw new ValidationError(`Invitation has already been ${inv.status.toLowerCase()}.`);
    }
    return inv;
  }

  public static acceptInvitation(token: string, userId: string): { tenantId: string; role: RoleName } {
    const inv = this.getInvitationByToken(token);
    if (!(ASSIGNABLE_ROLES as readonly string[]).includes(inv.role)) {
      throw new ValidationError("This invitation carries a role that can't be assigned.");
    }

    // Create tenant membership
    db.createMembership({
      id: `mem_${randomSuffix()}`,
      tenant_id: inv.tenant_id,
      user_id: userId,
      role: inv.role,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.updateInvitationStatus(token, "ACCEPTED");

    AuditService.log({
      tenantId: inv.tenant_id,
      actorUserId: userId,
      action: "INVITATION_ACCEPTED",
      resourceType: "membership",
      resourceId: userId,
      metadata: { role: inv.role, invitationId: inv.id },
    });

    return { tenantId: inv.tenant_id, role: inv.role };
  }

  public static getInvitationsForTenant(tenantId: string): InvitationRecord[] {
    return db.findInvitationsByTenant(tenantId);
  }
}
