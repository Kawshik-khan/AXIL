import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { opportunityDetectorService } from "@/domains/intelligence/services/opportunity-detector.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const opportunities = opportunityDetectorService.detectOpportunities(context.tenant.id);
    return apiSuccess({ opportunities, total: opportunities.length });
  } catch (err) {
    return apiError(err);
  }
}
