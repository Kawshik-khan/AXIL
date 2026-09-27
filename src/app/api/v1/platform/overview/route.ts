import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAnalyticsService } from "@/domains/platform";

export async function GET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const overview = PlatformAnalyticsService.getPlatformOverview(context);
    return apiSuccess(overview);
  } catch (error) {
    return apiError(error);
  }
}
