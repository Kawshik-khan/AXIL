import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { decisionService } from "@/domains/intelligence/services/decision.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params: rawParams }: { params: Promise<{ id: string }> }
) {
  const params = await rawParams;
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_EXECUTE);
    const recommendationId = params.id;
    const body = await request.json().catch(() => ({}));

    const decision = await decisionService.evaluateAndProposeDecision(context.tenant.id, recommendationId, body.context);
    return apiSuccess({ decision }, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
