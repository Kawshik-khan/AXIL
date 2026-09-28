import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiError } from "@/lib/api-response";
import { integrationHubService } from "@/domains/enterprise/services/integration-hub.service";

/**
 * Provider sync. This used to run the sync engine over a placeholder item that always "succeeded", record a COMPLETED
 * sync and mark the installation HEALTHY. No provider adapter exists yet, so it answers 424 and records nothing (FX-31).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.INTEGRATIONS_SYNC);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const orgId = resolveOrganizationId(context, body.organization_id);
    integrationHubService.triggerProviderSync(orgId, id);
  } catch (err) {
    return apiError(err);
  }
}
