import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { riskDetectorService } from "@/domains/intelligence/services/risk-detector.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const risks = riskDetectorService.detectRisks(context.tenant.id);
    return apiSuccess({ risks, total: risks.length });
  } catch (err) {
    return apiError(err);
  }
}
