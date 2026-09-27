import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { growthIntelligenceService } from "@/domains/growth/services/growth-intelligence.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const recommendations = growthIntelligenceService.generateGrowthRecommendations(context.tenant.id);
    return apiSuccess({ recommendations, total: recommendations.length });
  } catch (err) {
    return apiError(err);
  }
}
