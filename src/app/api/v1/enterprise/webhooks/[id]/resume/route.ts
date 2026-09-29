import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { webhookPlatformService } from "@/domains/enterprise/services/webhook-platform.service";
import { withStore } from "@/lib/store-unit";

/** Resumes a subscription paused after too many failed deliveries in a row. */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DEVELOPER_MANAGE);
    const { id } = await params;
    const orgId = resolveOrganizationId(context, new URL(request.url).searchParams.get("organization_id"));
    const { secret: _secret, ...subscription } = webhookPlatformService.resumeSubscription(orgId, id);
    return apiSuccess(subscription);
  } catch (err) {
    return apiError(err);
  }
}

export const POST = withStore("POST", handlePOST);
