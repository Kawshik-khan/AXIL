import { apiSuccess, apiError, extractPlatformContext } from "@/lib/api-response";
import { PlatformAnalyticsService } from "@/domains/platform/services/platform-analytics.service";
import { withStore } from "@/lib/store-unit";

export const dynamic = "force-dynamic";

/** Activation funnel (signup → product → order → paying) and 12 weekly signup cohorts, computed on read. */
async function handleGET(request: Request) {
  try {
    const context = await extractPlatformContext(request);
    return apiSuccess(await PlatformAnalyticsService.getActivationFunnel(context));
  } catch (error) {
    return apiError(error);
  }
}

export const GET = withStore("GET", handleGET);
