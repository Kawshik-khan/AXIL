import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { db } from "@/infrastructure/db";
import { audienceService } from "@/domains/growth/services/audience.service";
import { customerLifecycleService } from "@/domains/growth/services/customer-lifecycle.service";
import { attributionService } from "@/domains/growth/services/attribution.service";
import { growthIntelligenceService } from "@/domains/growth/services/growth-intelligence.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;

    const audiences = audienceService.listAudiences(tenantId);
    const campaigns = db.getCampaigns(tenantId);
    const journeys = db.getJourneys(tenantId);
    const lifecycleDist = customerLifecycleService.getLifecycleDistribution(tenantId);
    const attribution = attributionService.getAttributionSummary(tenantId);
    const insights = growthIntelligenceService.detectGrowthInsights(tenantId);
    const recommendations = growthIntelligenceService.generateGrowthRecommendations(tenantId);

    const activeCampaigns = campaigns.filter((c) => c.status === "RUNNING" || c.status === "SCHEDULED");
    const activeJourneys = journeys.filter((j) => j.status === "ACTIVE");

    return apiSuccess({
      audiences_count: audiences.length,
      active_campaigns_count: activeCampaigns.length,
      total_campaigns_count: campaigns.length,
      active_journeys_count: activeJourneys.length,
      lifecycle_distribution: lifecycleDist,
      attribution_summary: attribution,
      growth_insights_count: insights.length,
      growth_recommendations_count: recommendations.length,
      recent_campaigns: campaigns.slice(0, 5),
      top_recommendations: recommendations.slice(0, 3),
    });
  } catch (err) {
    return apiError(err);
  }
}
