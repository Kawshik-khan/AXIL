import { db } from "@/infrastructure/db";
import { RequestContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";

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
