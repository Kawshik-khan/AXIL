import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";
import { AttributionModel } from "@/types/growth";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const url = new URL(request.url);
    const model = (url.searchParams.get("model") || "LAST_TOUCH") as AttributionModel;

    const report = marketingService.getAttributionReport(context.tenant.id, model);
    return apiSuccess(report);
  } catch (err) {
    return apiError(err);
  }
}
