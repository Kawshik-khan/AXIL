import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { attributionService } from "@/domains/growth/services/attribution.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const tenantId = context.tenant.id;
    const summary = attributionService.getAttributionSummary(tenantId);
    return apiSuccess({ attribution: summary });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
