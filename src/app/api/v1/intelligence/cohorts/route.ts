import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { cohortAnalysisService } from "@/domains/intelligence/services/cohort-analysis.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    const cohorts = cohortAnalysisService.analyzeCohorts(context.tenant.id);
    return apiSuccess({ cohorts, total: cohorts.length });
  } catch (err) {
    return apiError(err);
  }
}
