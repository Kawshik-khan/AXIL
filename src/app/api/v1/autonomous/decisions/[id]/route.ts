import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { globalDecisionEngineService } from "@/domains/autonomous/services";
import { NotFoundError } from "@/lib/errors";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await Promise.resolve(params);
    const decision = globalDecisionEngineService.findById(context.tenant.id, id);
    if (!decision) {
      return apiError(new NotFoundError(`Decision not found: ${id}`));
    }
    return apiSuccess(decision);
  } catch (err) {
    return apiError(err);
  }
}
