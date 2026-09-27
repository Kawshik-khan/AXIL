import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { decisionService } from "@/domains/intelligence/services/decision.service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    const recommendationId = params.id;
    const body = await request.json().catch(() => ({}));

    const decision = await decisionService.evaluateAndProposeDecision(context.tenant.id, recommendationId, body.context);
    return apiSuccess({ decision }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
