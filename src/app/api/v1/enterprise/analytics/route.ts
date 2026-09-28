import { resolveEnterpriseCaller, resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseAnalyticsService } from "@/domains/enterprise/services/enterprise-analytics.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ENTERPRISE_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const caller = resolveEnterpriseCaller(context, orgId); // real role and scope (N11)

    const analytics = enterpriseAnalyticsService.getConsolidatedAnalytics(orgId, caller, context.tenant.id);
    return apiSuccess(analytics);
  } catch (err) {
    return apiError(err);
  }
}
