import { PERMISSIONS } from "@/lib/permissions";

/**
 * The permission each dashboard module needs (FIX_IMPLEMENTATION_PLAN FX-10 step 6). Navigation hides modules the
 * signed-in role can't use; the API still enforces the same permissions on every request.
 */
const MODULE_PERMISSIONS: ReadonlyArray<readonly [prefix: string, permission: string]> = [
  ["/orders", PERMISSIONS.ORDERS_READ],
  ["/products", PERMISSIONS.PRODUCTS_READ],
  ["/inventory", PERMISSIONS.INVENTORY_READ],
  ["/shipments", PERMISSIONS.SHIPMENTS_READ],
  ["/customers", PERMISSIONS.CUSTOMERS_READ],
  ["/conversations", PERMISSIONS.SOCIAL_CONVERSATION_READ],
  ["/growth", PERMISSIONS.MARKETING_READ],
  ["/marketing", PERMISSIONS.MARKETING_READ],
  ["/operations", PERMISSIONS.OPERATIONS_READ],
  ["/enterprise", PERMISSIONS.ENTERPRISE_READ],
  ["/autonomous", PERMISSIONS.AUTONOMOUS_READ],
  ["/analytics", PERMISSIONS.ANALYTICS_READ],
  ["/intelligence", PERMISSIONS.ANALYTICS_READ],
  ["/agents", PERMISSIONS.AI_READ],
  ["/automations", PERMISSIONS.AUTOMATION_READ],
  ["/connector", PERMISSIONS.SETTINGS_READ],
  ["/settings", PERMISSIONS.SETTINGS_READ],
];

export function canAccessPath(path: string, permissions: readonly string[] | undefined): boolean {
  const pathname = path.split(/[?#]/)[0];
  const rule = MODULE_PERMISSIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!rule) return true; // e.g. the overview page and sign-out
  return Boolean(permissions?.includes(rule[1]));
}
