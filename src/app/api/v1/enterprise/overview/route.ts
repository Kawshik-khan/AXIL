import { resolveEnterpriseCaller, resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { enterpriseOperationsService } from "@/domains/enterprise/services/enterprise-operations.service";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.ENTERPRISE_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const overview = enterpriseOperationsService.getOverview(orgId, context.tenant.id, resolveEnterpriseCaller(context, orgId));
    return apiSuccess(overview);
  } catch (err) {
    return apiError(err);
  }
}
