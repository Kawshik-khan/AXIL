import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { randomSuffix } from "@/lib/ids";
import { InvitationService } from "@/domains/invitations/service";
import { TenantService } from "@/domains/tenants/service";
import { AuthService } from "@/domains/auth/service";
import { db, UserRecord } from "@/infrastructure/db";
import { z } from "zod";
import { hashPassword, verifyPassword, signSessionToken, AUTH_COOKIE_NAME, DISABLED_PASSWORD_HASH } from "@/lib/security";
import { apiSuccess, apiError } from "@/lib/api-response";
import { AuthenticationError, ValidationError } from "@/lib/errors";

const AcceptBody = z
  .object({
    name: z.string().trim().max(120).optional(),
    password: z.string().max(200).optional(),
  })
  .strict();

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const invitation = InvitationService.getInvitationByToken(params.token);
    const tenant = TenantService.getTenantById(invitation.tenant_id);

    const existing = db.findUserByEmail(invitation.email);
    return apiSuccess({
      email: invitation.email,
      role: invitation.role,
      workspace_name: tenant.name,
      expires_at: invitation.expires_at,
      // An active account confirms with its password; a new or never-activated one chooses a name and password
      existing_account: !!existing && !(existing.status === "INVITED" && existing.password_hash === DISABLED_PASSWORD_HASH),
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const invitation = InvitationService.getInvitationByToken(params.token);
    const tenant = TenantService.getTenantById(invitation.tenant_id);
    const body = AcceptBody.parse(await request.json());
    enforceRateLimit(`invite:accept:${params.token}`, 10, 15 * MINUTE);

    let user = db.findUserByEmail(invitation.email);

    if (user && user.status === "INVITED" && user.password_hash === DISABLED_PASSWORD_HASH) {
      // A provisioned owner who has never set a password (audit N8). Only an invitation to a workspace this account
      // already belongs to may activate it: otherwise anyone who can invite could claim another workspace's
      // not-yet-activated owner by inviting that email and accepting first.
      if (!db.findMembership(invitation.tenant_id, user.id)) {
        throw new AuthenticationError("This account must be activated from its own workspace's setup link.");
      }
      if (!body.name || body.name.length < 2) throw new ValidationError("Your full name must be at least 2 characters.");
      if (!body.password || body.password.length < 8) throw new ValidationError("Password must be at least 8 characters long.");
      const passwordHash = await hashPassword(body.password);
      db.updateUser(user.id, { name: body.name, password_hash: passwordHash, status: "ACTIVE" });
      user = db.findUserById(user.id) as UserRecord;
    } else if (user) {
      // The link alone is not proof of identity: an existing account accepts only with its own password.
      // Otherwise anyone who can create an invitation could mint a session for any existing email (ADR-103).
      // Same per-account limit as sign-in, plus one per invitation, so this can't be used to guess passwords (FX-14).
      enforceRateLimit(`login:tenant:email:${user.email.toLowerCase()}`, 10, 15 * MINUTE);
      const password = body.password ?? "";
      if (user.status !== "ACTIVE" || !(await verifyPassword(password, user.password_hash))) {
        throw new AuthenticationError("Enter this account's password to accept the invitation.");
      }
    } else {
      if (!body.name || body.name.length < 2) {
        throw new ValidationError("Your full name must be at least 2 characters.");
      }
      if (!body.password || body.password.length < 8) {
        throw new ValidationError("Password must be at least 8 characters long.");
      }

      const passwordHash = await hashPassword(body.password);
      const userId = `usr_${randomSuffix()}`;

      user = {
        id: userId,
        email: invitation.email,
        name: body.name,
        password_hash: passwordHash,
        status: "ACTIVE",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.createUser(user);
    }

    // Accept invitation and create membership
    InvitationService.acceptInvitation(params.token, user.id);

    const token = await signSessionToken({
      userId: user.id,
      tenantId: tenant.id,
      role: invitation.role,
      email: user.email,
      name: user.name,
      sv: user.session_version ?? 1,
    });

    const response = apiSuccess({
      message: "Invitation accepted successfully.",
      user: { id: user.id, email: user.email, name: user.name },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      role: invitation.role,
    });

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    return apiError(err);
  }
}
