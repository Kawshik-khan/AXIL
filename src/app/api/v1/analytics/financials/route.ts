import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { analyticsService } from "@/domains/analytics/analytics.service";
import { DatePreset } from "@/types/analytics";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const preset = (searchParams.get("preset") as DatePreset) || "30D";

    const financials = await analyticsService.getFinancialMetrics(context, preset);
    return apiSuccess({ financials, preset });
  } catch (err) {
    return apiError(err);
  }
}
