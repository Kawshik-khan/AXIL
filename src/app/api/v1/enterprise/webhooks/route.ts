import { resolveOrganizationId } from "@/domains/enterprise/organization-access";
import { PERMISSIONS } from "@/lib/permissions";
import { RbacService } from "@/domains/rbac/service";
import { extractRequestContext, apiSuccess, apiError } from "@/lib/api-response";
import { webhookPlatformService } from "@/domains/enterprise/services/webhook-platform.service";
import { db } from "@/infrastructure/db";

export async function GET(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DEVELOPER_READ);
    const { searchParams } = new URL(request.url);
    const orgId = resolveOrganizationId(context, searchParams.get("organization_id"));

    const webhooks = db.getEnterpriseWebhooks(orgId);
    return apiSuccess({
      total: webhooks.length,
      webhooks,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const context = await extractRequestContext(request);
    RbacService.assertCan(context, PERMISSIONS.DEVELOPER_MANAGE);
    const body = await request.json();
    const orgId = resolveOrganizationId(context, body.organization_id);

    const subscription = webhookPlatformService.subscribe(orgId, {
      targetUrl: body.url,
      eventTypes: body.events || ["order.created", "inventory.low_stock"],
      applicationId: body.application_id,
    });

    return apiSuccess(subscription, undefined, 201);
  } catch (err) {
    return apiError(err);
  }
}
