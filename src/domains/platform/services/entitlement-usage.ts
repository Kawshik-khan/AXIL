/**
 * How each COUNT_LIMIT entitlement is counted: what exists now, not monthly usage. Shared by the enforcement gate
 * (src/lib/safety-gate.ts) and the console's usage views, so both always count the same way.
 */
import { db } from "@/infrastructure/db";
import { productRepository } from "@/domains/catalog/product.repository";

export const CURRENT_COUNT: {
  max_users: (tenantId: string) => number;
  max_products: (tenantId: string) => Promise<number>;
  max_channels: (tenantId: string) => number;
} = {
  max_users: (t) =>
    db.findMembershipsByTenantId(t).filter((m) => m.status !== "SUSPENDED").length +
    db.findInvitationsByTenant(t).filter((i) => i.status === "PENDING" && Date.parse(i.expires_at) > Date.now()).length,
  max_products: (t) => productRepository.countByTenant(t),
  max_channels: (t) => db.getConnectedChannels(t).length,
};

export type EntitlementLimitKey = keyof typeof CURRENT_COUNT;

export function isCountedLimit(id: string): id is EntitlementLimitKey {
  return Object.hasOwn(CURRENT_COUNT, id);
}

/** The live count for a COUNT_LIMIT entitlement. */
export async function countCurrent(tenantId: string, id: EntitlementLimitKey): Promise<number> {
  return await CURRENT_COUNT[id](tenantId);
}
