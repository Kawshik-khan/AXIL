import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { SocialAnalyticsService } from "@/domains/social/analytics/social-analytics.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const metrics = await SocialAnalyticsService.getMetrics(context);
    return apiSuccess({ metrics });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
