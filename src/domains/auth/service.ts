import { randomSuffix } from "@/lib/ids";
import { db, UserRecord, TenantRecord } from "@/infrastructure/db";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from "@/lib/security";
import { AuthenticationError, ConflictError, ValidationError, UserSuspendedError, TenantSuspendedError, MembershipSuspendedError } from "@/lib/errors";
import { RequestContext } from "@/lib/context";
import { RbacService } from "@/domains/rbac/service";
import { AuditService } from "@/domains/audit/service";
import { TenantService } from "@/domains/tenants/service";
import { RoleName } from "@/lib/permissions";

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  workspaceName: string;
  currency?: string;
}

export interface AuthResult {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    currency: string;
  };
  role: RoleName;
}

export class AuthService {
  public static async registerTenantWithOwner(input: RegisterInput): Promise<AuthResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    if (!input.email || !normalizedEmail.includes("@")) {
      throw new ValidationError("Valid email address is required.");
    }
    if (!input.password || input.password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters long.");
    }
    if (!input.name || input.name.trim().length < 2) {
      throw new ValidationError("Your full name must be at least 2 characters.");
    }
    if (!input.workspaceName || input.workspaceName.trim().length < 2) {
      throw new ValidationError("Workspace name must be at least 2 characters.");
    }

    // Check if email already registered
    const existingUser = db.findUserByEmail(normalizedEmail);
    if (existingUser) {
      throw new ConflictError("An account with this email address already exists.");
    }

    // 1. Create Tenant
    const tenant = await TenantService.createTenant({
      name: input.workspaceName,
      currency: input.currency || "BDT",
    });

    // 2. Hash Password & Create User
    const passwordHash = await hashPassword(input.password);
    const userId = `usr_${randomSuffix()}`;

    const user: UserRecord = {
      id: userId,
      email: normalizedEmail,
      name: input.name.trim(),
      password_hash: passwordHash,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.createUser(user);

    // 3. Create Owner Membership
    db.createMembership({
      id: `mem_${randomSuffix()}`,
      tenant_id: tenant.id,
      user_id: user.id,
      role: "OWNER",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 4. Audit Log
    AuditService.log({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "USER_REGISTERED_AS_OWNER",
      resourceType: "user",
      resourceId: user.id,
      metadata: { workspace: tenant.name, email: user.email },
    });

    // 5. Sign Session Token
    const token = await signSessionToken({
      userId: user.id,
      tenantId: tenant.id,
      role: "OWNER",
      email: user.email,
      name: user.name,
      sv: user.session_version ?? 1,
    });

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: tenant.currency },
      role: "OWNER",
    };
  }

  public static async login(email: string, password: string, tenantId?: string): Promise<AuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = db.findUserByEmail(normalizedEmail);

    if (!user) {
      throw new AuthenticationError("Invalid email or password.");
    }

    if (user.status === "SUSPENDED" || user.status === "DEACTIVATED") {
      throw new UserSuspendedError();
    }

    const passwordMatches = await verifyPassword(password, user.password_hash);
    if (!passwordMatches) {
      throw new AuthenticationError("Invalid email or password.");
    }

    // Resolve tenant memberships; a membership suspended by a workspace admin gives no access to that workspace (N5).
    const allMemberships = db.findMembershipsByUserId(user.id);
    const memberships = allMemberships.filter((m) => m.status !== "SUSPENDED");
    if (allMemberships.length > 0 && memberships.length === 0) {
      throw new MembershipSuspendedError();
    }
    // Platform operators get no implicit workspace role: they need a real membership, or audited impersonation
    // (audit M10, FX-15). They used to become OWNER of the first tenant.
    let activeMembership = memberships[0];

    if (!activeMembership) {
      throw new AuthenticationError("No active workspaces associated with this user account.");
    }

    if (tenantId && memberships.length > 0) {
      const match = memberships.find((m) => m.tenant_id === tenantId);
      if (match) activeMembership = match;
    }

    const tenant = db.findTenantById(activeMembership.tenant_id);
    if (!tenant) {
      throw new AuthenticationError("Associated workspace could not be found.");
    }

    if (tenant.status !== "ACTIVE") {
      throw new TenantSuspendedError(tenant.name);
    }

    // Update last login
    db.updateUser(user.id, { last_login_at: new Date().toISOString() });

    // Audit log
    AuditService.log({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "USER_LOGIN",
      resourceType: "session",
      resourceId: user.id,
      metadata: { role: activeMembership.role },
    });

    const token = await signSessionToken({
      userId: user.id,
      tenantId: tenant.id,
      role: activeMembership.role,
      email: user.email,
      name: user.name,
      sv: user.session_version ?? 1,
    });

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: tenant.currency },
      role: activeMembership.role,
    };
  }

  public static async resolveRequestContext(token: string, requestId?: string): Promise<RequestContext> {
    const payload = await verifySessionToken(token);
    if (!payload) {
      throw new AuthenticationError("Session expired or invalid. Please sign in again.");
    }

    const user = db.findUserById(payload.userId);
    if (!user) {
      throw new AuthenticationError("User associated with session does not exist.");
    }
    if (user.status !== "ACTIVE") {
      throw new UserSuspendedError();
    }
    if ((payload.sv ?? 1) !== (user.session_version ?? 1)) {
      throw new AuthenticationError("This session was signed out. Please sign in again.");
    }

    const tenant = db.findTenantById(payload.tenantId);
    if (!tenant) {
      throw new AuthenticationError("Workspace associated with session does not exist.");
    }
    if (tenant.status !== "ACTIVE") {
      throw new TenantSuspendedError(tenant.name);
    }

    // Only a real membership grants workspace access; platform operators no longer map to OWNER (audit M10).
    const membership = db.findMembership(payload.tenantId, payload.userId);
    if (!membership) {
      throw new AuthenticationError("User is no longer a member of this workspace.");
    }
    if (membership.status === "SUSPENDED") {
      throw new MembershipSuspendedError();
    }

    const permissions = RbacService.getPermissionsForRole(membership.role);

    return {
      requestId: requestId || `req_${randomSuffix()}`,
      traceId: `trc_${randomSuffix()}`,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        currency: tenant.currency,
        timezone: tenant.timezone,
        language: tenant.language,
        status: tenant.status,
      },
      role: membership.role,
      permissions,
      timestamp: new Date().toISOString(),
    };
  }
}
