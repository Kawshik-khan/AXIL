import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { EngagementAnalysisService } from "@/domains/social/insights/engagement-analysis.service";
import { parseRangeDays } from "@/domains/social/insights/suggestion.types";
import { withStore } from "@/lib/store-unit";

/** Content performance (Facebook Page + Instagram) for the last `days` (7, 14, 30 or 90); `refresh=1` skips the 5-minute cache. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const url = new URL(request.url);
    const report = await EngagementAnalysisService.getReport(context, parseRangeDays(url.searchParams.get("days")), {
      refresh: url.searchParams.get("refresh") === "1",
      signal: request.signal,
    });
    return apiSuccess(report);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
