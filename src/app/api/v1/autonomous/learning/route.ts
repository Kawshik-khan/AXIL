import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { continuousLearningService, modelGovernanceService } from "@/domains/autonomous/services";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.LEARNING_READ);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const candidates = continuousLearningService.getCandidates(context.tenant.id, status as any);
    const models = modelGovernanceService.getModels(context.tenant.id);
    return apiSuccess({ candidates, models });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
