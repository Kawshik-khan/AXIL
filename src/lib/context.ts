import { Permission, RoleName, ROLE_PERMISSIONS } from "./permissions";

export interface RequestUser {
  id: string;
  email: string;
  name: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "DEACTIVATED";
}

export interface RequestTenant {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  language: string;
  settings?: Record<string, unknown>;
  status: "ACTIVE" | "SUSPENDED" | "PROVISIONING" | "TRIAL" | "PAST_DUE" | "CANCELLED" | "ARCHIVED";
}

export interface RequestContext {
  requestId: string;
  traceId: string;
  user: RequestUser;
  tenant: RequestTenant;
  role: RoleName;
  permissions: Permission[];
  timestamp: string;
}

export function createAnonymousContext(requestId?: string): { requestId: string; timestamp: string } {
  return {
    requestId: requestId || `req_${Math.random().toString(36).substring(2, 12)}`,
    timestamp: new Date().toISOString(),
  };
}

export function hasPermission(context: RequestContext, permission: Permission): boolean {
  if (context.user.status !== "ACTIVE") {
    return false;
  }
  if (context.tenant.status !== "ACTIVE") {
    return false;
  }
  return context.permissions.includes(permission);
}

import { PlatformPermission, PlatformRole } from "./permissions";
export type { PlatformPermission, PlatformRole };

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
}

export interface PlatformContext {
  requestId: string;
  traceId: string;
  scope: "PLATFORM";
  platformUser: PlatformUser;
  platformRole: PlatformRole;
  permissions: PlatformPermission[];
  mfaVerified: boolean;
  stepUpVerified?: boolean;
  impersonationSession?: {
    id: string;
    targetTenantId: string;
    targetUserId: string;
    mode: "READ_ONLY" | "MUTATION_APPROVED";
    reason: string;
  };
  timestamp: string;
}

export function hasPlatformPermission(context: PlatformContext, permission: PlatformPermission): boolean {
  if (context.platformUser.status !== "ACTIVE") {
    return false;
  }
  return context.permissions.includes(permission);
}

