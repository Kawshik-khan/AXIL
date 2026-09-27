import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { experimentService } from "@/domains/growth/services/experiment.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const experiment = experimentService.evaluateExperiment(context.tenant.id, id);
    return apiSuccess({ experiment });
  } catch (err) {
    return apiError(err);
  }
}
