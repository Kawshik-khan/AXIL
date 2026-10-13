import { PLATFORM_PERMISSIONS, type PlatformPermission } from "@/lib/permissions";

export const CONSOLE_ROOT = "/super-admin";

/**
 * The platform permission each console module needs to open: the one its main read route enforces (plan §3.2).
 * The dock hides modules a role can't open; every route still enforces its own permission on each request.
 */
export const PLATFORM_MODULE_PERMISSIONS: ReadonlyArray<readonly [path: string, permission: PlatformPermission]> = [
  [`${CONSOLE_ROOT}/tenants`, PLATFORM_PERMISSIONS.TENANT_READ],
  [`${CONSOLE_ROOT}/billing`, PLATFORM_PERMISSIONS.PLAN_READ],
  [`${CONSOLE_ROOT}/ai`, PLATFORM_PERMISSIONS.PLATFORM_READ],
  [`${CONSOLE_ROOT}/automations`, PLATFORM_PERMISSIONS.AUTOMATION_READ],
  [`${CONSOLE_ROOT}/safety`, PLATFORM_PERMISSIONS.SECURITY_READ],
  [`${CONSOLE_ROOT}/security`, PLATFORM_PERMISSIONS.SUPPORT_READ],
  [`${CONSOLE_ROOT}/audit`, PLATFORM_PERMISSIONS.AUDIT_READ],
  [`${CONSOLE_ROOT}/insights`, PLATFORM_PERMISSIONS.ANALYTICS_PLATFORM_READ],
  [`${CONSOLE_ROOT}/settings`, PLATFORM_PERMISSIONS.PLATFORM_CONFIG_READ],
  // The Control Tower last: it is the prefix of every other path, so the more specific entries must match first
  [CONSOLE_ROOT, PLATFORM_PERMISSIONS.PLATFORM_READ],
];

/** The permission a console path needs, or null for a path outside the console modules. */
export function requiredPlatformPermission(path: string): PlatformPermission | null {
  const pathname = path.split(/[?#]/)[0];
  const rule = PLATFORM_MODULE_PERMISSIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return rule ? rule[1] : null;
}

export function canAccessPlatformPath(path: string, permissions: readonly string[] | undefined): boolean {
  const required = requiredPlatformPermission(path);
  if (!required) return false; // unknown console paths are not shown
  return Boolean(permissions?.includes(required));
}

export function hasPlatformPermission(permissions: readonly string[] | undefined, permission: string): boolean {
  return Boolean(permissions?.includes(permission));
}
