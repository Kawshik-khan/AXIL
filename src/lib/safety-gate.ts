/**
 * Platform safety controls that are enforced, not just recorded (FIX_IMPLEMENTATION_PLAN FX-34, audit H11).
 * Kill switches and plan limits existed as data and operator screens; nothing checked them before acting.
 */
import { db } from "@/infrastructure/db";
import { FeatureNotEntitledError, KillSwitchActiveError, PlanLimitError } from "@/lib/errors";
import { PlatformSafetyService } from "@/domains/platform/services/platform-safety.service";
import { PlatformEntitlementService } from "@/domains/platform/services/platform-entitlement.service";
import crypto from "crypto";

type KillScope = "TENANT" | "CHANNEL" | "WORKFLOW" | "PROVIDER";

/** Throws while a GLOBAL kill switch, the tenant's, or one for any of `targets` in `scope` is active. */
export function assertNotKilled(tenantId: string, scope: KillScope = "TENANT", ...targets: string[]): void {
  if (PlatformSafetyService.isExecutionBlocked("TENANT", tenantId)) {
    throw new KillSwitchActiveError("TENANT", "Operations for this workspace are paused by the platform.");
  }
  for (const target of scope === "TENANT" ? [] : targets) {
    if (target && PlatformSafetyService.isExecutionBlocked(scope, target)) {
      throw new KillSwitchActiveError(scope, `${scope.toLowerCase()} ${target} is paused by the platform.`);
    }
  }
}

/** Limits that count what exists now (not monthly usage), and how to count it. */
const CURRENT_COUNT: Record<string, (tenantId: string) => number> = {
  max_users: (t) => db.findMembershipsByTenantId(t).filter((m) => m.status !== "SUSPENDED").length +
    db.findInvitationsByTenant(t).filter((i) => i.status === "PENDING" && Date.parse(i.expires_at) > Date.now()).length,
  max_products: (t) => db.getAllProducts(t).filter((p) => p.status !== "ARCHIVED").length,
  max_channels: (t) => db.getConnectedChannels(t).length,
};

/**
 * Throws when adding `adding` more would exceed the workspace's limit (tenant override, then plan, then default).
 * `can()` measured these against monthly usage records, which never counted existing users, products or channels.
 */
export function assertWithinLimit(tenantId: string, entitlementId: keyof typeof CURRENT_COUNT, adding = 1): void {
  const limit = PlatformEntitlementService.resolveLimit(tenantId, entitlementId);
  if (limit === null) return; // not gated
  if (limit === false) throw new FeatureNotEntitledError(entitlementId);
  if (limit === true) return;
  const current = CURRENT_COUNT[entitlementId](tenantId);
  if (current + adding > limit) throw new PlanLimitError(entitlementId, limit, current);
}

/**
 * Feature flags evaluated for a tenant (FX-34 step 4). A key with no flag isn't gated. A flag is on for a tenant when
 * it's on globally, or the tenant is allow-listed, or the tenant falls inside the percentage rollout
 * (sha256(tenantId + key) mod 100 < percentage).
 */
export function isFeatureEnabled(key: string, tenantId: string): boolean {
  const flag = db.findPlatformFeatureFlag(key);
  if (!flag) return true;
  if (flag.tenant_allowlist?.includes(tenantId)) return true;
  if (!flag.is_enabled_globally) return false;
  const pct = flag.percentage_rollout ?? 100;
  if (pct >= 100) return true;
  const bucket = parseInt(crypto.createHash("sha256").update(tenantId + key).digest("hex").slice(0, 8), 16) % 100;
  return bucket < pct;
}
