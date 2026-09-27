import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { SocialAnalyticsService } from "@/domains/social/analytics/social-analytics.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const metrics = await SocialAnalyticsService.getMetrics(context);
    return apiSuccess({ metrics });
  } catch (err) {
    return apiError(err);
  }
}
