import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAuthorizationService } from "@/domains/platform/services/platform-authorization.service";
import { db } from "@/infrastructure/db";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    PlatformAuthorizationService.assertCan(context, "platform.read");

    const allEscalations = db.getAllAgentHitlEscalations();
    const tenants = db.getTenants();
    const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));

    // Enrich with tenant name and sort by pending first, then newest
    const enriched = allEscalations.map((esc) => ({
      ...esc,
      tenant_name: tenantMap.get(esc.tenant_id) || esc.tenant_id,
    })).sort((a, b) => {
      if (a.status === "PENDING_REVIEW" && b.status !== "PENDING_REVIEW") return -1;
      if (a.status !== "PENDING_REVIEW" && b.status === "PENDING_REVIEW") return 1;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });

    return apiSuccess({
      escalations: enriched,
      total_count: enriched.length,
      pending_count: enriched.filter((e) => e.status === "PENDING_REVIEW").length,
      claimed_count: enriched.filter((e) => e.status === "CLAIMED").length,
      resolved_count: enriched.filter((e) => e.status === "RESOLVED").length,
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
