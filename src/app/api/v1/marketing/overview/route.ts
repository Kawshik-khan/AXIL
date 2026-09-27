import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { marketingService } from "@/domains/marketing/marketing.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.MARKETING_READ);
    const metrics = marketingService.getOverviewMetrics(context.tenant.id);
    return apiSuccess(metrics);
  } catch (err) {
    return apiError(err);
  }
}
