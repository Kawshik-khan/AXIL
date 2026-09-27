import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { integrationHubService } from "@/domains/enterprise/services/integration-hub.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.INTEGRATIONS_MANAGE);
    const { id } = await params;

    const result = integrationHubService.testConnection(resolveOrganizationId(context, new URL(request.url).searchParams.get("organization_id")), id);
    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
