import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { providerHealthService } from "@/domains/operations/services/provider-health.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.OPERATIONS_READ);
    const tenantId = context.tenant.id;

    const healthMap = providerHealthService.getProviderHealthMap(tenantId);
    return apiSuccess({
      providers: healthMap,
    });
  } catch (err) {
    return apiError(err);
  }
}

// No POST: provider health is recorded only by real provider calls (providerHealthService.recordCall), never by
// API clients, who could otherwise forge health data (FIX_IMPLEMENTATION_PLAN FX-10 step 5).

export const GET = withStore("GET", handleGET);
