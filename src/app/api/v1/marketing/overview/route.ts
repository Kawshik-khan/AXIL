import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const metrics = marketingService.getOverviewMetrics(context.tenant.id);
    return apiSuccess(metrics);
  } catch (err) {
    return apiError(err);
  }
}
