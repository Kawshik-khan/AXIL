import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { attributionService } from "@/domains/growth/services/attribution.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const tenantId = context.tenant.id;
    const summary = attributionService.getAttributionSummary(tenantId);
    return apiSuccess({ attribution: summary });
  } catch (err) {
    return apiError(err);
  }
}
