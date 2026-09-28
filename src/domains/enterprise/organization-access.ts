import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { EnterpriseUserRecord } from "@/types/enterprise";

/**
 * Resolves which enterprise organization a request may use (FIX_IMPLEMENTATION_PLAN FX-13, audit H13).
 *
 * Organizations belong to the workspace that created them (`tenant_id`). A requested `organization_id` is honored only
 * if this workspace owns it; otherwise it is reported as not found, without revealing that it exists elsewhere. With no
 * id, the workspace's own organization is used. Before Phase 1 every workspace silently used the shared
 * `org_default` and could read any organization by id.
 */
export function resolveOrganizationId(context: RequestContext, requested?: unknown): string {
  const tenantId = context.tenant.id;
  if (typeof requested === "string" && requested.trim()) {
    const org = db.findOrganizationById(requested.trim());
    if (!org || org.tenant_id !== tenantId) {
      throw new NotFoundError("Organization", requested.trim());
    }
    return org.id;
  }
  const own = db.getOrganizations().find((o) => o.tenant_id === tenantId);
  if (!own) {
    throw new NotFoundError("Enterprise organization for this workspace");
  }
  return own.id;
}

/**
 * The caller's enterprise identity and scope inside an organization (audit N11). Benchmarks, consolidated analytics,
 * reports and the enterprise AI tools used to build a synthetic ENTERPRISE_ADMIN with `all_access` and fallback
 * identities ("usr_default", "admin@commerceos.io"), so store, brand and business-unit scoping never applied.
 *
 * - An ACTIVE membership in `enterprise_users` is used as stored: its role and assigned scope.
 * - A SUSPENDED or INVITED membership is refused.
 * - With no membership, the workspace OWNER and ADMIN get organization-wide scope, because their workspace owns the
 *   organization (FX-13). Other workspace roles are refused rather than silently given everything.
 */
export function resolveEnterpriseCaller(context: RequestContext, organizationId: string): EnterpriseUserRecord {
  const userId = context.user?.id;
  if (!userId) throw new ForbiddenError("An enterprise caller needs a signed-in user");

  const membership = db.getEnterpriseUsers(organizationId).find((u) => u.user_id === userId);
  if (membership) {
    if (membership.status !== "ACTIVE") {
      throw new ForbiddenError(`Your enterprise membership is ${membership.status.toLowerCase()}`);
    }
    return membership;
  }

  if (context.role === "OWNER" || context.role === "ADMIN") {
    return {
      id: `workspace_${userId}`,
      organization_id: organizationId,
      user_id: userId,
      name: context.user.name,
      email: context.user.email,
      enterprise_role: context.role === "OWNER" ? "ORGANIZATION_OWNER" : "ENTERPRISE_ADMIN",
      assigned_scope: { organization_id: organizationId, all_access: true },
      status: "ACTIVE",
      created_at: context.timestamp,
      updated_at: context.timestamp,
    };
  }
  throw new ForbiddenError("No enterprise scope is assigned to you in this organization; ask an organization admin");
}
