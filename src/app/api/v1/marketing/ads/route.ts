import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { AdPerformanceService } from "@/domains/social/insights/ad-performance.service";
import { parseRangeDays } from "@/domains/social/insights/suggestion.types";
import { withStore } from "@/lib/store-unit";

/** Meta ad account performance plus CommerceOS ad-to-order attribution; `days` is 7, 14, 30 or 90, `refresh=1` skips the cache. */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const url = new URL(request.url);
    const report = await AdPerformanceService.getReport(context, parseRangeDays(url.searchParams.get("days")), {
      refresh: url.searchParams.get("refresh") === "1",
      signal: request.signal,
    });
    return apiSuccess(report);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
