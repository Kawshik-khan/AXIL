import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { platformHealthService } from "@/domains/autonomous/services";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const health = platformHealthService.getSystemHealth(context.tenant.id);
    const scorecard = platformHealthService.getQualityScorecard(context.tenant.id, "DAILY");
    const domainHealth = health?.dimensions || {};
    return apiSuccess({ health, scorecard, domain_health: domainHealth });
  } catch (err) {
    return apiError(err);
  }
}
