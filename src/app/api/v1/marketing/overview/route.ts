import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";
import { withStore } from "@/lib/store-unit";

async function handleGET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const metrics = marketingService.getOverviewMetrics(context.tenant.id);
    return apiSuccess(metrics);
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
