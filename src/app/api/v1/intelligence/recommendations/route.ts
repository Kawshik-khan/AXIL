import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { recommendationService } from "@/domains/intelligence/services/recommendation.service";
import { RecommendationStatus } from "@/types/intelligence";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as RecommendationStatus | null;

    let recommendations = recommendationService.getRecommendations(context.tenant.id, status || undefined);
    if (recommendations.length === 0 && !status) {
      recommendations = recommendationService.generateRecommendations(context.tenant.id);
    }

    return apiSuccess({ recommendations, total: recommendations.length });
  } catch (err) {
    return apiError(err);
  }
}
