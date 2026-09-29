import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { experimentService } from "@/domains/growth/services/experiment.service";
import { withStore } from "@/lib/store-unit";

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_WRITE);
    const { id } = await params;
    const experiment = experimentService.evaluateExperiment(context.tenant.id, id);
    return apiSuccess({ experiment });
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
