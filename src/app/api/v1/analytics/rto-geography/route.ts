import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { analyticsService } from "@/domains/analytics/analytics.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const division = searchParams.get("division") || undefined;
    const search = searchParams.get("search") || undefined;

    const report = await analyticsService.getRtoGeographyReport(context, { division, search });
    return apiSuccess({ report });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
