/**
 * CommerceOS Phase 9: Enterprise RBAC & Scope Authorization Service
 * Resolves hierarchical permissions and verifies entity access scopes.
 */

import { db } from "@/infrastructure/db";
import { Permission, PERMISSIONS, ENTERPRISE_ROLE_PERMISSIONS } from "@/lib/permissions";
import {
  EnterpriseRoleName,
  EnterpriseScope,
  EnterpriseUserRecord,
  EntityType,
} from "@/types/enterprise";

export class EnterpriseRbacService {
  /**
   * Evaluates if an enterprise user has a specific permission
   */
  public hasPermission(userOrRole: EnterpriseUserRecord | EnterpriseRoleName, permission: Permission): boolean {
    const role = typeof userOrRole === "string" ? userOrRole : userOrRole.enterprise_role;
    const allowed = ENTERPRISE_ROLE_PERMISSIONS[role] || [];
    return allowed.includes(permission);
  }

  public assertPermission(user: EnterpriseUserRecord, permission: Permission): void {
    const check = this.assertCan({ user, permission });
    if (!check.allowed) {
      throw new Error(`Forbidden: ${check.reason}`);
    }
  }

  /**
   * Verifies if a user has access to a specific entity scope
   */
  public canAccessEntity(
    scope: EnterpriseScope,
    entityType: EntityType,
    entityId: string,
    orgId: string
  ): boolean {
    if (scope.organization_id !== orgId) {
      return false; // Cross-organization isolation
    }

    if (scope.all_access) {
      return true;
    }

    switch (entityType) {
      case "ORGANIZATION":
        return scope.organization_id === entityId;
      case "BUSINESS_UNIT":
        return scope.business_unit_ids?.includes(entityId) || false;
      case "BRAND":
        return scope.brand_ids?.includes(entityId) || false;
      case "STORE":
        return scope.store_ids?.includes(entityId) || false;
      case "WAREHOUSE":
        return scope.warehouse_ids?.includes(entityId) || false;
      default:
        return false;
    }
  }

  /**
   * Verifies user permission AND target entity scope simultaneously
   */
  public assertCan(params: {
    user: EnterpriseUserRecord;
    permission: Permission;
    targetEntityType?: EntityType;
    targetEntityId?: string;
  }): { allowed: boolean; reason?: string } {
    if (params.user.status !== "ACTIVE") {
      return { allowed: false, reason: "Enterprise user account is inactive or suspended" };
    }

    const hasPerm = this.hasPermission(params.user.enterprise_role, params.permission);
    if (!hasPerm) {
      return {
        allowed: false,
        reason: `Role '${params.user.enterprise_role}' does not possess required permission '${params.permission}'`,
      };
    }

    if (params.targetEntityType && params.targetEntityId) {
      const hasScope = this.canAccessEntity(
        params.user.assigned_scope,
        params.targetEntityType,
        params.targetEntityId,
        params.user.organization_id
      );
      if (!hasScope) {
        return {
          allowed: false,
          reason: `User scope does not grant access to ${params.targetEntityType} '${params.targetEntityId}'`,
        };
      }
    }

    return { allowed: true };
  }
}

export const enterpriseRbacService = new EnterpriseRbacService();
