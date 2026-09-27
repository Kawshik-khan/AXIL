import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { dataQualityService } from "@/domains/intelligence/services/data-quality.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const report = dataQualityService.runDataQualityAudit(context.tenant.id);
    return apiSuccess({ report });
  } catch (err) {
    return apiError(err);
  }
}
