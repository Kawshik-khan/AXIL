import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { continuousLearningService, modelGovernanceService } from "@/domains/autonomous/services";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const candidates = continuousLearningService.getCandidates(context.tenant.id, status as any);
    const models = modelGovernanceService.getModels(context.tenant.id);
    return apiSuccess({ candidates, models });
  } catch (err) {
    return apiError(err);
  }
}
