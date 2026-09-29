import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { globalDecisionEngineService } from "@/domains/autonomous/services";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DECISIONS_APPROVE);
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

export const POST = withStore("POST", handlePOST);
