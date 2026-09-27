import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { syncEngineService } from "@/domains/enterprise/services/sync-engine.service";

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

    const result = await syncEngineService.executeSync({
      organizationId: orgId,
      integrationId: id,
      entityType: body.entity_type || "ORDER",
      direction: body.direction || "INBOUND",
      items: body.items || [{ test_sync: true, triggered_at: new Date().toISOString() }],
      processItemFn: async () => ({ success: true }),
    });

    return apiSuccess(result);
  } catch (err) {
    return apiError(err);
  }
}
