import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { globalDecisionEngineService } from "@/domains/autonomous/services";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await Promise.resolve(params);
    const body = await request.json().catch(() => ({}));
    const rejected = globalDecisionEngineService.rejectDecision(
      context.tenant.id,
      id,
      body.reason || "Rejected by administrator"
    );
    return apiSuccess(rejected);
  } catch (err) {
    return apiError(err);
  }
}
