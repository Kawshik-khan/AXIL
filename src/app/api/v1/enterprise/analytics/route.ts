import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseAnalyticsService } from "@/domains/enterprise/services/enterprise-analytics.service";
import { EnterpriseUserRecord } from "@/types/enterprise";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ENTERPRISE_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const caller: EnterpriseUserRecord = {
      id: context.user?.id || "usr_default",
      organization_id: orgId,
      user_id: context.user?.id || "usr_default",
      name: context.user?.name || "Enterprise Admin",
      email: context.user?.email || "admin@commerceos.io",
      enterprise_role: "ENTERPRISE_ADMIN",
      assigned_scope: { organization_id: orgId, all_access: true },
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const analytics = enterpriseAnalyticsService.getConsolidatedAnalytics(orgId, caller, context.tenant.id);
    return apiSuccess(analytics);
  } catch (err) {
    return apiError(err);
  }
}
