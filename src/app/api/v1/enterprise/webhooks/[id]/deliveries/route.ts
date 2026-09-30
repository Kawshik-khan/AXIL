import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { webhookPlatformService } from "@/domains/enterprise/services/webhook-platform.service";
import { withStore } from "@/lib/store-unit";

/** Delivery history of one of the caller's subscriptions (no payloads, no signatures). */
async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DEVELOPER_READ);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));
    const limit = Number(searchParams.get("limit") ?? 50);
    const deliveries = webhookPlatformService.listDeliveries(orgId, id, Number.isFinite(limit) ? limit : 50);
    return apiSuccess({ total: deliveries.length, deliveries });
  } catch (err) {
    return apiError(err);
  }
}

export const GET = withStore("GET", handleGET);
