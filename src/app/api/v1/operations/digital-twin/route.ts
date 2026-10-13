import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { operationalTwinService } from "@/domains/operations/services/operational-twin.service";
import { withStore } from "@/lib/store-unit";
import { OPERATIONS_COLLECTIONS } from "@/infrastructure/db/tenant-rows";

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

export const GET = withStore("GET", handleGET, { tenantRows: { collections: OPERATIONS_COLLECTIONS, permission: PERMISSIONS.OPERATIONS_READ } });
