import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { audienceService } from "@/domains/growth/services/audience.service";
import { customerLifecycleService } from "@/domains/growth/services/customer-lifecycle.service";
import { growthIntelligenceService } from "@/domains/growth/services/growth-intelligence.service";
import { intelligenceSnapshots } from "@/domains/intelligence/services/intelligence-snapshot.service";
import { withStore } from "@/lib/store-unit";
import { COMMERCE_ANALYTICS_COLLECTIONS } from "@/infrastructure/db/tenant-rows";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const tenantId = context.tenant.id;

    const audiences = audienceService.listAudiences(tenantId);
    const lifecycleDist = customerLifecycleService.getLifecycleDistribution(tenantId);
    // Read-only (FX-21): stored snapshots while fresh, otherwise computed for this request
    const insights = intelligenceSnapshots.read(tenantId, "growth_insights", () =>
      growthIntelligenceService.computeGrowthInsights(tenantId)
    ).rows;
    const recommendations = intelligenceSnapshots.read(tenantId, "growth_recommendations", () =>
      growthIntelligenceService.computeGrowthRecommendations(tenantId)
    ).rows;

    return apiSuccess({
      audiences_count: audiences.length,
      lifecycle_distribution: lifecycleDist,
      growth_insights_count: insights.length,
      growth_recommendations_count: recommendations.length,
      top_recommendations: recommendations.slice(0, 3),
    });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET, { tenantRows: { collections: COMMERCE_ANALYTICS_COLLECTIONS, permission: PERMISSIONS.MARKETING_READ } });
