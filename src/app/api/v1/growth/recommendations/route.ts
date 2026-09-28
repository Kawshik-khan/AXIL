import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { intelligenceSnapshots } from "@/domains/intelligence/services/intelligence-snapshot.service";
import { growthIntelligenceService } from "@/domains/growth/services/growth-intelligence.service";

/** Read-only (FX-21): the stored snapshot while fresh, otherwise computed for this request. Never writes. */
export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const tenantId = context.tenant.id;
    const { rows, snapshot } = intelligenceSnapshots.read(tenantId, "growth_recommendations", () => growthIntelligenceService.computeGrowthRecommendations(tenantId));
    return apiSuccess({ recommendations: rows, total: rows.length }, { snapshot });
  } catch (err) {
    return apiError(err);
  }
}
