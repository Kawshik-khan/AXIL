import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { dataQualityService } from "@/domains/intelligence/services/data-quality.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ANALYTICS_READ);
    const report = dataQualityService.runDataQualityAudit(context.tenant.id);
    return apiSuccess({ report });
  } catch (err) {
    return apiError(err);
  }
}
