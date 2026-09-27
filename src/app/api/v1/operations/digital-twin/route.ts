import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { operationalTwinService } from "@/domains/operations/services/operational-twin.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
    const tenantId = context.tenant.id;

    const twin = operationalTwinService.getDigitalTwin(tenantId);
    return apiSuccess(twin);
  } catch (err) {
    return apiError(err);
  }
}
