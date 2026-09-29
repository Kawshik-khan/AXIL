import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { businessObjectivesService } from "@/domains/autonomous/services";
import { NotFoundError } from "@/lib/errors";
import { withStore } from "@/lib/store-unit";

async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OBJECTIVES_READ);
    const { id } = await Promise.resolve(params);
    const objective = businessObjectivesService.findById(context.tenant.id, id);
    if (!objective) {
      return apiError(new NotFoundError(`Objective not found: ${id}`));
    }
    const hierarchy = businessObjectivesService.getObjectiveHierarchy(context.tenant.id);
    const risks = businessObjectivesService.assessRisk(context.tenant.id, id);
    return apiSuccess({ objective, hierarchy, risks });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
