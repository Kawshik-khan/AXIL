import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { PostSalesService } from "@/domains/social/insights/post-sales.service";
import { parseRangeDays } from "@/domains/social/insights/suggestion.types";
import { withStore } from "@/lib/store-unit";

/** Posts that sold: Comment-to-DM messages per post → replies → orders and revenue, for the last `days` (7, 14, 30, 90). */
async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const url = new URL(request.url);
    return apiSuccess(await PostSalesService.getReport(context, parseRangeDays(url.searchParams.get("days"))));
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
