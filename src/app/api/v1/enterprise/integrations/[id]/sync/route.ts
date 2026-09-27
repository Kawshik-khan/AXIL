import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { syncEngineService } from "@/domains/enterprise/services/sync-engine.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await extractRequestContext(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const orgId = body.organization_id || "org_default";

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
