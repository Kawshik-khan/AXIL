import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAnalyticsService } from "@/domains/platform";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    const overview = PlatformAnalyticsService.getPlatformOverview(context);
    return apiSuccess(overview);
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
