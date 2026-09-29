import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { operationalTwinService } from "@/domains/operations/services/operational-twin.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
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

export const GET = withStore("GET", handleGET);
