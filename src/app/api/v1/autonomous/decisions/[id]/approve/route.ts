import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { globalDecisionEngineService } from "@/domains/autonomous/services";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DECISIONS_APPROVE);
    const { id } = await Promise.resolve(params);
    const approved = globalDecisionEngineService.approveDecision(
      context.tenant.id,
      id,
      context.user.id // the signed-in approver, never a body field (FX-10 step 3)
    );
    return apiSuccess(approved);
  } catch (err) {
    return apiError(err);
  }
}
