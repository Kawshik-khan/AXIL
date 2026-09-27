import { Permission, RoleName, ROLE_PERMISSIONS } from "@/lib/permissions";
import { RequestContext, hasPermission } from "@/lib/context";
import { ForbiddenError, UserSuspendedError, TenantSuspendedError } from "@/lib/errors";

export class RbacService {
  public static getPermissionsForRole(role: RoleName): Permission[] {
    return ROLE_PERMISSIONS[role] || [];
  }

  public static can(context: RequestContext, permission: Permission): boolean {
    return hasPermission(context, permission);
  }

  public static assertCan(context: RequestContext, permission: Permission): void {
    if (context.user.status !== "ACTIVE") {
      throw new UserSuspendedError();
    }
    if (context.tenant.status !== "ACTIVE") {
      throw new TenantSuspendedError(context.tenant.name);
    }
    if (!context.permissions.includes(permission)) {
      throw new ForbiddenError(
        `Action requires permission '${permission}', but role '${context.role}' does not grant it.`
      );
    }
  }
}
